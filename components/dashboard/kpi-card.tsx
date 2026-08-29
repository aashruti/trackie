import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";

type Tone = "default" | "positive" | "negative" | "pending" | "info";

export function KpiCard({
  label,
  value,
  tone = "default",
  sublabel,
}: {
  label: string;
  value: number;
  tone?: Tone;
  sublabel?: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold leading-none">
        <Money value={value} tone={tone} />
      </div>
      {sublabel && <div className="mt-2 text-xs text-text-muted">{sublabel}</div>}
    </Card>
  );
}
