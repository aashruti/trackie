import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/config", () => ({ auth: (handler: unknown) => handler }));

import proxy from "./proxy";

type Handler = (req: { nextUrl: URL; auth: unknown }) => Response | undefined;
const run = (path: string, roles?: string[]) =>
  (proxy as unknown as Handler)({
    nextUrl: new URL(path, "https://trackie.test"),
    auth: roles ? { user: { roles } } : null,
  });

describe("proxy on /api/delivery/*", () => {
  it("answers 401 JSON, not a redirect, without a session", async () => {
    for (const p of ["/api/delivery/programs/1/files", "/api/delivery/files/2"]) {
      const res = run(p)!;
      expect(res.status).toBe(401);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("answers 404 JSON for users with no area role", async () => {
    for (const roles of [[], ["viewer"]]) {
      const res = run("/api/delivery/files/2", roles)!;
      expect(res.status).toBe(404);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.json()).toEqual({ error: "Not found" });
    }
  });

  it("lets area-role users through to the route", () => {
    expect(run("/api/delivery/files/2", ["delivery"])).toBeUndefined();
  });
});

describe("proxy on other paths", () => {
  it("still redirects to /login without a session", () => {
    const res = run("/dashboard")!;
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("still redirects role-less users to /team, and leaves self-service alone", () => {
    const res = run("/dashboard", ["viewer"])!;
    expect(new URL(res.headers.get("location")!).pathname).toBe("/team");
    expect(run("/me/leave", ["viewer"])).toBeUndefined();
  });

  it("does not treat a lookalike path as the delivery API", () => {
    const res = run("/api/deliveryx", ["viewer"])!;
    expect(res.status).toBe(307);
  });
});
