import { useAuth } from "../context/AuthContext";
import { useFeatures } from "../context/FeatureContext";

const HOME_BY_ROLE = { STUDENT: "/dashboard", STAFF: "/staff", ADMIN: "/admin", CLERK: "/clerk" };

// Section 8 of the feature-visibility spec: a direct/manually-typed URL to a disabled feature must
// not load the page or leak an internal error — show a plain message and bounce to the dashboard.
// Lives INSIDE <Protected> (needs an authenticated `user` already resolved) so route declarations
// read as <Protected roles={[...]}><FeatureProtected featureKey="..."><Page /></FeatureProtected></Protected>.
// This is a UX convenience, not the security boundary — the real enforcement is requireFeature()
// on the backend route; a user could disable JS and still get a 403 from the API.
export default function FeatureProtected({ featureKey, children }) {
  const { user } = useAuth();
  const { isFeatureEnabled, loaded } = useFeatures();

  // Don't flash the "unavailable" screen before the initial /features/me fetch resolves.
  if (!loaded) return null;

  if (!isFeatureEnabled(featureKey)) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", padding: 24 }}>
        <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
          <p style={{ fontSize: 16 }}>This feature is currently unavailable for your institute.</p>
          <a href={HOME_BY_ROLE[user?.role] || "/"} className="btn btn-primary" style={{ marginTop: 16, display: "inline-block" }}>
            Go to Dashboard
          </a>
        </div>
      </div>
    );
  }
  return children;
}
