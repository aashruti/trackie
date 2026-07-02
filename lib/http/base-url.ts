import "server-only";

import { headers } from "next/headers";

/**
 * The canonical origin for building links in emails (verification, etc.).
 *
 * SECURITY: never trust the request Host header for emailed links — a spoofed
 * Host could point a valid token at an attacker domain. Prefer a trusted source:
 *   1. APP_URL (explicit override)
 *   2. VERCEL_PROJECT_PRODUCTION_URL (Vercel-set canonical prod domain — not client-controllable)
 *   3. the request host — ONLY as a localhost/dev fallback.
 */
export async function appBaseUrl(): Promise<string> {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return `https://${vercelProd.replace(/\/+$/, "")}`;

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
