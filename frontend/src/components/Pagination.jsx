// Standalone pagination, extracted from Table.jsx's own inline Prev/Next markup so pages that
// don't use the Table component (27 files hand-roll this same "Prev / Page X of Y / Next" pattern)
// can share the identical control instead of re-implementing it.
export default function Pagination({ page, totalPages, onPageChange, style }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 12, ...style }}>
      <button className="btn btn-ghost" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Prev</button>
      <span style={{ fontSize: 13 }} aria-current="page">Page {page} of {totalPages}</span>
      <button className="btn btn-ghost" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</button>
    </nav>
  );
}
