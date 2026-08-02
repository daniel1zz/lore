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
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import { buildResumeFeed } from "../../src/flows/feed-flow.js";
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

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR });

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

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR });

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

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR });

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

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR });

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

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feed).toContain(RESUME_COVERAGE_FLOOR);
  });

  it("session id set, marker file present but corrupt JSON -> RESUME_COVERAGE_FLOOR present, never throws", async () => {
    process.env["CLAUDE_CODE_SESSION_ID"] = testSessionId;
    writeFileSync(markerPath, "{ not valid json", "utf8");

    const record = buildRecord(ORCHESTRATOR_EXTRA, HANDOFF_CREATED_AT);
    const resumeResult: ResumeResult = { found: true, handoff: record, multi_actor: false, readiness: null };

    const result = await buildResumeFeed(stubApp(resumeResult), { handoff: record.handoff_slug, by: CURRENT_ACTOR });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feed).toContain(RESUME_COVERAGE_FLOOR);
  });
});
