import { createContext, useContext, useEffect, useState } from "react";
import api from "../api";
import { useAuth } from "./AuthContext";

const FeatureContext = createContext(null);

// Institute-wise feature ON/OFF state for the signed-in user — fetched once per login from
// GET /api/features/me (institute derived server-side, never trusted from this client). While
// loading (or if the fetch fails) every feature defaults to enabled, matching the backend's own
// "no explicit row = enabled" default (see featureAccess.js) — this is a UI convenience only,
// never the actual gate: every sensitive route is enforced again server-side by requireFeature(),
// so a stale/optimistic `true` here can never grant access the backend wouldn't also allow.
export function FeatureProvider({ children }) {
  const { user } = useAuth();
  const [features, setFeatures] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) {
      setFeatures({});
      setLoaded(false);
      return;
    }
    let cancelled = false;
    api.get("/features/me").then(({ data }) => {
      if (!cancelled) setFeatures(data.features || {});
    }).catch(() => {
      // Best-effort — leave `features` empty so isFeatureEnabled's permissive default applies;
      // the server-side gate on the actual action is the real backstop either way.
    }).finally(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  function isFeatureEnabled(key) {
    if (!key) return true;
    return features[key] !== false;
  }

  return (
    <FeatureContext.Provider value={{ features, loaded, isFeatureEnabled }}>
      {children}
    </FeatureContext.Provider>
  );
}

export function useFeatures() {
  const ctx = useContext(FeatureContext);
  if (!ctx) throw new Error("useFeatures must be used within FeatureProvider");
  return ctx;
}
