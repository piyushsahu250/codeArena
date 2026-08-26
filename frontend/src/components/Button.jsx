// Shared button, wrapping the existing .btn/.btn-primary/.btn-ghost/.btn-dark CSS classes (theme.css)
// rather than inventing new styling — no visual change for existing plain-CSS-class usages, but new
// code gets a consistent loading/disabled state instead of each page hand-rolling
// `{saving ? "Saving…" : "Save"}` + `disabled={saving}` separately.
import { Loader2 } from "lucide-react";

const VARIANT_CLASS = { primary: "btn-primary", ghost: "btn-ghost", dark: "btn-dark", danger: "btn-ghost" };

export default function Button({
  children, variant = "primary", loading = false, disabled = false, icon: Icon, type = "button",
  as: As = "button", to, href, style, className, onClick, ...rest
}) {
  const isDisabled = disabled || loading;
  const dangerStyle = variant === "danger" ? { color: "var(--rust)", borderColor: "var(--rust)" } : undefined;
  const classes = `btn ${VARIANT_CLASS[variant] || "btn-primary"}${className ? ` ${className}` : ""}`;
  const content = (
    <>
      {loading ? <Loader2 size={14} className="ca-spin" /> : Icon ? <Icon size={14} /> : null}
      {children}
    </>
  );

  // Link-as-button (e.g. dashboard quick actions) — <a>/<Link> has no native disabled attribute,
  // so a "disabled" link is faked via aria-disabled + swallowing the click instead.
  if (As !== "button") {
    return (
      <As
        to={to}
        href={href}
        className={classes}
        style={{ ...dangerStyle, ...style, ...(isDisabled ? { opacity: 0.6, pointerEvents: "none" } : null) }}
        aria-disabled={isDisabled || undefined}
        onClick={isDisabled ? (e) => e.preventDefault() : onClick}
        {...rest}
      >
        {content}
      </As>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      style={{ ...dangerStyle, ...style }}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onClick={onClick}
      {...rest}
    >
      {content}
    </button>
  );
}
