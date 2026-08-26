import { cloneElement, isValidElement, useId, useState } from "react";

// Lightweight hover/focus tooltip for a short hint on a truncated label or an icon — distinct from
// InfoTip.jsx, which is deliberately click-to-toggle-only for longer explanatory text (see its own
// comment). This one is for the "hover to see the full text" case InfoTip explicitly doesn't cover.
// Shows on focus as well as hover so it's reachable by keyboard, not just a mouse.
export default function Tooltip({ text, children }) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {isValidElement(children) ? cloneElement(children, { "aria-describedby": id }) : <span aria-describedby={id}>{children}</span>}
      {visible && (
        <span
          id={id}
          role="tooltip"
          style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
            background: "var(--slate-900)", color: "var(--chalk)", fontSize: 12, padding: "6px 10px",
            borderRadius: 6, whiteSpace: "nowrap", zIndex: 500, boxShadow: "var(--shadow-md)", pointerEvents: "none",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
