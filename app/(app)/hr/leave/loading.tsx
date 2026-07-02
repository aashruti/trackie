import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function HrLeaveLoading() {
  return (
    <>
      <TopbarSkeleton section="HR" title="Leave" />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-72" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-4">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        ))}
      </main>
    </>
  );
}
