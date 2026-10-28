// The one scroll policy of the app. React Router (declarative mode, as used here) never touches scroll, and the browser's own restoration cannot be trusted in a single-page app whose pages
// load their content after the route changes. Before this, nothing managed it: after "Create test" the page opened wherever the previous page happened to be scrolled to, so a staff member
// saw an arbitrary part of the dashboard (or its top), never the list the new test is in. The decision is made here, from the kind of navigation, and applied by components/ScrollManager.jsx.
//
//   a link or button that goes to ANOTHER page        -> top of the new page
//   browser Back / Forward / refresh                  -> the position that history entry had (restored once its content has rendered)
//   the same page with a different query or state    -> the page does not move (filters, tabs, pagination, replaceState)
//   an address with #section, or state { scrollTo }   -> that section (waited for until it exists: it may be rendered after data loads)
//
// Modals, dropdowns and field changes are not navigation and never reach this code, so they cannot move the page.
const MAX_SAVED = 60;
const STORAGE_KEY = "ca_scroll_positions";

// -> { action: "top" } | { action: "keep" } | { action: "restore", y } | { action: "element", id }
export function decideScroll({ navType, prevPathname, pathname, hash = "", scrollTo = null, savedY = null }) {
  const pop = navType === "POP";
  // Back, Forward and refresh return to where that history entry was, before anything else: a { scrollTo } request belongs to the navigation that made it, not to going back to it later.
  if (pop && Number.isFinite(savedY) && savedY > 0) return { action: "restore", y: savedY };
  if (!pop && typeof scrollTo === "string" && scrollTo) return { action: "element", id: scrollTo };
  if (hash && hash.length > 1) { try { return { action: "element", id: decodeURIComponent(hash.slice(1)) }; } catch { return { action: "element", id: hash.slice(1) }; } }
  if (pop) return { action: "top" };
  if (prevPathname !== null && prevPathname === pathname) return { action: "keep" };
  return { action: "top" };
}

// Saved positions per history entry (location.key), in sessionStorage so a refresh finds its own position again. Bounded; never holds anything but numbers.
export function loadPositions(storage = typeof sessionStorage !== "undefined" ? sessionStorage : null) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
export function savePosition(key, y, storage = typeof sessionStorage !== "undefined" ? sessionStorage : null) {
  if (!storage || !key || !Number.isFinite(y)) return;
  try {
    const all = loadPositions(storage);
    delete all[key]; // re-insert so the newest entries are the last ones
    all[key] = Math.max(0, Math.round(y));
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SAVED))) delete all[k];
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* storage full or blocked: scroll memory is a convenience */ }
}
export function savedPosition(key, storage) {
  const v = loadPositions(storage)[key];
  return Number.isFinite(v) ? v : null;
}
