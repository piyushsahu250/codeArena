import { useState } from "react";
import api from "../api";

// Independent publishing for every level of the Learning hierarchy. A row's state is its OWN: publishing a
// course never publishes its modules, and so on down. Students see an item only when everything above it
// is Published too. Nothing here deletes anything -- Unpublish/Archive keep all attempts and progress.
export function publishStatusOf(row, entity) {
  if (!row) return "DRAFT";
  if (entity === "course") return row.status === "PUBLISHED" ? "PUBLISHED" : row.status === "ARCHIVED" ? "ARCHIVED" : "DRAFT";
  if (entity === "question") return row.questionStatus === "PUBLISHED" ? "PUBLISHED" : row.questionStatus === "ARCHIVED" ? "ARCHIVED" : "DRAFT";
  if (row.archivedAt) return "ARCHIVED";
  return row.isActive ? "PUBLISHED" : "DRAFT";
}

const META = {
  PUBLISHED: { symbol: "●", label: "Published", color: "var(--mint-dark, #1f7a4d)" },
  DRAFT: { symbol: "○", label: "Draft", color: "var(--ink-dim)" },
  SCHEDULED: { symbol: "◐", label: "Scheduled", color: "var(--amber-dark)" },
  ARCHIVED: { symbol: "▣", label: "Archived", color: "var(--rust)" },
};

export function StatusChip({ status }) {
  const m = META[status] || META.DRAFT;
  return (
    <span
      className="mono"
      title={`${m.label}${status === "PUBLISHED" ? " — visible to students once everything above it is also Published" : ""}`}
      style={{ fontSize: 12, color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}
    >
      {m.symbol} {m.label}
    </span>
  );
}

const btn = { fontSize: 12, padding: "4px 10px" };

export default function PublishControls({ entity, id, row, status: statusOverride, canEdit, onChanged, compact }) {
  const [busy, setBusy] = useState(false);
  const status = statusOverride || publishStatusOf(row, entity);

  async function act(action) {
    const warn = {
      unpublish: "Unpublish? Students will no longer see this or start new attempts. Existing progress, attempts and scores are kept, and attempts already in progress can still be finished.",
      archive: "Archive? It disappears from student navigation. Nothing is deleted — attempts, scores and progress are preserved, and you can restore it later.",
    }[action];
    if (warn && !confirm(warn)) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/learning/publish/${entity}/${id}/${action}`);
      if (data.warnings?.length) alert(data.warnings.join("\n"));
      onChanged?.(data);
    } catch (err) {
      alert(err.response?.data?.error || "Could not change publish state");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <StatusChip status={status} />
      {canEdit && status === "DRAFT" && <button type="button" className="btn btn-ghost" style={btn} disabled={busy} onClick={() => act("publish")}>Publish</button>}
      {canEdit && status === "PUBLISHED" && <button type="button" className="btn btn-ghost" style={btn} disabled={busy} onClick={() => act("unpublish")}>Unpublish</button>}
      {canEdit && status === "ARCHIVED" && <button type="button" className="btn btn-ghost" style={btn} disabled={busy} onClick={() => act("restore")}>Restore</button>}
      {canEdit && !compact && status !== "ARCHIVED" && <button type="button" className="btn btn-ghost" style={btn} disabled={busy} onClick={() => act("archive")}>Archive</button>}
    </span>
  );
}
