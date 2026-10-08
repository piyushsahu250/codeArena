import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import api from "../api";

export default function GlobalSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      api.get("/search", { params: { q } })
        .then((res) => {
          if (requestId !== requestIdRef.current) return; // a newer request already fired — discard this stale response
          setResults(res.data.results);
          setOpen(true);
        })
        .catch(() => { if (requestId === requestIdRef.current) setResults([]); })
        .finally(() => { if (requestId === requestIdRef.current) setLoading(false); });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  function go(url) {
    setOpen(false);
    setQ("");
    navigate(url);
  }

  return (
    <div className="ca-topbar-search" ref={boxRef}>
      <Search />
      <input
        placeholder="Search students, staff, institutes, courses…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => q.trim().length >= 2 && setOpen(true)}
      />
      {open && (
        <div className="ca-dropdown" style={{ width: "100%", maxWidth: "none" }}>
          {loading && <div className="ca-dropdown-item">Searching…</div>}
          {!loading && results.length === 0 && <div className="ca-dropdown-item">No results for "{q}"</div>}
          {!loading && results.map((r, i) => (
            <div key={i}>
              {(i === 0 || results[i - 1].type !== r.type) && <div className="mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.6, padding: "8px 12px 2px" }}>{r.type}</div>}
              <button className="ca-dropdown-item" onClick={() => go(r.url)}>{r.label}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
