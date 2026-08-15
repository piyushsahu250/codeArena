import { Component } from "react";

// No error boundary existed anywhere in this app — any uncaught render exception (or a
// stale-deploy lazy-chunk load failure) unmounted straight to a blank white screen with no
// recovery, indistinguishable from "the interview crashed/exited." Scoped to wrap only the
// /interview/session/:id route in App.jsx, not the whole app, per "don't change unrelated
// modules" — this is a targeted fix for that one high-stakes, long-lived screen.
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
      return (
        <div style={{ maxWidth: 560, margin: "80px auto", padding: 24 }}>
          <div className="ip-glass" style={{ padding: 32, textAlign: "center" }}>
            <h2 style={{ color: "var(--rust)" }}>We hit a temporary problem</h2>
            <p style={{ marginTop: 10, opacity: 0.8 }}>
              Your progress is saved up to your last submitted answer. Reloading this page will resume where you
              left off.
            </p>
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
