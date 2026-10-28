import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { decideScroll, savePosition, savedPosition } from "../utils/scrollPolicy";

// Applies utils/scrollPolicy.js on every navigation. Renders nothing. Mounted once, inside the router. It does not add a second system next to the router: it only reads the router's own
// location and navigation type, takes over from the browser's restoration (which cannot wait for a lazily rendered page) and cleans up everything it starts.
const WAIT_FOR_CONTENT_MS = 4000; // a section or a restored position may be rendered after the page's data arrives: wait this long, then give up without moving anything

// Calls `step` on animation frames until it returns true or the time is up; returns a cancel function.
function untilDone(step, limitMs) {
  let raf = 0;
  const start = Date.now();
  const tick = () => {
    if (step() || Date.now() - start > limitMs) return;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export default function ScrollManager() {
  const location = useLocation();
  const navType = useNavigationType();
  const previousPathname = useRef(null);
  const decided = useRef(null); // { key, decision } of the history entry already handled

  // The router decides where the page goes; the browser must not also try.
  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return undefined;
    const before = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => { window.history.scrollRestoration = before; };
  }, []);

  // Remember where this history entry is scrolled to (throttled), for Back / Forward / refresh.
  useEffect(() => {
    let timer = null;
    const remember = () => savePosition(location.key, window.scrollY);
    const onScroll = () => { if (timer === null) timer = setTimeout(() => { timer = null; remember(); }, 120); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", remember);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("pagehide", remember); clearTimeout(timer); };
  }, [location.key]);

  // Apply the policy for this navigation.
  useEffect(() => {
    // The decision is made once per history entry. React Strict Mode runs this effect twice for the same entry (it mounts, unmounts and mounts again to check cleanups): the second run
    // must apply the SAME decision, not recompute one from the pathname it has just recorded (that would turn "restore" into "keep" and drop the restore).
    let decision;
    if (decided.current && decided.current.key === location.key) {
      decision = decided.current.decision;
    } else {
      decision = decideScroll({
        navType, prevPathname: previousPathname.current, pathname: location.pathname, hash: location.hash,
        scrollTo: location.state && location.state.scrollTo, savedY: savedPosition(location.key),
      });
      decided.current = { key: location.key, decision };
      previousPathname.current = location.pathname;
    }
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (decision.action === "top") { window.scrollTo(0, 0); return undefined; }
    if (decision.action === "restore") {
      return untilDone(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max >= decision.y - 2) { window.scrollTo(0, decision.y); return true; } // the page is tall enough now
        return false;
      }, 1500);
    }
    if (decision.action === "element") {
      return untilDone(() => {
        const el = document.getElementById(decision.id);
        if (!el) return false;
        el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        return true;
      }, WAIT_FOR_CONTENT_MS);
    }
    return undefined; // "keep": the same page (a query or state change): it does not move
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
