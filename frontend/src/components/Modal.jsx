import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import IconButton from "./IconButton";

// Shared modal, wrapping the .ca-modal-overlay/.ca-modal CSS classes ConfirmContext already uses
// (theme.css) — same visual language, but adds what every hand-rolled modal in this codebase was
// missing: Escape-to-close, a focus trap (Tab/Shift+Tab cycles within the dialog instead of
// escaping to the page behind it), and focus landing inside the dialog on open / returning to the
// trigger element on close. None of CompleteProfileModal/EditStaffClerkProfileModal/
// EditStudentProfileModal/ResetStaffPasswordModal/CreateTest's inline modals had any of this.
export default function Modal({ open, onClose, title, children, footer, width = 420, labelledBy }) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);
  const titleId = labelledBy || "ca-modal-title";

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (focusable?.[0] || dialog)?.focus();

    function onKeyDown(e) {
      if (e.key === "Escape") { onClose?.(); return; }
      if (e.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ca-modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="ca-modal"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
            <h3 id={titleId} style={{ margin: 0 }}>{title}</h3>
            <IconButton icon={X} label="Close dialog" onClick={onClose} size={28} />
          </div>
        )}
        {children}
        {footer && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>{footer}</div>}
      </div>
    </div>
  );
}
