/**
 * Unit tests for HTTP middleware helpers — CORS origin echoing (SPEC-027 AC-DH-5) and
 * baseline JSON envelope helpers.
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - isOriginAllowed returns true for each ALLOWED_ORIGINS entry
 *     - corsPreflightResponse echoes an allowlisted origin + sets Vary: Origin
 *     - applyCorsOrigin adds Allow-Origin + Vary to a response when origin is allowlisted
 *
 *   NEGATIVE:
 *     - isOriginAllowed returns false for an arbitrary disallowed origin
 *     - corsPreflightResponse omits Allow-Origin for a disallowed origin
 *     - applyCorsOrigin returns headers unchanged for a disallowed origin
 *
 *   BOUNDARY:
 *     - isOriginAllowed returns false for null (no Origin header)
 *     - applyCorsOrigin returns headers unchanged for null origin
 *
 *   ERROR:
 *     - n/a: these are pure functions with no fallible IO
 *
 *   STATE:
 *     - n/a: pure functions, no persisted state
 *
 *   REGRESSION:
 *     - corsHeaders() never contains an Access-Control-Allow-Origin key (base headers are
 *       origin-agnostic; the wildcard hardcode this test guards against is gone for good)
 *     - jsonOk / jsonError responses never carry a wildcard Allow-Origin header
 *
 * @spec_ref AC-DH-5
 */

import { describe, expect, it } from "vitest";
import {
  corsHeaders,
  isOriginAllowed,
  corsPreflightResponse,
  applyCorsOrigin,
  jsonOk,
  jsonError,
} from "../../../../src/adapters/http/middleware.js";
import { ALLOWED_ORIGINS } from "../../../../src/adapters/http/auth.js";

describe("isOriginAllowed", () => {
  it("returns true for every ALLOWED_ORIGINS entry (happy path)", () => {
    for (const origin of ALLOWED_ORIGINS) {
      expect(isOriginAllowed(origin)).toBe(true);
    }
  });

  it("returns false for a disallowed origin (negative)", () => {
    expect(isOriginAllowed("http://evil.example")).toBe(false);
  });

  it("returns false for null (boundary: no Origin header)", () => {
    expect(isOriginAllowed(null)).toBe(false);
  });
});

describe("corsHeaders", () => {
  it("never includes Access-Control-Allow-Origin (regression: no hardcoded wildcard)", () => {
    const headers = corsHeaders({ "Content-Type": "application/json" });
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("still exposes Allow-Methods and Allow-Headers (baseline unchanged)", () => {
    const headers = corsHeaders();
    expect(headers["Access-Control-Allow-Methods"]).toContain("GET");
    expect(headers["Access-Control-Allow-Headers"]).toContain("Authorization");
  });
});

describe("corsPreflightResponse", () => {
  it("echoes an allowlisted origin + sets Vary: Origin (happy path)", () => {
    const res = corsPreflightResponse(ALLOWED_ORIGINS[0]);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGINS[0]);
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("omits Allow-Origin for a disallowed origin (negative)", () => {
    const res = corsPreflightResponse("http://evil.example");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("omits Allow-Origin for null origin (boundary)", () => {
    const res = corsPreflightResponse(null);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("applyCorsOrigin", () => {
  it("adds Allow-Origin + Vary when origin is allowlisted (happy path)", () => {
    const base = jsonOk({ hello: "world" });
    const wrapped = applyCorsOrigin(base, ALLOWED_ORIGINS[0]);
    expect(wrapped.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGINS[0]);
    expect(wrapped.headers.get("Vary")).toContain("Origin");
    expect(wrapped.status).toBe(200);
  });

  it("leaves headers unchanged for a disallowed origin (negative)", () => {
    const base = jsonError({ code: "NOT_FOUND", message: "nope" }, 404);
    const wrapped = applyCorsOrigin(base, "http://evil.example");
    expect(wrapped.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(wrapped.status).toBe(404);
  });

  it("leaves headers unchanged for null origin (boundary)", () => {
    const base = jsonOk({ ok: true });
    const wrapped = applyCorsOrigin(base, null);
    expect(wrapped.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("never produces a wildcard Allow-Origin regardless of input (regression)", () => {
    for (const origin of [ALLOWED_ORIGINS[0], "http://evil.example", null]) {
      const wrapped = applyCorsOrigin(jsonOk({}), origin);
      expect(wrapped.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    }
  });
});
