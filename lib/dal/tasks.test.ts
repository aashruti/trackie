import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import {
  accounts,
  deliveryMethods,
  oems,
  programs as programsTable,
  tasks as tasksTable,
  users,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createTask, listTasks, listTaskOptions, countTasksByStatus } from "./tasks";

// Board separation: one `tasks` table serves the team board and the delivery
// board, split by the `board` column. Delivery tasks may carry a program.

const RUN = String(Date.now()).slice(-6);
const fx = { oemId: 0, accountId: 0, methodId: 0, programId: 0, userId: 0 };
const createdTasks: number[] = [];

beforeAll(async () => {
  const [oem] = await db.insert(oems).values({ name: `BoardOEM-${RUN}` }).returning({ id: oems.id });
  fx.oemId = oem.id;
  const [acc] = await db
    .insert(accounts)
    .values({ name: `BoardUni-${RUN}`, oemId: oem.id })
    .returning({ id: accounts.id });
  fx.accountId = acc.id;
  const [method] = await db
    .insert(deliveryMethods)
    .values({ name: `BoardStyle-${RUN}`, code: `B${RUN}` })
    .returning({ id: deliveryMethods.id });
  fx.methodId = method.id;
  const [program] = await db
    .insert(programsTable)
    .values({ accountId: acc.id, oemId: oem.id, deliveryMethodId: method.id, name: `BoardProgram-${RUN}` })
    .returning({ id: programsTable.id });
  fx.programId = program.id;
  // A user with NO user_accounts membership — assignable on delivery, not on team.
  const [u] = await db
    .insert(users)
    .values({ name: `Board Tester ${RUN}`, email: `board-test-${RUN}@test.local`, passwordHash: "x", role: "delivery" })
    .returning({ id: users.id });
  fx.userId = u.id;
});

afterAll(async () => {
  if (createdTasks.length) await db.delete(tasksTable).where(inArray(tasksTable.id, createdTasks));
  await db.delete(programsTable).where(eq(programsTable.id, fx.programId));
  await db.delete(accounts).where(eq(accounts.id, fx.accountId));
  await db.delete(deliveryMethods).where(eq(deliveryMethods.id, fx.methodId));
  await db.delete(oems).where(eq(oems.id, fx.oemId));
  await db.delete(users).where(eq(users.id, fx.userId));
});

describe("board-aware tasks", () => {
  it("a delivery task with only a program derives its account and stays off the team board", async () => {
    const { id } = await createTask({
      title: `Delivery task ${RUN}`,
      board: "delivery",
      programId: fx.programId,
      status: "open",
    });
    createdTasks.push(id);

    const delivery = await listTasks({ board: "delivery", statuses: ["open"] });
    const mine = delivery.find((t) => t.id === id)!;
    expect(mine.accountId).toBe(fx.accountId); // derived from the program
    expect(mine.programName).toBe(`BoardProgram-${RUN}`);
    expect(mine.board).toBe("delivery");

    const team = await listTasks({ statuses: ["open"] }); // default board: team
    expect(team.find((t) => t.id === id)).toBeUndefined();
  });

  it("team tasks stay off the delivery board (default board is team)", async () => {
    const { id } = await createTask({ title: `Team task ${RUN}`, status: "open" });
    createdTasks.push(id);
    const delivery = await listTasks({ board: "delivery", statuses: ["open"] });
    expect(delivery.find((t) => t.id === id)).toBeUndefined();
    const team = await listTasks({ statuses: ["open"] });
    expect(team.find((t) => t.id === id)?.board).toBe("team");
  });

  it("account/program mismatch is rejected; unknown program is rejected", async () => {
    await expect(
      createTask({ title: "Mismatch", board: "delivery", programId: fx.programId, accountId: 999999 }),
    ).rejects.toThrow(/different account/);
    await expect(createTask({ title: "Ghost", board: "delivery", programId: 99999999 })).rejects.toThrow(/not found/i);
  });

  it("the user_accounts assignment rule applies on team but NOT on delivery", async () => {
    // fx.userId has no user_accounts row for fx.accountId.
    await expect(
      createTask({ title: "Team assign", accountId: fx.accountId, assigneeId: fx.userId }),
    ).rejects.toThrow(/isn't assigned/);
    const { id } = await createTask({
      title: "Delivery assign",
      board: "delivery",
      programId: fx.programId,
      assigneeId: fx.userId,
    });
    createdTasks.push(id);
    expect(id).toBeGreaterThan(0);
  });

  it("countTasksByStatus is board-scoped and options include programs", async () => {
    const teamBacklog = await countTasksByStatus("backlog");
    const deliveryBacklog = await countTasksByStatus("backlog", "delivery");
    expect(teamBacklog).toBeGreaterThanOrEqual(0);
    expect(deliveryBacklog).toBeGreaterThanOrEqual(0);
    const options = await listTaskOptions();
    const prog = options.programs.find((p) => p.id === fx.programId)!;
    expect(prog).toMatchObject({ name: `BoardProgram-${RUN}`, accountId: fx.accountId });
  });
});
