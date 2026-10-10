// Central permission check: can(user, "area.action") and the requirePermission("area.action") route guard.
//
// The registry below is the default grant table. It is mirrored into the Permission / RolePermission tables at boot (seedPermissions), and checks read
// the tables through a short in-memory cache. If the tables are empty or unreachable the registry itself answers, so a database problem can never lock
// everyone out or silently widen access. Each key mirrors an existing requireRole(...) list exactly (see scripts/verifyPermissions.js), so converting a
// route from requireRole to requirePermission does not change who may call it.
const prisma = require("../prisma");

const R = {
  STUDENT: "STUDENT", STAFF: "STAFF", CLERK: "CLERK", ADMIN: "ADMIN", INSTITUTE_ADMIN: "INSTITUTE_ADMIN", SUPER_ADMIN: "SUPER_ADMIN",
};

const REGISTRY = {
  "student.portal": { description: "Student-only pages and actions", roles: [R.STUDENT] },
  "staff.console": { description: "Teaching and assessment management", roles: [R.ADMIN, R.SUPER_ADMIN, R.INSTITUTE_ADMIN, R.STAFF] },
  "staff.workspace": { description: "Staff-only dashboard", roles: [R.STAFF] },
  "clerk.workspace": { description: "Placement clerk dashboard", roles: [R.CLERK] },
  "placement.console": { description: "Placement cell operations", roles: [R.ADMIN, R.SUPER_ADMIN, R.INSTITUTE_ADMIN, R.STAFF, R.CLERK] },
  "institute.console": { description: "Institute administration", roles: [R.ADMIN, R.SUPER_ADMIN, R.INSTITUTE_ADMIN] },
  "platform.console": { description: "Platform-wide administration", roles: [R.ADMIN, R.SUPER_ADMIN] },
  "platform.owner": { description: "Super admin only", roles: [R.SUPER_ADMIN] },
  "staffAnalytics.view": { description: "Staff and clerk performance analytics (institute scope is forced for institute-bound accounts)", roles: [R.ADMIN, R.SUPER_ADMIN, R.INSTITUTE_ADMIN] },
  "staffAnalytics.self": { description: "A staff or clerk member viewing their own activity analytics", roles: [R.STAFF, R.CLERK] },
};

let cache = null; // { at, map: Map<key, Set<role>> }
const TTL_MS = 60 * 1000;

function registryMap() {
  return new Map(Object.entries(REGISTRY).map(([k, v]) => [k, new Set(v.roles)]));
}

async function loadMap() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  let map = registryMap();
  try {
    const rows = await prisma.rolePermission.findMany({ select: { role: true, permissionKey: true } });
    if (rows.length) {
      map = new Map();
      for (const r of rows) {
        if (!map.has(r.permissionKey)) map.set(r.permissionKey, new Set());
        map.get(r.permissionKey).add(r.role);
      }
    }
  } catch { /* tables missing or database busy: the registry answers */ }
  cache = { at: Date.now(), map };
  return map;
}

function invalidatePermissionCache() { cache = null; }

async function can(user, key) {
  if (!user || !user.role) return false;
  const map = await loadMap();
  const roles = map.get(key);
  return !!roles && roles.has(user.role); // a key nobody holds is denied
}

// Adds permissions that do not exist yet, with their default grants. Existing permissions and their grants are never touched.
async function seedPermissions() {
  const existing = new Set((await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key));
  let added = 0;
  for (const [key, def] of Object.entries(REGISTRY)) {
    if (existing.has(key)) continue;
    await prisma.permission.create({ data: { key, description: def.description } });
    await prisma.rolePermission.createMany({ data: def.roles.map((role) => ({ role, permissionKey: key })), skipDuplicates: true });
    added++;
  }
  invalidatePermissionCache();
  return { added, total: Object.keys(REGISTRY).length };
}

function requirePermission(key) {
  if (!REGISTRY[key]) throw new Error(`Unknown permission "${key}"`);
  return async (req, res, next) => {
    try {
      if (req.user && (await can(req.user, key))) return next();
      if (req.user) {
        const { logUnauthorizedAttempt } = require("../middleware/auth");
        logUnauthorizedAttempt(req, [`permission:${key}`]).catch(() => {});
      }
      return res.status(403).json({ error: "Insufficient permissions" });
    } catch (err) {
      return res.status(500).json({ error: "Permission check failed" });
    }
  };
}

async function permissionsFor(user) {
  const map = await loadMap();
  return [...map.entries()].filter(([, roles]) => roles.has(user.role)).map(([k]) => k).sort();
}

module.exports = { REGISTRY, can, requirePermission, seedPermissions, permissionsFor, invalidatePermissionCache };
