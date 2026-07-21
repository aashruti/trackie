import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function AdminAuditLoading() {
  return (
    <>
      <TopbarSkeleton section="Admin" title="Audit log" />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-36 rounded-md" />
          ))}
        </div>
        <div className="space-y-2 rounded-xl border border-border p-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
