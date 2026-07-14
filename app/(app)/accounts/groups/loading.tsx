import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function GroupsLoading() {
  return (
    <>
      <TopbarSkeleton section="Universities" title="Grouped view" />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
        <div className="flex gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-28" />
          ))}
        </div>
        <div className="space-y-2 rounded-xl border border-border p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </main>
    </>
  );
}
