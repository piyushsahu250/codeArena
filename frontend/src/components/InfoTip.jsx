import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

// Click/tap-to-toggle explainer for jargon (BTL, readiness levels, coverage, etc.) — spec
// explicitly forbids hover-only tooltips since hover doesn't exist on touch devices. Opens on
// click, closes on a second click, an outside click, or Escape.
export default function InfoTip({ text, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: 5 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label ? `About ${label}` : "More info"}
        aria-expanded={open}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 16, height: 16, borderRadius: "50%", border: "none",
          background: "var(--card-bg, #eee)", color: "var(--ink-dim)", cursor: "pointer", padding: 0,
        }}
      >
        <Info size={11} />
      </button>
      {open && (
        <div
          role="tooltip"
          style={{
            position: "absolute", zIndex: 50, top: "calc(100% + 6px)", left: 0,
            width: 240, maxWidth: "min(240px, 70vw)", padding: "10px 12px",
            background: "var(--panel-bg, #1C1B18)", color: "#fff", fontSize: 12, fontWeight: 400,
            lineHeight: 1.5, borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
