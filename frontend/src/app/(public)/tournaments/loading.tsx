// Tournament list loading skeleton — holds the grid layout so navigation
// never jumps when the real cards stream in.
import { CardSkeleton, Skeleton } from '@/components/ui';

export default function TournamentsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6" aria-busy="true" aria-label="Loading tournaments">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-9 w-56" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />

      <div className="mt-8 flex gap-3">
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="h-11 w-24" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-pill" />
        ))}
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
