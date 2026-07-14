import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function GroupDetailLoading() {
  return (
    <>
      <TopbarSkeleton section="Universities" title="Group" />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-7 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </main>
    </>
  );
}
