import { useEffect } from "react";

const SITE = "https://codearena.site";

function setMeta(nameOrProp, content, attr = "name") {
  let el = document.head.querySelector(`meta[${attr}="${nameOrProp}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, nameOrProp);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

// Per-route <title>/description/canonical/OG for the SPA's public marketing pages. There's no
// SSR here, so the raw HTML always carries index.html's generic tags — this hook overwrites them
// client-side once the route mounts. Googlebot renders JS before indexing and reads the DOM at
// that point, so this is a well-established, accepted pattern for CSR sites (not a workaround).
// Non-JS crawlers (link-preview bots) still only see index.html's static fallback values, which
// is why those are kept reasonably generic/accurate rather than route-specific.
export default function useSeoHead({ title, description, path = "/" }) {
  useEffect(() => {
    const fullTitle = title ? `${title} | CodeArena` : "CodeArena | AI-Powered Coding & Assessment Platform";
    document.title = fullTitle;
    if (description) {
      setMeta("description", description);
      setMeta("og:description", description, "property");
      setMeta("twitter:description", description);
    }
    setMeta("og:title", fullTitle, "property");
    setMeta("twitter:title", fullTitle);
    setCanonical(`${SITE}${path}`);
  }, [title, description, path]);
}

// Injects a page-scoped JSON-LD <script> (e.g. BreadcrumbList) and removes it on unmount, so
// navigating between marketing pages doesn't accumulate stale structured-data blocks in <head>.
// The site-wide Organization/WebSite JSON-LD lives statically in index.html instead — it doesn't
// vary per route, so it doesn't need this per-page inject/cleanup dance.
export function useJsonLd(data) {
  useEffect(() => {
    if (!data) return undefined;
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.text = JSON.stringify(data);
    document.head.appendChild(el);
    return () => el.remove();
  }, [data]);
}

export function breadcrumbJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE}${it.path}`,
    })),
  };
}
