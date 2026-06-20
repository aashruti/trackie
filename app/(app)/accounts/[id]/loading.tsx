import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function AccountDetailLoading() {
  return (
    <>
      <TopbarSkeleton section="Universities" title="Account" />
      <main className="mx-auto w-full max-w-[1440px] space-y-6 px-6 py-6">
        {/* Account header */}
        <div className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-border p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-28" />
            </div>
          ))}
        </div>

        {/* Invoices table */}
        <div className="space-y-2">
          <Skeleton className="h-9 w-full rounded-lg" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </main>
    </>
  );
}
