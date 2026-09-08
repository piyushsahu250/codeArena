import { useAuth } from "../context/AuthContext";
import { useFeatures } from "../context/FeatureContext";

const HOME_BY_ROLE = { STUDENT: "/dashboard", STAFF: "/staff", ADMIN: "/admin", CLERK: "/clerk" };

// Section 8 of the feature-visibility spec: a direct/manually-typed URL to a disabled feature must
// not load the page or leak an internal error — show a plain message and bounce to the dashboard.
// Lives INSIDE <Protected> (needs an authenticated `user` already resolved) so route declarations
// read as <Protected roles={[...]}><FeatureProtected featureKey="..."><Page /></FeatureProtected></Protected>.
// This is a UX convenience, not the security boundary — the real enforcement is requireFeature()
// on the backend route; a user could disable JS and still get a 403 from the API.
export default function FeatureProtected({ featureKey, featureLabel, children }) {
  const { user } = useAuth();
  const { isFeatureEnabled, loaded } = useFeatures();

  // Bug fixed 2026-09-08: this returned null (nothing at all -- not a spinner, not a message,
  // literally blank) for the entire window before the initial /features/me fetch resolves. On a
  // slow connection, right after login, or a hard refresh directly on a feature-gated route (this
  // component is the FIRST thing to remount, since FeatureProvider's own `loaded` state resets to
  // false on every fresh mount), that window is long enough to read as "the page is just blank" --
  // exactly the reported Weekly Challenge white-screen symptom. Used by 23 routes across the
  // dashboard (Daily/Weekly Challenge among them), so this was never specific to one page -- it's
  // the same underlying gap on every feature-gated route, just most noticeable on whichever one a
  // student happened to be testing. A real loading message closes it everywhere at once, matching
  // this file's own comment above about never flashing the wrong state -- a visible "Loading..."
  // is never wrong, unlike briefly showing "unavailable" would be.
  if (!loaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", padding: 24 }}>
        <p style={{ color: "var(--ink-dim)" }}>Loading…</p>
      </div>
    );
  }

  if (!isFeatureEnabled(featureKey)) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
          <p style={{ fontSize: 16 }}>{featureLabel ? `${featureLabel} is currently unavailable for your institute.` : "This feature is currently unavailable for your institute."}</p>
          <a href={HOME_BY_ROLE[user?.role] || "/"} className="btn btn-primary" style={{ marginTop: 16, display: "inline-block" }}>
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }
  return children;
}
