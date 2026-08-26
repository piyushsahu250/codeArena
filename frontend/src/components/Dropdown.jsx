import { useEffect, useRef, useState } from "react";

// Menu-style dropdown, reusing the .ca-dropdown/.ca-dropdown-item CSS classes Navbar.jsx's
// notification/help/profile menus already use — same visual language, but adds click-outside,
// Escape-to-close, and arrow-key navigation between items, none of which Navbar's hand-rolled
// open/close state has today.
export default function Dropdown({ trigger, items, align = "right" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) { if (!rootRef.current?.contains(e.target)) setOpen(false); }
    function onKeyDown(e) {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const focusable = menuRef.current?.querySelectorAll('[role="menuitem"]');
      if (!focusable?.length) return;
      const current = Array.from(focusable).indexOf(document.activeElement);
      const dir = e.key === "ArrowDown" ? 1 : -1;
      focusable[(current + dir + focusable.length) % focusable.length]?.focus();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <span onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>{trigger}</span>
      {open && (
        <div ref={menuRef} className="ca-dropdown" role="menu" style={align === "left" ? { left: 0, right: "auto" } : undefined}>
          {items.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              className="ca-dropdown-item"
              style={{ width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer", color: item.danger ? "var(--rust)" : undefined }}
              onClick={() => { item.onClick?.(); setOpen(false); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
