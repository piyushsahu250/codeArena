const express = require("express");
const router = express.Router();
const prisma = require("../prisma");
const { authenticate, requireRole } = require("../middleware/auth");
const { attachRequesterInstitute } = require("../middleware/institute");
const { FEATURE_CATALOG, isValidFeatureKey } = require("../utils/featureCatalog");
const { getInstituteFeatureMap, invalidateFeatureCache } = require("../utils/featureAccess");
const { logAudit, AUDIT_ACTIONS } = require("../utils/auditLog");

// Any authenticated role — Student/Staff/Clerk/Admin all need this to decide what to render in
// their own sidebar/dashboard. Institute is derived server-side (attachRequesterInstitute), never
// trusted from the client, so a user can only ever get their OWN institute's configuration here.
router.get("/me", authenticate, attachRequesterInstitute, async (req, res) => {
  try {
    const map = await getInstituteFeatureMap(req.requesterInstituteId);
    res.json({ features: map });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load feature configuration" });
  }
});

// Dependents-of lookup used by the warning logic below and by the frontend to explain why a
// feature is greyed out.
function dependentsOf(featureKey) {
  return FEATURE_CATALOG.filter((f) => f.dependsOn === featureKey).map((f) => f.key);
}

// ADMIN: full catalog + this institute's current state, for the Feature Management page.
// requesterInstituteId is null only for a genuine platform-level admin (no institute of their
// own) — an institute-scoped ADMIN must match the instituteId they're asking about, or every
// other institute's feature configuration (and, via PATCH/bulk/copy below, its write access)
// would be reachable just by supplying a different id in the query string/body.
router.get("/", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { instituteId } = req.query;
    if (!instituteId) return res.status(400).json({ error: "instituteId is required" });
    if (req.requesterInstituteId && instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only view feature configuration for your own institute" });
    }

    const institute = await prisma.institute.findUnique({ where: { id: instituteId }, select: { id: true, name: true } });
    if (!institute) return res.status(404).json({ error: "Institute not found" });

    const rows = await prisma.featureSetting.findMany({ where: { instituteId } });
    const byKey = new Map(rows.map((r) => [r.featureKey, r]));

    const updaterIds = [...new Set(rows.map((r) => r.updatedBy).filter(Boolean))];
    const updaters = updaterIds.length
      ? await prisma.user.findMany({ where: { id: { in: updaterIds } }, select: { id: true, name: true } })
      : [];
    const updaterName = new Map(updaters.map((u) => [u.id, u.name]));

    const features = FEATURE_CATALOG.map((f) => {
      const row = byKey.get(f.key);
      return {
        key: f.key,
        label: f.label,
        category: f.category,
        dependsOn: f.dependsOn || null,
        enabled: row ? row.enabled : true, // Section 12 Option A default
        updatedAt: row ? row.updatedAt : null,
        updatedByName: row?.updatedBy ? updaterName.get(row.updatedBy) || null : null,
      };
    });

    res.json({ institute, features });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load feature configuration" });
  }
});

// ADMIN: toggle a single feature for a single institute.
router.patch("/", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { instituteId, featureKey, enabled } = req.body;
    if (!instituteId || !featureKey || typeof enabled !== "boolean") {
      return res.status(400).json({ error: "instituteId, featureKey and enabled (boolean) are required" });
    }
    if (!isValidFeatureKey(featureKey)) return res.status(400).json({ error: "Unknown feature key" });
    if (req.requesterInstituteId && instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only change feature configuration for your own institute" });
    }

    const institute = await prisma.institute.findUnique({ where: { id: instituteId }, select: { id: true } });
    if (!institute) return res.status(404).json({ error: "Institute not found" });

    const existing = await prisma.featureSetting.findUnique({ where: { instituteId_featureKey: { instituteId, featureKey } } });
    const previous = existing ? existing.enabled : true;

    const row = await prisma.featureSetting.upsert({
      where: { instituteId_featureKey: { instituteId, featureKey } },
      update: { enabled, updatedBy: req.user.id },
      create: { instituteId, featureKey, enabled, updatedBy: req.user.id },
    });
    invalidateFeatureCache(instituteId);

    await logAudit({
      req, action: AUDIT_ACTIONS.FEATURE_TOGGLED, actorId: req.user.id, actorName: req.user.name, actorRole: "ADMIN",
      instituteId, details: { featureKey, previous, new: enabled },
    });

    // Section 23: warn (don't block) when this change leaves a dependency chain half-configured.
    let warning = null;
    if (!enabled) {
      const affected = dependentsOf(featureKey);
      if (affected.length) {
        const map = await getInstituteFeatureMap(instituteId);
        const stillOnButNowBlocked = affected.filter((k) => map[k]);
        if (stillOnButNowBlocked.length) {
          const labels = FEATURE_CATALOG.filter((f) => stillOnButNowBlocked.includes(f.key)).map((f) => f.label);
          warning = `${labels.join(", ")} depend${labels.length === 1 ? "s" : ""} on this feature and will also be unavailable until it is re-enabled.`;
        }
      }
    } else {
      const entry = FEATURE_CATALOG.find((f) => f.key === featureKey);
      if (entry?.dependsOn) {
        const map = await getInstituteFeatureMap(instituteId);
        if (!map[entry.dependsOn]) {
          const dep = FEATURE_CATALOG.find((f) => f.key === entry.dependsOn);
          warning = `This feature depends on ${dep?.label || entry.dependsOn}, which is currently OFF for this institute — it will remain unavailable until that is enabled too.`;
        }
      }
    }

    res.json({ ok: true, featureKey, enabled: row.enabled, warning });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update feature configuration" });
  }
});

// ADMIN: bulk-toggle one feature across an explicit, admin-chosen list of institutes. Never
// resolves an implicit "all institutes" — the caller must enumerate exactly which ones, so a
// frontend bug or confirmation-skip can't silently touch the whole platform (Section 16).
router.post("/bulk", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { instituteIds, featureKey, enabled } = req.body;
    if (!Array.isArray(instituteIds) || instituteIds.length === 0) return res.status(400).json({ error: "instituteIds must be a non-empty array" });
    if (instituteIds.length > 500) return res.status(400).json({ error: "Too many institutes in one bulk request" });
    if (!featureKey || typeof enabled !== "boolean") return res.status(400).json({ error: "featureKey and enabled (boolean) are required" });
    if (!isValidFeatureKey(featureKey)) return res.status(400).json({ error: "Unknown feature key" });
    // Cross-institute bulk toggling is a platform-admin-only capability (requesterInstituteId
    // null) — an institute-scoped ADMIN calling this with any id other than their own would
    // otherwise be able to flip features for institutes they don't manage.
    if (req.requesterInstituteId && instituteIds.some((id) => id !== req.requesterInstituteId)) {
      return res.status(403).json({ error: "You can only change feature configuration for your own institute" });
    }

    const found = await prisma.institute.findMany({ where: { id: { in: instituteIds } }, select: { id: true } });
    const validIds = found.map((i) => i.id);
    const missing = instituteIds.filter((id) => !validIds.includes(id));

    for (const instituteId of validIds) {
      const existing = await prisma.featureSetting.findUnique({ where: { instituteId_featureKey: { instituteId, featureKey } } });
      const previous = existing ? existing.enabled : true;
      await prisma.featureSetting.upsert({
        where: { instituteId_featureKey: { instituteId, featureKey } },
        update: { enabled, updatedBy: req.user.id },
        create: { instituteId, featureKey, enabled, updatedBy: req.user.id },
      });
      invalidateFeatureCache(instituteId);
      await logAudit({
        req, action: AUDIT_ACTIONS.FEATURE_BULK_TOGGLED, actorId: req.user.id, actorName: req.user.name, actorRole: "ADMIN",
        instituteId, details: { featureKey, previous, new: enabled, bulk: true, instituteCount: validIds.length },
      });
    }

    res.json({ ok: true, updated: validIds.length, missing });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to apply bulk feature update" });
  }
});

// ADMIN: preview what "Copy Configuration" would change, before the admin confirms it.
router.get("/copy-preview", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { fromInstituteId, toInstituteId } = req.query;
    if (!fromInstituteId || !toInstituteId) return res.status(400).json({ error: "fromInstituteId and toInstituteId are required" });
    if (fromInstituteId === toInstituteId) return res.status(400).json({ error: "Source and target institutes must differ" });
    // Copying configuration between institutes is a platform-admin-only capability — same
    // reasoning as /bulk above.
    if (req.requesterInstituteId && (fromInstituteId !== req.requesterInstituteId || toInstituteId !== req.requesterInstituteId)) {
      return res.status(403).json({ error: "You can only view configuration for your own institute" });
    }

    const [fromMap, toMap] = await Promise.all([
      getInstituteFeatureMap(fromInstituteId),
      getInstituteFeatureMap(toInstituteId),
    ]);
    const changes = FEATURE_CATALOG.map((f) => ({
      key: f.key, label: f.label, from: fromMap[f.key], to: toMap[f.key], willChange: fromMap[f.key] !== toMap[f.key],
    }));
    res.json({ changes, changeCount: changes.filter((c) => c.willChange).length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to build copy preview" });
  }
});

// ADMIN: apply the copy. Overwrites every catalog key on the target with the source's value —
// intentionally all-or-nothing per key (not a partial merge) since a partial copy would be
// surprising; the preview above is what lets the admin decide whether that's what they want.
router.post("/copy", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { fromInstituteId, toInstituteId } = req.body;
    if (!fromInstituteId || !toInstituteId) return res.status(400).json({ error: "fromInstituteId and toInstituteId are required" });
    if (fromInstituteId === toInstituteId) return res.status(400).json({ error: "Source and target institutes must differ" });
    if (req.requesterInstituteId && (fromInstituteId !== req.requesterInstituteId || toInstituteId !== req.requesterInstituteId)) {
      return res.status(403).json({ error: "You can only change configuration for your own institute" });
    }

    const [source, target] = await Promise.all([
      prisma.institute.findUnique({ where: { id: fromInstituteId }, select: { id: true } }),
      prisma.institute.findUnique({ where: { id: toInstituteId }, select: { id: true } }),
    ]);
    if (!source || !target) return res.status(404).json({ error: "Institute not found" });

    const fromMap = await getInstituteFeatureMap(fromInstituteId);
    for (const featureKey of Object.keys(fromMap)) {
      const enabled = fromMap[featureKey];
      const existing = await prisma.featureSetting.findUnique({ where: { instituteId_featureKey: { instituteId: toInstituteId, featureKey } } });
      const previous = existing ? existing.enabled : true;
      if (previous === enabled) continue; // no-op, skip write+audit noise
      await prisma.featureSetting.upsert({
        where: { instituteId_featureKey: { instituteId: toInstituteId, featureKey } },
        update: { enabled, updatedBy: req.user.id },
        create: { instituteId: toInstituteId, featureKey, enabled, updatedBy: req.user.id },
      });
    }
    invalidateFeatureCache(toInstituteId);

    await logAudit({
      req, action: AUDIT_ACTIONS.FEATURE_CONFIG_COPIED, actorId: req.user.id, actorName: req.user.name, actorRole: "ADMIN",
      instituteId: toInstituteId, details: { copiedFrom: fromInstituteId },
    });

    const updatedMap = await getInstituteFeatureMap(toInstituteId);
    res.json({ ok: true, features: updatedMap });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to copy feature configuration" });
  }
});

// ADMIN: configuration-change history for one institute's feature settings — a scoped view over
// the platform's general audit log (Section 18), not a separate logging system.
router.get("/audit", authenticate, requireRole("ADMIN"), attachRequesterInstitute, async (req, res) => {
  try {
    const { instituteId } = req.query;
    if (!instituteId) return res.status(400).json({ error: "instituteId is required" });
    if (req.requesterInstituteId && instituteId !== req.requesterInstituteId) {
      return res.status(403).json({ error: "You can only view configuration history for your own institute" });
    }
    const logs = await prisma.auditLog.findMany({
      where: { instituteId, action: { in: [AUDIT_ACTIONS.FEATURE_TOGGLED, AUDIT_ACTIONS.FEATURE_BULK_TOGGLED, AUDIT_ACTIONS.FEATURE_CONFIG_COPIED] } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ logs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load configuration history" });
  }
});

module.exports = router;
