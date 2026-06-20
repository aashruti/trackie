import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function AdminUsersLoading() {
  return (
    <>
      <TopbarSkeleton section="Admin" title="Users" />
      <main className="mx-auto w-full max-w-[1440px] space-y-4 px-6 py-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-9 w-full rounded-lg" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-xl border border-border p-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
