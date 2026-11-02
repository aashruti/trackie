import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/config", () => ({ auth: (handler: unknown) => handler }));

import { config } from "@/proxy";
import { isPreviewDeployment, signatureAssetBase } from "./base-url";

describe("auth proxy and signature images", () => {
  const guarded = (path: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(path));

  it("leaves signature images public, because mail clients have no session", () => {
    expect(guarded("/signature/datagami-logo.png")).toBe(false);
    expect(guarded("/signature/edudron-icon.png")).toBe(false);
    expect(guarded("/signature/ibm-ice.png")).toBe(false);
  });

  it("still guards the signature page", () => {
    expect(guarded("/me/signature")).toBe(true);
    expect(guarded("/dashboard")).toBe(true);
  });
});

describe("signatureAssetBase", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses a preview deployment's own host", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "trackie-abc.vercel.app");
    vi.stubEnv("APP_URL", "https://trackie.example");
    expect(isPreviewDeployment()).toBe(true);
    expect(await signatureAssetBase()).toBe("https://trackie-abc.vercel.app");
  });

  it("uses the canonical address on production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_URL", "trackie-abc.vercel.app");
    vi.stubEnv("APP_URL", "https://trackie.example/");
    expect(isPreviewDeployment()).toBe(false);
    expect(await signatureAssetBase()).toBe("https://trackie.example");
  });
});
