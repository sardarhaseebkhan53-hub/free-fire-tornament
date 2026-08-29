// =============================================================================
// AdSlot — server component that renders every active ad for a placement.
// Fetches /public/ads/:placement (the date-window fix in public.service.ts is
// what actually makes this return rows) and maps each to <AdCard>, which fires
// the impression/click beacons client-side. Renders nothing when no ad is
// configured, so pages are unchanged for placements admins aren't using.
// =============================================================================
import { apiServerSafe } from '@/lib/api';
import { AdCard, type AdPayload } from './ad-card';

export type AdPlacement =
  | 'HEADER'
  | 'TOURNAMENT_PAGE'
  | 'SIDEBAR'
  | 'BLOG'
  | 'FOOTER'
  | 'MOBILE'
  | 'INTERSTITIAL';

export async function AdSlot({
  placement,
  className = '',
}: {
  placement: AdPlacement;
  className?: string;
}) {
  const data = await apiServerSafe<{ items: AdPayload[] }>(`/public/ads/${placement}`);
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <div className={`space-y-3 ${className}`}>
      {items.map((ad) => (
        <AdCard key={ad.id} ad={ad} />
      ))}
    </div>
  );
}
