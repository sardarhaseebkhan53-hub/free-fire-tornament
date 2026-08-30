'use client';
// =============================================================================
// AdCard — client-side renderer for a single admin-managed advertisement.
// Fires an impression beacon on mount and a click beacon on click (the counters
// on the Advertisement model existed but nothing ever incremented them until
// §E.1). Analytics beacons are fire-and-forget and must never break the page.
// =============================================================================
import { useEffect, useState } from 'react';

export interface AdPayload {
  id: string;
  name: string;
  imageUrl: string | null;
  targetUrl: string | null;
  embedHtml: string | null;
}

// Dedupe impressions across StrictMode's double effect invocation and repeated
// instances of the same ad id on one page (e.g. HEADER + FOOTER serving the
// same campaign) — an impression should count once per page view.
const firedImpressions = new Set<string>();

function fireBeacon(path: string) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(path);
    } else {
      void fetch(path, { method: 'POST', keepalive: true }).catch(() => {});
    }
  } catch {
    /* analytics must never break the page */
  }
}

export function AdCard({ ad }: { ad: AdPayload }) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    if (firedImpressions.has(ad.id)) return;
    firedImpressions.add(ad.id);
    fireBeacon(`/api/backend/public/ads/${ad.id}/impression`);
  }, [ad.id]);

  function onAdClick() {
    // sendBeacon survives the navigation so the click always lands server-side.
    fireBeacon(`/api/backend/public/ads/${ad.id}/click`);
  }

  if (broken) return null;

  // Admin-provided sponsor embed. PHASE 18: this markup used to be injected
  // into OUR document with dangerouslySetInnerHTML, so anything an ad carried
  // ran on our origin — it could read the visitor's session token out of
  // localStorage and act as them. Staff-only authoring is not a boundary (one
  // phished admin account = every visitor's account). The embed now renders in
  // a sandboxed frame: scripts may run for the ad network, but the frame has an
  // opaque origin (no allow-same-origin), cannot navigate the top page and
  // cannot open popups, so it can never read our storage or cookies.
  if (ad.embedHtml) {
    return (
      <div className="relative overflow-hidden rounded-card border border-line" aria-label={`Sponsored: ${ad.name}`}>
        <iframe
          title={`Sponsored: ${ad.name}`}
          srcDoc={ad.embedHtml}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="block h-28 w-full border-0 bg-base"
        />
        <span className="pointer-events-none absolute right-2 top-2 rounded-pill bg-base/85 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-fg-3">
          Sponsored
        </span>
      </div>
    );
  }

  if (!ad.imageUrl) return null;

  const image = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={ad.imageUrl}
        alt={ad.name}
        loading="lazy"
        className="h-auto w-full object-cover"
        onError={() => setBroken(true)}
      />
      <span className="pointer-events-none absolute right-2 top-2 rounded-pill bg-base/85 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-fg-3">
        Sponsored
      </span>
    </>
  );

  if (ad.targetUrl) {
    return (
      <a
        href={ad.targetUrl}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={onAdClick}
        className="relative block overflow-hidden rounded-card border border-line transition hover:border-accent/40"
        aria-label={ad.name}
      >
        {image}
      </a>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-card border border-line" aria-label={`Sponsored: ${ad.name}`}>
      {image}
    </div>
  );
}
