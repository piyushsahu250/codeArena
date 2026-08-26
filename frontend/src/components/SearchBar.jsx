import { Search, X } from "lucide-react";

// Standalone search input (icon + clear button), extracted from the same style Table.jsx's
// built-in `searchable` prop uses internally, for list/report pages that need a search box outside
// of a Table (e.g. above a card-list of results rather than a `<table>`).
export default function SearchBar({ value, onChange, placeholder = "Search…", style }) {
  return (
    <div style={{ position: "relative", ...style }}>
      <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-dim)" }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{ width: "100%", padding: `8px ${value ? 30 : 10}px 8px 30px`, borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--ink-dim)", display: "flex" }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
