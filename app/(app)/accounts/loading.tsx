import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function AccountsLoading() {
  return (
    <>
      <TopbarSkeleton section="Universities" title="Accounts" />
      <main className="mx-auto w-full max-w-[1440px] space-y-4 px-6 py-6">
        <Skeleton className="h-3 w-40" />
        {/* Filter / search bar */}
        <Skeleton className="h-9 w-full rounded-lg" />
        {/* Table rows */}
        <div className="space-y-2">
          <Skeleton className="h-9 w-full rounded-lg" />
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      </main>
    </>
  );
}
