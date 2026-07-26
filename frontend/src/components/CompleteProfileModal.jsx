import { useAuth } from "../context/AuthContext";

// Shown once, immediately after landing on the (forced) Profile page while gated. No close (X)
// button by design — the only ways out are completing the section (handled by the page
// underneath once dismissed) or logging out.
export default function CompleteProfileModal({ onDismiss }) {
  const { logout } = useAuth();

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div className="card" style={{ padding: 28, maxWidth: 460, width: "90%" }}>
        <h2 style={{ fontSize: 19 }}>Complete Your Profile</h2>
        <p style={{ fontSize: 14, marginTop: 10 }}>Welcome!</p>
        <p style={{ fontSize: 14, marginTop: 6 }}>
          To continue your learning journey and improve your career opportunities, please complete your basic profile information.
        </p>
        <p style={{ fontSize: 13.5, marginTop: 12, fontWeight: 600 }}>Completing your profile helps us:</p>
        <ul style={{ fontSize: 13.5, marginTop: 6, paddingLeft: 20, color: "var(--ink-dim)" }}>
          <li>Recommend relevant job opportunities</li>
          <li>Improve placement visibility</li>
          <li>Match you with recruiters</li>
          <li>Generate accurate resumes</li>
          <li>Track academic achievements</li>
        </ul>
        <p style={{ fontSize: 13.5, marginTop: 12 }}>
          You must complete the <strong>Personal Academic &amp; Info</strong> section before continuing.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={onDismiss}>Complete Profile</button>
          <button className="btn btn-ghost" onClick={logout}>Logout</button>
        </div>
      </div>
    </div>
  );
}
