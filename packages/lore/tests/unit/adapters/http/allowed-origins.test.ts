/**
 * Tests for `buildAllowedOrigins` and its derived `ALLOWED_ORIGINS` default.
 * Source: task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173 — the origin
 * allowlist previously hardcoded 5173/8787; a non-default `--dashboard-port` (or Vite
 * auto-increment) desynced from it and 403'd the dashboard bootstrap request. This suite
 * pins the pure builder that fixes that: the allowlist is now a FUNCTION of the actual
 * configured ports, and the default constant is derived from that same function.
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - buildAllowedOrigins(9000, 6000) → exactly the 4 localhost/127.0.0.1 origins for
 *       ports 9000 and 6000 (AC 1 — the non-default-port case the bug report needs)
 *
 *   NEGATIVE:
 *     - buildAllowedOrigins(9000, 6000) does NOT contain any port-5173/8787 origin (a
 *       custom-port allowlist must not silently retain the old defaults)
 *
 *   BOUNDARY:
 *     - apiPort === dashPort → still returns 4 entries (duplicates allowed — `.includes()`
 *       correctness does not depend on uniqueness)
 *     - port boundary values 1 and 65535 produce well-formed origin strings
 *
 *   ERROR:
 *     - n/a — pure function, no IO/throwing path
 *
 *   STATE:
 *     - n/a — pure function, no persisted state
 *
 *   REGRESSION:
 *     - default 8787/5173 → today's four origins, byte-identical AS A SET to the
 *       pre-existing hand-written ALLOWED_ORIGINS literal (AC 1's regression clause)
 *     - the exported ALLOWED_ORIGINS constant is itself buildAllowedOrigins(8787, 5173) —
 *       not a second, independently hand-maintained literal
 *
 * @spec_ref task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173 AC-1
 */

import { describe, expect, it } from "vitest";
import { ALLOWED_ORIGINS, buildAllowedOrigins } from "../../../../src/adapters/http/auth.js";

// The pre-fix hand-written literal this suite pins as the REGRESSION baseline.
const PRE_FIX_DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:8787",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8787",
];

describe("buildAllowedOrigins", () => {
  describe("happy path", () => {
    it("returns exactly the 4 localhost/127.0.0.1 origins for a custom apiPort/dashPort pair", () => {
      const result = buildAllowedOrigins(9000, 6000);
      expect(new Set(result)).toEqual(
        new Set([
          "http://localhost:9000",
          "http://localhost:6000",
          "http://127.0.0.1:9000",
          "http://127.0.0.1:6000",
        ]),
      );
      expect(result).toHaveLength(4);
    });
  });

  describe("negative cases", () => {
    it("does not retain any default-port (5173/8787) origin for a custom port pair", () => {
      const result = buildAllowedOrigins(9000, 6000);
      for (const staleOrigin of PRE_FIX_DEFAULT_ORIGINS) {
        expect(result).not.toContain(staleOrigin);
      }
    });
  });

  describe("boundary values", () => {
    it("still returns 4 entries when apiPort === dashPort (duplicates allowed)", () => {
      const result = buildAllowedOrigins(4000, 4000);
      expect(result).toHaveLength(4);
      expect(new Set(result)).toEqual(new Set(["http://localhost:4000", "http://127.0.0.1:4000"]));
    });

    it("produces well-formed origins at port boundary values 1 and 65535", () => {
      const result = buildAllowedOrigins(1, 65535);
      expect(result).toContain("http://localhost:1");
      expect(result).toContain("http://127.0.0.1:65535");
    });
  });

  describe("regression", () => {
    it("buildAllowedOrigins(8787, 5173) matches the pre-fix hand-written default set exactly", () => {
      const result = buildAllowedOrigins(8787, 5173);
      expect(new Set(result)).toEqual(new Set(PRE_FIX_DEFAULT_ORIGINS));
    });

    it("ALLOWED_ORIGINS (the exported default) matches the pre-fix hand-written literal exactly", () => {
      expect(new Set(ALLOWED_ORIGINS)).toEqual(new Set(PRE_FIX_DEFAULT_ORIGINS));
      expect(ALLOWED_ORIGINS).toHaveLength(4);
    });

    it("ALLOWED_ORIGINS is derived from buildAllowedOrigins(8787, 5173), not a second literal", () => {
      expect(new Set(ALLOWED_ORIGINS)).toEqual(new Set(buildAllowedOrigins(8787, 5173)));
    });
  });
});
