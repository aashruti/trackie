import { Skeleton, TopbarSkeleton } from "@/components/ui/skeleton";

export default function HrAttendanceLoading() {
  return (
    <>
      <TopbarSkeleton section="HR" title="Attendance" />
      <main className="mx-auto w-full max-w-[1440px] space-y-5 px-6 py-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </main>
    </>
  );
}
