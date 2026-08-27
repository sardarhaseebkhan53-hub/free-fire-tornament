// Tournament detail loading skeleton — mirrors the hero + two-column layout
// so the page shape is stable while server data streams in.
import { Skeleton } from '@/components/ui';

export default function TournamentDetailLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6" aria-busy="true" aria-label="Loading tournament">
      <div className="relative overflow-hidden rounded-card border border-line bg-gradient-to-br from-accent/25 via-elevated to-surface p-6 sm:p-10">
        <Skeleton className="h-6 w-40 rounded-pill bg-white/10" />
        <Skeleton className="mt-4 h-10 w-2/3 max-w-md bg-white/10" />
        <div className="mt-6 flex flex-wrap gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-32 bg-white/10" />
          ))}
        </div>
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="glass rounded-card p-6">
            <Skeleton className="h-5 w-32" />
            <div className="mt-4 space-y-2.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
          <div className="glass rounded-card p-6">
            <Skeleton className="h-5 w-40" />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          </div>
        </div>
        <div className="glass h-fit rounded-card p-5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mt-4 h-12 w-full" />
          <Skeleton className="mt-3 h-12 w-full" />
        </div>
      </div>
    </div>
  );
}
