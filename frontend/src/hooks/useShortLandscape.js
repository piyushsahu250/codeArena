import { useEffect, useState } from "react";
import { SHORT_LANDSCAPE_QUERY } from "../utils/editorHeight";

// True while the screen is landscape and at most 500 px tall (a phone held sideways). See utils/editorHeight.js.
export default function useShortLandscape() {
  const [short, setShort] = useState(() => (typeof window !== "undefined" ? window.matchMedia(SHORT_LANDSCAPE_QUERY).matches : false));

  useEffect(() => {
    const mql = window.matchMedia(SHORT_LANDSCAPE_QUERY);
    const onChange = (e) => setShort(e.matches);
    mql.addEventListener("change", onChange);
    setShort(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return short;
}
