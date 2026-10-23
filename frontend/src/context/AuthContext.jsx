import { createContext, useContext, useState } from "react";
import api from "../api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });

  function login(token, userData) {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(userData));
    setUser(userData);
  }

  // Merges a partial patch into the persisted user object — used after PATCH /profile/me so
  // profileComplete (and any changed name/mobile/etc.) reflects immediately without a fresh
  // login, since this app has no /auth/me refresh endpoint and treats localStorage as the source
  // of truth for the session's user object (see login() above).
  function updateUser(patch) {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem("user", JSON.stringify(next));
      return next;
    });
  }

  function logout() {
    // Best-effort — closes the server-side LoginSession row so an admin's "active sessions" view
    // and the audit log reflect a real logout, not just the token going stale after 12h. Local
    // state is cleared unconditionally regardless of whether this call succeeds.
    // The token is read and sent explicitly BEFORE storage is cleared: axios runs request interceptors asynchronously, so by the time api.js's interceptor looked for the
    // token it was already gone, the request went out without credentials and was refused, and the server session stayed open for its full 12 hours (found by signing a
    // test student out on the live site and finding the session still active).
    const token = localStorage.getItem("token");
    if (token) api.post("/auth/logout", null, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
