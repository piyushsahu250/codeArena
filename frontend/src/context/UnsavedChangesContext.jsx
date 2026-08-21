import { createContext, useCallback, useContext, useRef } from "react";

const UnsavedChangesContext = createContext(null);

// Lets a page with an unsaved-data form (currently: CreateTest.jsx) register a guard that
// Sidebar.jsx's navigation links check before actually navigating away — the "safe, no-migration"
// answer to blocking in-app SPA navigation. This app uses <BrowserRouter> + <Routes> (declarative
// mode), not a data router (createBrowserRouter/<RouterProvider>) — react-router-dom's
// useBlocker/unstable_useBlocker requires a data router and throws outside one, and switching the
// whole app to a data router is a large, genuinely risky migration (every route becomes a config
// object instead of JSX, every loader/Suspense/ErrorBoundary interaction needs re-verifying) for a
// single feature. Intercepting <Link> clicks needs no router change at all — a Link's default
// navigation is just a click handler that calls history.push internally, and calling
// preventDefault() in the onClick prop stops that the same way it would for any other link.
//
// A ref (not state) backs the guard so registering/clearing it never re-renders anything outside
// the one page that owns it — Sidebar reads the current value only at the moment of a click.
export function UnsavedChangesProvider({ children }) {
  const guardRef = useRef(null); // { message } | null

  const setGuard = useCallback((active, message) => {
    guardRef.current = active ? { message: message || "You have unsaved changes." } : null;
  }, []);

  const checkGuard = useCallback(() => guardRef.current, []);

  return (
    <UnsavedChangesContext.Provider value={{ setGuard, checkGuard }}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

// { setGuard, checkGuard } — a page calls setGuard(isDirty, message) as its dirty state changes
// (and setGuard(false) on unmount/after save); a navigation trigger calls checkGuard() to see
// whether it's safe to proceed. Returns null if no UnsavedChangesProvider is mounted, so a caller
// can no-op gracefully (shouldn't happen — the provider wraps the whole authenticated app — but
// makes this file's behavior well-defined regardless of where it's used from).
export function useUnsavedChangesGuard() {
  return useContext(UnsavedChangesContext);
}
