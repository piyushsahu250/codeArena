import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X, Sun, Moon } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

// Shared top nav for every public marketing page (Landing + the new /features, /about, etc.
// pages) — was previously duplicated as a Landing-only local component; pulled out so every
// public page links to the same set of pages instead of drifting.
const LINKS = [
  { to: "/features", label: "Features" },
  { to: "/for-institutions", label: "For Institutions" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
];

export default function MarketingNav() {
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <nav className="ca-landing-nav">
      <Link to="/" style={{ display: "flex", alignItems: "center" }}>
        <div style={{ background: "#fdfbf5", borderRadius: 8, padding: "3px 10px", display: "flex", alignItems: "center" }}>
          <img src="/branding/logo.png" alt="CodeArena" style={{ height: 30, width: "auto", display: "block" }} />
        </div>
      </Link>

      <div className="ca-landing-nav-links">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to}>{l.label}</Link>
        ))}
      </div>

      <div className="ca-landing-nav-actions">
        <button className="ca-topbar-icon-btn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle dark/light mode">
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <Link to="/login" className="btn btn-primary" style={{ padding: "9px 18px", fontSize: 13.5 }}>
          Sign in
        </Link>
        <button
          className="ca-topbar-icon-btn ca-landing-mobile-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {open && (
        <div className="ca-landing-mobile-menu">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} onClick={() => setOpen(false)}>{l.label}</Link>
          ))}
        </div>
      )}
    </nav>
  );
}
