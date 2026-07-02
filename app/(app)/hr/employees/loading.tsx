import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function HrEmployeesLoading() {
  return (
    <>
      <TopbarSkeleton section="HR" title="Employees" />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-64 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-md" />
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          <Skeleton className="h-11 w-full rounded-none" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border-subtle px-4 py-3.5 last:border-0">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-7 w-7 rounded-full" />
              <Skeleton className="h-4 w-40 flex-1" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
