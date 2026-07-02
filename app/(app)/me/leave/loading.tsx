import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function MyLeaveLoading() {
  return (
    <>
      <TopbarSkeleton section="Me" title="Apply for leave" />
      <main className="mx-auto w-full max-w-[1440px] px-6 py-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </main>
    </>
  );
}
