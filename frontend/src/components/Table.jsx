import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown, Search } from "lucide-react";
import EmptyState from "./EmptyState";
import { SkeletonLine } from "./Skeleton";
import Pagination from "./Pagination";

// Shared table, replacing the ~26 pages that each hand-roll their own `<table style={{...}}>`
// markup (see docs/PLATFORM_HEALTH.md-adjacent audit — no dedicated Table component existed before
// this). Every call site gets, for free: a consistent header/row style matching the previous
// hand-rolled markup exactly (same padding/borders/font-size, so this is a drop-in visual match,
// not a redesign), a built-in loading skeleton, a built-in empty state, and opt-in client-side
// search/sort/pagination for call sites that need them — none of that UI appears unless explicitly
// enabled, so a simple summary-widget table stays exactly as lean as it was before.
//
// columns: [{ key, header, render?(row), sortValue?(row), align?: "left"|"right"|"center", mono?: bool }]
// data: array of row objects
// getRowKey: (row) => string|number
// searchable: bool — adds a search box filtering rows by `searchKeys` (array of column keys, or a
//   custom `searchValue(row)` fn passed instead)
// sortable: bool — clicking a column header sorts by that column's `sortValue` (or raw `row[key]`)
// pageSize: number — enables client-side pagination (Prev/Next); omit for server-side pagination,
//   which the caller should keep handling itself (see `pagination` prop) since it already needs to
//   refetch data per page.
// pagination: { page, totalPages, onPageChange } — for server-driven pagination (caller owns data
//   fetching per page); mutually exclusive with `pageSize`.
// selectable: bool — adds a checkbox column (row checkboxes + a header "select all" that applies to
//   the currently-visible/rendered rows only, not the whole unpaginated dataset). Caller owns the
//   selection set via `selectedKeys` (a Set of row keys) and `onSelectionChange(nextSet)`.
export default function Table({
  columns, data, getRowKey, emptyMessage = "No records found.", emptyIcon, loading = false,
  searchable = false, searchPlaceholder = "Search…", searchKeys, searchValue,
  sortable = false, pageSize, pagination, dense = false,
  selectable = false, selectedKeys, onSelectionChange,
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [clientPage, setClientPage] = useState(1);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return data || [];
    const q = query.trim().toLowerCase();
    return (data || []).filter((row) => {
      if (searchValue) return String(searchValue(row) ?? "").toLowerCase().includes(q);
      const keys = searchKeys || columns.map((c) => c.key);
      return keys.some((k) => String(row[k] ?? "").toLowerCase().includes(q));
    });
  }, [data, query, searchable, searchKeys, searchValue, columns]);

  const sorted = useMemo(() => {
    if (!sortable || !sort.key) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    const getVal = col?.sortValue || ((row) => row[sort.key]);
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = getVal(a), bv = getVal(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sort.dir === "asc" ? av - bv : bv - av;
      return sort.dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [filtered, sortable, sort, columns]);

  const totalClientPages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const pageRows = pageSize ? sorted.slice((clientPage - 1) * pageSize, clientPage * pageSize) : sorted;

  function toggleSort(key) {
    if (!sortable) return;
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  const rowPad = dense ? "6px 10px" : "10px 12px";

  const visibleKeys = pageRows.map((row, i) => getRowKey(row, i));
  const allVisibleSelected = selectable && visibleKeys.length > 0 && visibleKeys.every((k) => selectedKeys?.has(k));
  const someVisibleSelected = selectable && !allVisibleSelected && visibleKeys.some((k) => selectedKeys?.has(k));

  function toggleAllVisible() {
    const next = new Set(selectedKeys);
    if (allVisibleSelected) visibleKeys.forEach((k) => next.delete(k));
    else visibleKeys.forEach((k) => next.add(k));
    onSelectionChange(next);
  }
  function toggleRow(key) {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    onSelectionChange(next);
  }

  return (
    <div>
      {searchable && (
        <div style={{ position: "relative", marginBottom: 12, maxWidth: 320 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-dim)" }} />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setClientPage(1); }}
            placeholder={searchPlaceholder}
            style={{ width: "100%", padding: "8px 10px 8px 30px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
          />
        </div>
      )}

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "2px solid var(--line)", fontSize: 12, color: "var(--ink-dim)" }}>
              {selectable && (
                <th style={{ padding: rowPad, width: 1 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={allVisibleSelected}
                    ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }}
                    onChange={toggleAllVisible}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && toggleSort(col.key)}
                  style={{
                    padding: rowPad, textAlign: col.align || "left",
                    cursor: sortable && col.sortable !== false ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {col.header}
                    {sortable && col.sortable !== false && sort.key === col.key && (sort.dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 4 }).map((_, i) => (
              <tr key={`sk-${i}`} style={{ borderBottom: "1px solid var(--line)" }}>
                {selectable && <td style={{ padding: rowPad }} />}
                {columns.map((col) => <td key={col.key} style={{ padding: rowPad }}><SkeletonLine height={12} /></td>)}
              </tr>
            ))}
            {!loading && pageRows.map((row, i) => (
              <tr key={getRowKey(row, i)} style={{ borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                {selectable && (
                  <td style={{ padding: rowPad }}>
                    <input
                      type="checkbox"
                      aria-label={`Select row ${i + 1}`}
                      checked={!!selectedKeys?.has(getRowKey(row, i))}
                      onChange={() => toggleRow(getRowKey(row, i))}
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className={col.mono ? "mono" : undefined} style={{ padding: rowPad, textAlign: col.align || "left" }}>
                    {col.render ? col.render(row) : (row[col.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
            {!loading && pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} style={{ padding: 0 }}>
                  <EmptyState text={query.trim() ? "No results match your search." : emptyMessage} icon={emptyIcon} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageSize && <Pagination page={clientPage} totalPages={totalClientPages} onPageChange={setClientPage} />}
      {pagination && <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={pagination.onPageChange} />}
    </div>
  );
}
