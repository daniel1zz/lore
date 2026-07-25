/**
 * Tests for the conditional `Secure` cookie-attribute hardening on
 * POST /api/auth/local-bootstrap's Set-Cookie response.
 * Source: SPEC-016 §3.2 hardening — the lore_sid cookie previously never carried `Secure`,
 * so it would be sent over plain http even in a non-loopback / reverse-proxied-HTTPS
 * deployment. `Secure` is now added whenever the request is HTTPS (directly or via
 * `X-Forwarded-Proto`) OR the request's hostname is not loopback — and omitted for
 * loopback plain-http requests so `lore dashboard` on localhost keeps working (Secure
 * cookies are silently dropped by browsers over plain http).
 *
 * Calls `handleLocalBootstrap` directly with crafted `Request` objects rather than a real
 * network `Bun.serve` round-trip — deterministic control over URL scheme/hostname and
 * `X-Forwarded-Proto`, which a real loopback-bound test server cannot easily vary.
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - non-loopback https:// URL → Set-Cookie includes "; Secure"
 *
 *   NEGATIVE:
 *     - n/a (covered by boundary/regression below — this is a binary attribute)
 *
 *   BOUNDARY:
 *     - loopback http:// URL (localhost) → Set-Cookie does NOT include "; Secure" (regression:
 *       must not break local `lore dashboard` dev flow)
 *     - loopback http:// URL + X-Forwarded-Proto: https → Set-Cookie includes "; Secure"
 *       (HTTPS signal wins even on loopback)
 *     - non-loopback http:// URL + X-Forwarded-Proto: http (explicit) → Set-Cookie still
 *       includes "; Secure" (non-loopback host alone is sufficient — OR semantics)
 *     - 127.0.0.1 and ::1 are also treated as loopback (not just "localhost")
 *
 *   ERROR:
 *     - n/a: no IO failure path exercises this branch differently
 *
 *   STATE:
 *     - n/a: cookie flag is computed per-request, no persisted state
 *
 *   REGRESSION:
 *     - all other Set-Cookie attributes (HttpOnly, SameSite=Strict, Path=/api,
 *       Max-Age=2592000) are unchanged regardless of Secure
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleLocalBootstrap } from "../../../../src/adapters/http/routes.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../../../src/adapters/http/machine-auth.js";

// ─── Test setup ───────────────────────────────────────────────────────────────

/**
 * SPEC-078 D1 — handleLocalBootstrap validates X-Lore-Token against the MACHINE-SCOPE
 * api_keys table and takes no `App` parameter at all anymore, so this fixture needs
 * nothing but a machine auth store. mkdtemp per call — never the real XDG state path
 * (root CLAUDE.md 2026-07-07 pollution-incident rule).
 */
async function makeTestApp(): Promise<{ rawKey: string; machineAuth: MachineAuthStores }> {
  const machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-bootstrap-secure-test-")) });

  const createResult = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
  if (!createResult.ok) throw new Error("Failed to create API key");

  return { rawKey: createResult.value.rawKey, machineAuth };
}

function makeBootstrapReq(url: string, extraHeaders: Record<string, string> = {}, rawKey = ""): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "X-Lore-Token": rawKey,
      Origin: "http://localhost:5173",
      ...extraHeaders,
    },
  });
}

// ─── isSecureRequestContext (via handleLocalBootstrap's Set-Cookie) ────────────

describe("POST /api/auth/local-bootstrap — Secure cookie attribute", () => {
  describe("happy path", () => {
    it("adds Secure for a non-loopback https:// URL", async () => {
      const { rawKey, machineAuth } = await makeTestApp();
      const req = makeBootstrapReq("https://lore.example.com/api/auth/local-bootstrap", {}, rawKey);
      const res = await handleLocalBootstrap(req, machineAuth);
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).not.toBeNull();
      expect(setCookie).toContain("; Secure");
    });
  });

  describe("boundary values", () => {
    it("does NOT add Secure for loopback (localhost) plain http", async () => {
      const { rawKey, machineAuth } = await makeTestApp();
      const req = makeBootstrapReq("http://localhost:8787/api/auth/local-bootstrap", {}, rawKey);
      const res = await handleLocalBootstrap(req, machineAuth);
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).not.toBeNull();
      expect(setCookie).not.toContain("Secure");
    });

    it("does NOT add Secure for loopback 127.0.0.1 plain http", async () => {
      const { rawKey, machineAuth } = await makeTestApp();
      const req = makeBootstrapReq("http://127.0.0.1:8787/api/auth/local-bootstrap", {}, rawKey);
      const res = await handleLocalBootstrap(req, machineAuth);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).not.toContain("Secure");
    });

    it("does NOT add Secure for loopback ::1 plain http", async () => {
      const { rawKey, machineAuth } = await makeTestApp();
      const req = makeBootstrapReq("http://[::1]:8787/api/auth/local-bootstrap", {}, rawKey);
      const res = await handleLocalBootstrap(req, machineAuth);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).not.toContain("Secure");
    });

    it("adds Secure for loopback http when X-Forwarded-Proto: https (HTTPS signal wins)", async () => {
      const { rawKey, machineAuth } = await makeTestApp();
      const req = makeBootstrapReq(
        "http://localhost:8787/api/auth/local-bootstrap",
        { "X-Forwarded-Proto": "https" },
        rawKey,
      );
      const res = await handleLocalBootstrap(req, machineAuth);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("; Secure");
    });

    it("adds Secure for a non-loopback host even with X-Forwarded-Proto: http (non-loopback alone is sufficient)", async () => {
      const { rawKey, machineAuth } = await makeTestApp();
      const req = makeBootstrapReq(
        "http://lore.example.com/api/auth/local-bootstrap",
        { "X-Forwarded-Proto": "http" },
        rawKey,
      );
      const res = await handleLocalBootstrap(req, machineAuth);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("; Secure");
    });
  });

  describe("regression", () => {
    it("keeps HttpOnly, SameSite=Strict, Path=/api, Max-Age=2592000 regardless of Secure", async () => {
      const { rawKey, machineAuth } = await makeTestApp();
      const req = makeBootstrapReq("https://lore.example.com/api/auth/local-bootstrap", {}, rawKey);
      const res = await handleLocalBootstrap(req, machineAuth);
      const setCookie = res.headers.get("Set-Cookie");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).toContain("Path=/api");
      expect(setCookie).toContain("Max-Age=2592000");
    });
  });
});
