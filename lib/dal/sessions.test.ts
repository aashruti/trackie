import { describe, it, expect, afterAll } from "vitest";
import { createSession, sessionExists, deleteSession, deleteUserSessions } from "./sessions";
import { createUser, deleteUser } from "./user-admin";

const SUPER = { id: 1, role: "super-admin" as const };

describe("sessions", () => {
  const made: number[] = [];

  async function throwaway(email: string) {
    const u = await createUser(SUPER, {
      name: "Session Test",
      email,
      password: "throwaway1",
      role: "viewer",
    });
    made.push(u.id);
    return u.id;
  }

  it("creates a session that exists, and deletes it", async () => {
    const uid = await throwaway("sess-a@datagami.local");
    const sid = await createSession(uid);
    expect(await sessionExists(sid)).toBe(true);
    await deleteSession(sid);
    expect(await sessionExists(sid)).toBe(false);
  });

  it("mints unguessable, unique ids", async () => {
    const uid = await throwaway("sess-b@datagami.local");
    const a = await createSession(uid);
    const b = await createSession(uid);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it("deleteUserSessions kills all of one user's and leaves another's alone", async () => {
    const mine = await throwaway("sess-mine@datagami.local");
    const theirs = await throwaway("sess-theirs@datagami.local");
    const m1 = await createSession(mine);
    const m2 = await createSession(mine);
    const t1 = await createSession(theirs);

    const killed = await deleteUserSessions(mine);
    expect(killed).toBe(2);
    expect(await sessionExists(m1)).toBe(false);
    expect(await sessionExists(m2)).toBe(false);
    // The assertion that matters: a missing `WHERE user_id` would sign out the
    // whole company on one password reset.
    expect(await sessionExists(t1)).toBe(true);
  });

  it("deleting a user cascades their sessions away", async () => {
    const uid = await throwaway("sess-cascade@datagami.local");
    const sid = await createSession(uid);
    await deleteUser(SUPER, uid);
    made.splice(made.indexOf(uid), 1);
    expect(await sessionExists(sid)).toBe(false);
  });

  it("sessionExists is false for an unknown id", async () => {
    expect(await sessionExists("no-such-session-id")).toBe(false);
  });

  afterAll(async () => {
    for (const id of made) await deleteUser(SUPER, id);
  });
});
