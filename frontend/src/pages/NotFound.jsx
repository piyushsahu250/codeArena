import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import MarketingNav from "../components/MarketingNav";
import MarketingFooter from "../components/MarketingFooter";
import "./landing.css";

// Real 404 page — replaces the previous silent `<Route path="*" element={<Navigate to="/" />} />`
// (App.jsx), which sent every broken/mistyped URL back to the homepage with a 200. That's a
// "soft 404": Google flags it in Search Console, and a genuinely broken link looked like it
// "worked." This can't set the actual HTTP status code to 404 (Vercel's SPA rewrite always
// returns 200 for the document itself — that would need Edge Middleware, out of scope here), but
// it stops masking the error and adds a noindex tag so a URL that reaches this page is never
// treated as real content to index.
export default function NotFound() {
  useEffect(() => {
    document.title = "Page Not Found | CodeArena";
    let el = document.head.querySelector('meta[name="robots"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", "robots");
      document.head.appendChild(el);
    }
    el.setAttribute("content", "noindex, nofollow");
    return () => el?.setAttribute("content", "index, follow");
  }, []);

  return (
    <div className="ca-landing">
      <MarketingNav />
      <div className="ca-mkt-banner" style={{ padding: "96px 32px" }}>
        <div className="ca-mkt-banner-inner">
          <span className="ca-eyebrow">404</span>
          <h1>This page doesn't exist.</h1>
          <p>
            The link you followed may be broken, or the page may have moved. Here are a few places
            to go instead.
          </p>
          <div className="ca-hero-ctas" style={{ justifyContent: "center", marginTop: 26 }}>
            <Link to="/" className="btn btn-primary">
              Go to homepage <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="btn-outline-light">
              Sign in
            </Link>
          </div>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
