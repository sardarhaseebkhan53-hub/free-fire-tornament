'use client';
// =============================================================================
// TournamentImage — the one image component for every tournament/banner/blog
// visual on the site (spec: "no broken image icons, ever").
//
//   valid src     → renders the image (lazy by default)
//   missing/failed→ swaps to the bundled CLUTCHNEX default art
//   fallback fails→ renders the branded gradient placeholder (never a broken
//                    icon, never an empty box)
//   loading       → shimmering branded gradient while the bytes arrive
//
// Admin-uploaded files live under /uploads/* (proxied to the API) and bundled
// art under /art/* — both go through this component, so every surface shares
// the same failure behavior.
// =============================================================================
import { useState } from 'react';

const DEFAULT_ART = '/art/tournament-default.png';

/** Original CLUTCHNEX gradient placeholder — shows only if even the fallback
 *  cannot load (e.g. offline). Deterministic per-name hue so cards differ. */
function ArtPlaceholder({ label, className = '' }: { label: string; className?: string }) {
  const hue = 262 + (label.charCodeAt(0) % 3) * 14; // violet family
  return (
    <div
      aria-hidden
      className={className}
      style={{
        background: `radial-gradient(circle at 70% 20%, hsla(${hue}, 82%, 62%, 0.35), transparent 60%),
          linear-gradient(135deg, hsla(${hue}, 65%, 35%, 0.55), hsl(228 28% 8%) 70%)`,
      }}
    />
  );
}

export function TournamentImage({
  src,
  alt,
  className = '',
  fallback = DEFAULT_ART,
  lazy = true,
  priority = false,
  sizes,
  label = 'CLUTCHNEX',
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fallback?: string;
  lazy?: boolean;
  priority?: boolean;
  sizes?: string;
  /** Used to tint the gradient placeholder. */
  label?: string;
}) {
  // Derived-state reset: when the src prop changes, restart the chain.
  const [prev, setPrev] = useState<string | null>(() => src ?? fallback);
  const [current, setCurrent] = useState<string>(() => src ?? fallback);
  const [loaded, setLoaded] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  if (src !== prev) {
    setPrev(src ?? null);
    setCurrent(src ?? fallback);
    setLoaded(false);
    setGaveUp(false);
  }

  if (gaveUp) {
    return <ArtPlaceholder label={label} className={className} />;
  }

  return (
    // Plain <img> on purpose: sources mix bundled /art files and proxied
    // /uploads files with arbitrary container classes — next/image would
    // require a fixed loader + dimensions and break the shared className
    // contract (see the existing <img> usage across this app).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current}
      alt={alt}
      loading={priority ? 'eager' : lazy ? 'lazy' : undefined}
      fetchPriority={priority ? 'high' : undefined}
      sizes={sizes}
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (current === fallback) setGaveUp(true);
        else setCurrent(fallback);
      }}
      className={`${loaded ? '' : 'skeleton'} transition-opacity duration-300 ${className}`}
    />
  );
}
