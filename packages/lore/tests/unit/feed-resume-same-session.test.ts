/**
 * Integration suite for `buildResumeFeed`'s same-session-authorship wiring
 * (`packages/lore/src/flows/feed-flow.ts`) —
 * task-verifying-a-handoff-you-just-authored-arms-the-coverage D1, D2.
 *
 * Scope: this file exercises the FULL wiring `renderResumeFeed`'s own unit
 * suite (`feed-resume-coverage.test.ts`) cannot reach — the IO half:
 * `buildResumeFeed` reading `CLAUDE_CODE_SESSION_ID`/`CLAUDE_SESSION_ID` +
 * the SessionStart hook's `os.tmpdir()` marker file, resolving the current
 * actor, and feeding both into `isSameSessionAuthorship` (`@lore/core`) to
 * decide `suppressFloor`. A stub `App` (`sessionService.resume` returning a
 * fixed `ResumeResult`) stands in for the corpus — no real store, no
 * compiled binary, matching this repo's own "exercise the pure/composed
 * function directly" precedent (`flows/feed-flow-resume-closure.test.ts`'s
 * own module header).
 *
 * RED-before-GREEN (verification-discipline): every case below was run
 * against the pre-fix `renderResumeFeed(resume)`/`buildResumeFeed` (single
 * fixed argument, no `suppressFloor` concept, no marker read) via a targeted
 * `git stash` of `session.ts`+`feed-flow.ts` — the RED scenario failed
 * (floor present) exactly as the motivating incident describes; restoring
 * the fix turns it green. See this task's final report for the exact
 * commands run.
 *
 * Six-dimension coverage:
 *   HAPPY:      RED scenario — same actor, marker started BEFORE the
 *               handoff was created (verifying my own just-authored ticket)
 *               -> RESUME_COVERAGE_FLOOR withheld
 *   NEGATIVE:   CONTROL 5 — a DIFFERENT actor's handoff, same session
 *               marker -> floor PRESENT, with the SAME item ids (KD/NS)
 *               asserted, not merely "something armed"
 *   BOUNDARY:   CONTROL 6 — same actor, but the marker started AFTER the
 *               handoff's created_at (a genuinely earlier session's ticket,
 *               now being resumed in a NEW session) -> floor PRESENT
 *   ERROR:      N/A at this layer — `buildResumeFeed`'s own error path
 *               (unresolvable --plan/--handoff) is pre-existing coverage,
 *               untouched by this task
 *   STATE:      Q2 fail-safe — no CLAUDE_CODE_SESSION_ID/CLAUDE_SESSION_ID
 *               env var at all -> floor PRESENT (unknown boundary arms)
 *   REGRESSION: Q2 fail-safe — session id present but the marker file is
 *               missing, and separately, present-but-corrupt-JSON -> floor
 *               PRESENT in both cases; never silently treated as a match
 *
 * @spec_ref task-verifying-a-handoff-you-just-authored-arms-the-coverage
 *   §Candidate predicates (2); §Oracle; AC 2, 3, 5, 6
 *
 * ─── Extension (task-the-session-start-marker-collapses-five-distinct) ─────
 *
 * The five describe blocks above only ever asserted `toContain(RESUME_COVERAGE_FLOOR)`
 * for the non-measured kinds — proving the ARMING VERDICT, never that the
 * mechanism's total absence was OBSERVABLE. The blocks below extend this
 * same file to assert the KIND VALUE is now surfaced in the rendered feed
 * text (which is also what `--json` embeds, via `ResumeFeedOutcome.feed`),
 * and that the `"unreadable"` kind additionally writes a stderr line.
 *
 * RED-before-GREEN: run directly against `readSessionStartIso`
 * (`packages/lore/tests/unit/flows/session-start-read.test.ts` — 11/11 RED
 * with `TypeError: (0 , readSessionStartIso) is not a function` against the
 * pre-fix source, restored via `git show <prev-commit>` + `cp`, never a
 * destructive git operation). This file's additions below were verified
 * GREEN against the fix; see this task's final report for the exact
 * commands.
 *
 * Six-dimension coverage (this extension):
 *   HAPPY:      AC 5 CONTROL — measured + matching actor -> floor still
 *               suppressed, output BYTE-IDENTICAL to `renderResumeFeed`
 *               called directly (never through the note-carrying path)
 *   NEGATIVE:   AC 4a — no session-id env var -> feed carries the
 *               "no-session-id" kind literal in its one-line note
 *   BOUNDARY:   AC 4b — session id set, marker absent -> feed carries the
 *               "no-marker" kind literal, DISTINCT from "no-session-id"'s
 *               note text
 *   ERROR:      AC 4c/4d — marker with a wrong-typed `started_at` and,
 *               separately, a marker with invalid JSON -> both surface the
 *               "unreadable" kind literal AND emit a stderr line (asserted
 *               via a `process.stderr.write` spy) — the two are asserted as
 *               SEPARATE test cases (different code paths)
 *   STATE:      the note is INSERTED BEFORE `RESUME_COVERAGE_FLOOR` and
 *               `RESUME_SCOPE_CLOSURE` stays the trailing block — the
 *               pre-existing ordering invariant is undisturbed by the new
 *               block
 *   REGRESSION: AC 2 — the measured/suppressed CONTROL path never carries
 *               the authorship-undetermined note, proving the two paths
 *               (measured vs non-measured) are mutually exclusive in the
 *               rendered output, not merely in the internal boolean
 *
 * @spec_ref task-the-session-start-marker-collapses-five-distinct
 *   §Acceptance Criteria AC 2, 3, 4, 5, 6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ok,
  RESUME_COVERAGE_FLOOR,
  RESUME_SCOPE_CLOSURE,
  RESUME_ITEM_ID_PREFIX_KEY_DECISION,
  RESUME_ITEM_ID_PREFIX_NEXT_STEP,
  formatResumeItemId,
  renderHandoffContent,
  sessionStartMarkerFilename,
  type HandoffExtra,
} from "@lore/core";
import { buildResumeFeed, renderResumeFeed } from "../../src/flows/feed-flow.js";
import type { App } from "../../src/app.js";
import type { ResumeHandoffRecord, ResumeResult } from "../../src/service/session-service.js";

// ─── Env/marker isolation ───────────────────────────────────────────────────
// This suite mutates CLAUDE_CODE_SESSION_ID/CLAUDE_SESSION_ID and writes a
// REAL file into os.tmpdir() (buildResumeFeed's own read path has no test
// seam for either — it reads process.env/os.tmpdir() directly). Every test
// uses a FRESH, randomly-suffixed session id (never a real one) so it can
// never collide with an actual marker a live SessionStart hook might have
// written on this machine, and both env vars + the marker file are restored/
// removed after every test, pass or fail.

const ORIGINAL_CLAUDE_CODE_SESSION_ID = process.env["CLAUDE_CODE_SESSION_ID"];
const ORIGINAL_CLAUDE_SESSION_ID = process.env["CLAUDE_SESSION_ID"];

let testSessionId: string;
let markerPath: string;

function writeMarker(startedAtIso: string): void {
  writeFileSync(markerPath, JSON.stringify({ started_at: startedAtIso }), "utf8");
}

beforeEach(() => {
  testSessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  markerPath = join(tmpdir(), sessionStartMarkerFilename(testSessionId));
  delete process.env["CLAUDE_CODE_SESSION_ID"];
  delete process.env["CLAUDE_SESSION_ID"];
});

afterEach(() => {
  if (existsSync(markerPath)) rmSync(markerPath);
  if (ORIGINAL_CLAUDE_CODE_SESSION_ID === undefined) delete process.env["CLAUDE_CODE_SESSION_ID"];
  else process.env["CLAUDE_CODE_SESSION_ID"] = ORIGINAL_CLAUDE_CODE_SESSION_ID;
  if (ORIGINAL_CLAUDE_SESSION_ID === undefined) delete process.env["CLAUDE_SESSION_ID"];
  else process.env["CLAUDE_SESSION_ID"] = ORIGINAL_CLAUDE_SESSION_ID;
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ORCHESTRATOR_EXTRA: HandoffExtra = {
  by: "agent:main-orchestrator",
  plan_ref: "plan-example",
  task_refs: [],
  modified_files: [],
  key_decisions: [{ judgment: "chose X over Y" }],
  next_steps: ["verify the resume ticket is consumable"],
};

const OTHER_ACTOR_EXTRA: HandoffExtra = { ...ORCHESTRATOR_EXTRA, by: "agent:bob" };

function buildRecord(extra: HandoffExtra, createdAtIso: string): ResumeHandoffRecord {
  return {
    handoff_slug: `knowledge-handoff-${extra.by.replace(/[^a-z0-9-]/g, "-")}-1`,
    plan_slug: "plan-example",
    by: extra.by,
    at: createdAtIso,
    age_minutes: 5,
    ttl_warning: false,
    degraded: false,
    content: renderHandoffContent(extra),
  };
}

/** Stub `App` whose `sessionService.resume` always returns `resumeResult` — no store, no compiled binary (mirrors this repo's own `flows/feed-flow-resume-closure.test.ts` precedent for exercising this layer directly). */
function stubApp(resumeResult: ResumeResult): App {
  return {
    sessionService: {
      resume: async () => ok(resumeResult),
    },
  } as unknown as App;
}

const CURRENT_ACTOR = "agent:main-orchestrator";
const HANDOFF_CREATED_AT = "2026-08-01T10:05:00.000Z";

// ─── HAPPY — RED scenario ───────────────────────────────────────────────────

describe("HAPPY — RED scenario: verifying my own just-authored ticket withholds the floor", () => {
  it("same actor, session marker started BEFORE the handoff was created -> RESUME_COVERAGE_FLOOR withheld, RESUME_SCOPE_CLOSURE still present", async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = testSessionId;
    writeMarker("2026-08-01T10:00:00.000Z"); // session started before the handoff (10:05) was written

    const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
    const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feed).not.toContain(RESUME_COVERAGE_FLOOR);
    expect(result.value.feed).toContain(RESUME_SCOPE_CLOSURE);
    expect(result.value.feed).toContain(record.handoff_slug);
  });
});

// ─── NEGATIVE — CONTROL 5 ───────────────────────────────────────────────────

describe("NEGATIVE — CONTROL 5: consuming a DIFFERENT session's (different actor's) handoff still arms", () => {
  it("different actor's handoff, same current-session marker -> RESUME_COVERAGE_FLOOR present, with the SAME item ids as the RED scenario", async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = testSessionId;
    writeMarker("2026-08-01T10:00:00.000Z");

    const record = buildRecord(OTHER_ACTOR_EXTRA, HANDOFF_CREATED_AT);
    const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feed).toContain(RESUME_COVERAGE_FLOOR);
    // Assert the ITEM IDS, not merely "something armed" (task AC 5).
    expect(result.value.feed).toContain(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, 1));
    expect(result.value.feed).toContain(formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, 1));
  });
});

// ─── BOUNDARY — CONTROL 6 ───────────────────────────────────────────────────

describe("BOUNDARY — CONTROL 6: consuming a genuinely EARLIER session's own ticket still arms", () => {
  it("same actor, but this session's marker started AFTER the handoff was created -> RESUME_COVERAGE_FLOOR present", async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = testSessionId;
    // This (new) session started at 10:10 — strictly AFTER the handoff (10:05)
    // was written by an EARLIER session. Same actor as before (predicate (1)
    // alone would wrongly suppress here — this is exactly why it was rejected).
    writeMarker("2026-08-01T10:10:00.000Z");

    const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
    const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feed).toContain(RESUME_COVERAGE_FLOOR);
  });
});

// ─── STATE — Q2 fail-safe: no session id at all ─────────────────────────────

describe("STATE — Q2 fail-safe: no CLAUDE_CODE_SESSION_ID/CLAUDE_SESSION_ID at all", () => {
  it("both env vars absent -> unknown session boundary -> RESUME_COVERAGE_FLOOR present, even for the RED scenario's own actor/timing", async () => {
    // Deliberately do NOT set either env var (beforeEach already deleted both).
    const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
    const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feed).toContain(RESUME_COVERAGE_FLOOR);
  });
});

// ─── REGRESSION — Q2 fail-safe: session id present but no usable marker ────

describe("REGRESSION — Q2 fail-safe: session id present but the marker cannot be read", () => {
  it("session id set, but the hook never fired (no marker file) -> RESUME_COVERAGE_FLOOR present", async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = testSessionId;
    // Deliberately do NOT write a marker file.

    const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
    const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feed).toContain(RESUME_COVERAGE_FLOOR);
  });

  it("session id set, marker file present but corrupt JSON -> RESUME_COVERAGE_FLOOR present, never throws", async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = testSessionId;
    writeFileSync(markerPath, "{ not valid json", "utf8");

    const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
    const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feed).toContain(RESUME_COVERAGE_FLOOR);
  });
});

// ─── Extension — task-the-session-start-marker-collapses-five-distinct ────
// AC 2 (byte-identical arming), AC 3 (observability), AC 4 (kind-value
// assertions), AC 5 (measured-path byte-identity CONTROL).

// ─── HAPPY — AC 5 CONTROL ───────────────────────────────────────────────────

describe("HAPPY — AC 5 CONTROL: measured + matching actor -> output BYTE-IDENTICAL to renderResumeFeed called directly", () => {
  it("buildResumeFeed's feed equals renderResumeFeed(resume, true) exactly — no authorship note leaks into the measured/suppressed path", async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = testSessionId;
    writeMarker("2026-08-01T10:00:00.000Z"); // before the handoff (10:05) was written — same shape as the HAPPY RED scenario above

    const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
    const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // AC 5: byte-identical to "today" — calling the pure renderer directly
    // with the SAME suppressFloor value and no third argument.
    expect(result.value.feed).toBe(renderResumeFeed(resumeResult, true));
    // REGRESSION half: the measured/suppressed path never carries the
    // authorship-undetermined note — the two paths are mutually exclusive
    // in the RENDERED OUTPUT, not merely in the internal boolean.
    expect(result.value.feed).not.toContain("could not be determined");
  });
});

// ─── NEGATIVE — AC 4a ────────────────────────────────────────────────────────

describe("NEGATIVE — AC 4a: no CLAUDE_CODE_SESSION_ID/CLAUDE_SESSION_ID at all -> feed carries the no-session-id kind literal", () => {
  it('feed contains "could not be determined" and the "no-session-id" kind literal', async () => {
    // Deliberately do NOT set either env var (beforeEach already deleted both).
    const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
    const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feed).toContain("could not be determined");
    expect(result.value.feed).toContain("no-session-id");
    expect(result.value.feed).toContain(RESUME_COVERAGE_FLOOR);
  });
});

// ─── BOUNDARY — AC 4b ────────────────────────────────────────────────────────

describe("BOUNDARY — AC 4b: session id set, marker absent -> feed carries no-marker, distinct from no-session-id", () => {
  it('feed contains the "no-marker" kind literal and NOT "no-session-id"', async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = testSessionId;
    // Deliberately do NOT write a marker file.

    const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
    const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feed).toContain("no-marker");
    expect(result.value.feed).not.toContain("no-session-id");
    expect(result.value.feed).toContain(RESUME_COVERAGE_FLOOR);
  });
});

// ─── ERROR — AC 4c / AC 4d, distinct code paths, each with a stderr line ────

describe("ERROR — AC 4c: marker with a wrong-typed started_at -> unreadable kind surfaced + stderr line", () => {
  it('feed contains "unreadable" and process.stderr.write was called naming the marker as unreadable', async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = testSessionId;
    writeFileSync(markerPath, JSON.stringify({ started_at: 12345 }), "utf8");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
      const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

      const result = await buildResumeFeed(stubApp(resumeResult), {
        handoff: record.handoff_slug,
        by: CURRENT_ACTOR,
      }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.feed).toContain("unreadable");
      expect(result.value.feed).toContain(RESUME_COVERAGE_FLOOR);
      expect(stderrSpy).toHaveBeenCalled();
      const stderrText = stderrSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(stderrText).toContain("session-start marker unreadable");
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe("ERROR — AC 4d: marker with invalid JSON -> unreadable kind surfaced + stderr line (DIFFERENT code path from AC 4c)", () => {
  it('feed contains "unreadable" and process.stderr.write was called naming the marker as unreadable', async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = testSessionId;
    writeFileSync(markerPath, "{ not valid json", "utf8");

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
      const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

      const result = await buildResumeFeed(stubApp(resumeResult), {
        handoff: record.handoff_slug,
        by: CURRENT_ACTOR,
      }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.feed).toContain("unreadable");
      expect(result.value.feed).toContain(RESUME_COVERAGE_FLOOR);
      expect(stderrSpy).toHaveBeenCalled();
      const stderrText = stderrSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(stderrText).toContain("session-start marker unreadable");
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

// ─── STATE — ordering: note before floor, closure stays trailing ───────────

describe("STATE — the authorship note is inserted BEFORE RESUME_COVERAGE_FLOOR, and RESUME_SCOPE_CLOSURE stays the trailing block", () => {
  it("ordering: note index < floor index < closure index; RESUME_SCOPE_CLOSURE remains the LAST block", async () => {
    // No session id set -> non-measured, note + floor both present.
    const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
    const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR }, { env: process.env, tmpDir: tmpdir(), cwd: process.cwd() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const feed = result.value.feed;
    const noteIdx = feed.indexOf("could not be determined");
    const floorIdx = feed.indexOf(RESUME_COVERAGE_FLOOR);
    const closureIdx = feed.indexOf(RESUME_SCOPE_CLOSURE);
    expect(noteIdx).toBeGreaterThanOrEqual(0);
    expect(floorIdx).toBeGreaterThan(noteIdx);
    expect(closureIdx).toBeGreaterThan(floorIdx);
    expect(feed.endsWith(RESUME_SCOPE_CLOSURE)).toBe(true);
  });
});
