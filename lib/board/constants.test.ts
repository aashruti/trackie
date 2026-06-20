import { describe, it, expect } from "vitest";
import {
  initials,
  leadStats,
  stageLabel,
  stageSum,
  teamStats,
  person,
  TASK_COLUMNS,
  LEAD_STAGE_META,
} from "./constants";
import { TASK_STATUSES, LEAD_STAGES } from "@/lib/db/enums";

describe("initials", () => {
  it("takes first two word initials, uppercased", () => {
    expect(initials("Ramesh Kothari")).toBe("RK");
    expect(initials("Priya Nair")).toBe("PN");
    expect(initials("madonna")).toBe("M");
  });
});

describe("person", () => {
  it("resolves roster codes and falls back gracefully", () => {
    expect(person("RK").name).toBe("Ramesh Kothari");
    expect(person("ZZ").name).toBe("ZZ"); // unknown → echoes the code
  });
});

describe("teamStats", () => {
  const tasks = [
    { status: "backlog" as const },
    { status: "blocked" as const },
    { status: "blocked" as const },
    { status: "done" as const },
  ];
  it("counts open (not done), blocked, done", () => {
    expect(teamStats(tasks)).toEqual({ open: 3, blocked: 2, done: 1 });
  });
});

describe("leadStats / stageSum", () => {
  const leads = [
    { stage: "new" as const, value: 100 },
    { stage: "negotiation" as const, value: 200 },
    { stage: "won" as const, value: 500 },
  ];
  it("excludes won from active count and open pipeline value", () => {
    expect(leadStats(leads)).toEqual({ activeCount: 2, pipelineValue: 300, wonValue: 500 });
  });
  it("sums a column's value", () => {
    expect(stageSum(leads)).toBe(800);
    expect(stageSum([])).toBe(0);
  });
});

describe("fixed vocabularies stay in sync with enums", () => {
  it("task columns match TASK_STATUSES order", () => {
    expect(TASK_COLUMNS.map((c) => c.id)).toEqual([...TASK_STATUSES]);
  });
  it("lead stages match LEAD_STAGES order", () => {
    expect(LEAD_STAGE_META.map((s) => s.id)).toEqual([...LEAD_STAGES]);
  });
  it("stageLabel resolves known + unknown", () => {
    expect(stageLabel("won")).toBe("Won");
  });
});
