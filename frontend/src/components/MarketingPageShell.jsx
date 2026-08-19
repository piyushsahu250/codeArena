import MarketingNav from "./MarketingNav";
import MarketingFooter from "./MarketingFooter";

// Shared chrome for every new public content page (About, Contact, Privacy, Terms, and the six
// feature deep-dive pages) — same nav/footer/banner structure as the homepage, so a visitor
// arriving from a Google search on any of these lands somewhere that visibly belongs to the same
// site, not a disconnected template.
export default function MarketingPageShell({ eyebrow, title, intro, wide = false, children }) {
  return (
    <div className="ca-landing">
      <MarketingNav />
      <div className="ca-mkt-banner">
        <div className="ca-mkt-banner-inner">
          {eyebrow && <span className="ca-eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          {intro && <p>{intro}</p>}
        </div>
      </div>
      <div className={wide ? "ca-mkt-wide-body" : "ca-mkt-body"}>{children}</div>
      <MarketingFooter />
    </div>
  );
}
