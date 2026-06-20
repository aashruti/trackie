import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function BacklogLoading() {
  return (
    <>
      <TopbarSkeleton section="Workspace" title="Backlog" />
      <main className="mx-auto w-full max-w-[1440px] space-y-3 px-6 py-6">
        <Skeleton className="h-9 w-full rounded-lg" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-3">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 flex-1 rounded" />
            <Skeleton className="h-4 w-20 rounded" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </main>
    </>
  );
}
