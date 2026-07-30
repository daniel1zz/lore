/**
 * Unit tests for `renderResumeFeed`'s D3 scope-closure block
 * (`packages/lore/src/flows/feed-flow.ts`) —
 * spec-context-provenance-injected-corpus-global-state-and-a §Design Decisions
 * D3, task task-t3-scope-closure-on-the-resume-ticket-cli-stdout-and-mcp.
 *
 * Scope: exercises the PURE render function directly against synthetic
 * `ResumeResult` fixtures — no store, no App, no MCP/CLI wrapper. This is the
 * most direct oracle for the closure mechanics themselves; the MCP-level proof
 * (`tests/unit/adapters/mcp-session-tools.test.ts`) and the CLI-stdout proof
 * (`tests/integration/cli-feed-task-start.bun.test.ts`) each additionally
 * confirm the SAME rendered string reaches their own surface unmodified,
 * per the module's own "closure woven in at exactly ONE place" invariant.
 *
 * Every assertion pins IDENTITY against the exported `RESUME_SCOPE_CLOSURE`
 * constant (D6) — never a remembered substring — and iterates the exported
 * `BOOTSTRAP_INJECTION_KNOWN_KEYS` set to assert the constant names each
 * member, so a future field added to that set fails this suite until
 * `RESUME_SCOPE_CLOSURE` (derived from it in `@lore/core`) is regenerated.
 *
 * Coverage:
 *   HAPPY:      a found, single-actor resume result's rendered feed ends with
 *               `RESUME_SCOPE_CLOSURE` (identity), after the ticket content
 *   BOUNDARY:   `found: false` → feed is the exact `"(no handoff recorded)"`
 *               advisory note, byte-for-byte, and does NOT carry the closure
 *               (there is no ticket to close scope on — pins the pre-existing
 *               CLI regression test's expectation, cli-feed-task-start.bun.test.ts)
 *   NEGATIVE:   `found: true` but the `handoff` field is (defensively) absent
 *               and `multi_actor` is false → same "(no handoff recorded)"
 *               fallback, no closure (mirrors the pre-existing defensive branch)
 *   STATE:      a live readiness pointer renders BETWEEN the ticket content and
 *               the closure block — the closure is always the LAST block
 *   REGRESSION: a multi-actor result also carries the closure exactly once;
 *               `RESUME_SCOPE_CLOSURE` names every `BOOTSTRAP_INJECTION_KNOWN_KEYS`
 *               member (iterated, one assertion per member)
 *
 * @spec_ref spec-context-provenance-injected-corpus-global-state-and-a §Design
 *   Decisions D3; AC-CP-4
 */

import { describe, it, expect } from "vitest";
import { BOOTSTRAP_INJECTION_KNOWN_KEYS, RESUME_SCOPE_CLOSURE } from "@lore/core";
import { renderResumeFeed } from "../../../src/flows/feed-flow.js";
import type { ResumeHandoffRecord, ResumeResult } from "../../../src/service/session-service.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const RECORD: ResumeHandoffRecord = {
  handoff_slug: "knowledge-handoff-agent-alice-1",
  plan_slug: "plan-example",
  by: "agent:alice",
  at: "2026-07-30T00:00:00.000Z",
  age_minutes: 5,
  ttl_warning: false,
  degraded: false,
  content: "next_steps: wire the closure block",
};

const OTHER_RECORD: ResumeHandoffRecord = {
  ...RECORD,
  handoff_slug: "knowledge-handoff-agent-bob-1",
  by: "agent:bob",
};

const FOUND_SINGLE: ResumeResult = {
  found: true,
  handoff: RECORD,
  multi_actor: false,
  readiness: null,
};

const FOUND_MULTI: ResumeResult = {
  found: true,
  handoffs: [RECORD, OTHER_RECORD],
  multi_actor: true,
  readiness: null,
};

const NOT_FOUND: ResumeResult = {
  found: false,
  multi_actor: false,
  readiness: null,
};

const FOUND_WITH_READINESS: ResumeResult = {
  found: true,
  handoff: RECORD,
  multi_actor: false,
  readiness: { plan_slug: "plan-example", total: 4, ready: 2, claimed: 1, done: 1 },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("renderResumeFeed — D3 scope closure", () => {
  describe("HAPPY", () => {
    it("a found, single-actor result ends with RESUME_SCOPE_CLOSURE (identity), after the ticket content", () => {
      const feed = renderResumeFeed(FOUND_SINGLE);

      expect(feed).toContain(RECORD.content);
      expect(feed.endsWith(RESUME_SCOPE_CLOSURE)).toBe(true);
      // reason: identity, not substring-from-memory (D6) — the tail of the
      // rendered feed IS the constant, not a paraphrase of it.
      const closureStart = feed.length - RESUME_SCOPE_CLOSURE.length;
      expect(feed.slice(closureStart)).toBe(RESUME_SCOPE_CLOSURE);
    });
  });

  describe("BOUNDARY", () => {
    it("found: false -> exact '(no handoff recorded)', no closure appended", () => {
      const feed = renderResumeFeed(NOT_FOUND);

      expect(feed).toBe("(no handoff recorded)");
      expect(feed).not.toContain(RESUME_SCOPE_CLOSURE);
      expect(feed).not.toContain("SCOPE CLOSURE");
    });
  });

  describe("NEGATIVE", () => {
    it("found: true, multi_actor: false, but handoff absent -> defensive '(no handoff recorded)' fallback, no closure", () => {
      const malformed: ResumeResult = { found: true, multi_actor: false, readiness: null };
      const feed = renderResumeFeed(malformed);

      expect(feed).toBe("(no handoff recorded)");
      expect(feed).not.toContain(RESUME_SCOPE_CLOSURE);
    });
  });

  describe("STATE", () => {
    it("a live readiness pointer renders between the ticket content and the closure — closure is always LAST", () => {
      const feed = renderResumeFeed(FOUND_WITH_READINESS);

      const contentIdx = feed.indexOf(RECORD.content);
      const readinessIdx = feed.indexOf("── Readiness ──");
      const closureIdx = feed.indexOf(RESUME_SCOPE_CLOSURE);

      expect(contentIdx).toBeGreaterThanOrEqual(0);
      expect(readinessIdx).toBeGreaterThan(contentIdx);
      expect(closureIdx).toBeGreaterThan(readinessIdx);
      // reason: the closure block appears exactly once, as the final segment.
      expect(feed.endsWith(RESUME_SCOPE_CLOSURE)).toBe(true);
    });
  });

  describe("REGRESSION", () => {
    it("a multi-actor result also carries the closure exactly once", () => {
      const feed = renderResumeFeed(FOUND_MULTI);

      expect(feed).toContain(RECORD.handoff_slug);
      expect(feed).toContain(OTHER_RECORD.handoff_slug);
      expect(feed.endsWith(RESUME_SCOPE_CLOSURE)).toBe(true);
      // reason: split on the constant — exactly 2 parts means exactly 1 occurrence.
      expect(feed.split(RESUME_SCOPE_CLOSURE)).toHaveLength(2);
    });

    it("RESUME_SCOPE_CLOSURE names every BOOTSTRAP_INJECTION_KNOWN_KEYS member (iterated, one assertion per member)", () => {
      expect(BOOTSTRAP_INJECTION_KNOWN_KEYS.size).toBeGreaterThan(0);
      for (const key of BOOTSTRAP_INJECTION_KNOWN_KEYS) {
        expect(RESUME_SCOPE_CLOSURE.includes(key)).toBe(true);
      }
    });
  });
});
