import { Component } from "react";

// No error boundary existed anywhere in this app — any uncaught render exception (or a
// stale-deploy lazy-chunk load failure) unmounted straight to a blank white screen with no
// recovery, indistinguishable from a real crash. Originally scoped to wrap only the
// /interview/session/:id route ("don't change unrelated modules" — a targeted fix for that one
// high-stakes, long-lived screen). Generalized here (optional title/message props, defaulting to
// the original interview-session wording so that route's behavior is unchanged) so the identical
// fix can be reused on other routes — e.g. Daily/Weekly Challenge — without duplicating this class
// or writing route-specific recovery copy that doesn't actually apply there.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("ErrorBoundary caught:", error);
  }

  render() {
    if (this.state.hasError) {
      const title = this.props.title || "We hit a temporary problem";
      const message = this.props.message || "Your progress is saved up to your last submitted answer. Reloading this page will resume where you left off.";
      return (
        <div style={{ maxWidth: 560, margin: "80px auto", padding: 24 }}>
          <div className="ip-glass" style={{ padding: 32, textAlign: "center" }}>
            <h2 style={{ color: "var(--rust)" }}>{title}</h2>
            <p style={{ marginTop: 10, opacity: 0.8 }}>{message}</p>
            <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
