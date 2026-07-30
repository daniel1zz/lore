/**
 * `lore handoff coverage-check` (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 * D6, D8, D9, D10) — the SOLE parser of the rendered resume-ticket grammar and
 * the disposition-line grammar; task
 * task-t3-turn-state-ticket-recording-stop-handoff-coverage-hook (T3).
 *
 * Spawns the LIVE source CLI (`bun run src/index.ts handoff coverage-check`,
 * mirroring `adapters/cli-strict-flags-incidents.test.ts`'s proven subprocess
 * pattern) rather than importing `commands/handoff.ts` directly — that file
 * transitively imports `loader.ts` (`bun:sqlite`), unresolvable by vitest.
 * The verb needs no corpus at all (pure transcript/stdin parsing, D8's "zero
 * cross-process state"), so no `lore init` / temp corpus is required — only a
 * throwaway transcript JSONL file per test.
 *
 * Fixtures are REAL renders, never hand-typed ticket text: `renderHandoffContent`
 * (T1) + `renderResumeFeed` (T2, `../../src/flows/feed-flow.js`) produce the
 * exact ticket text this build emits, wrapped into the MEASURED transcript
 * shape (`type:"user"`, `message.content[]` holding a `tool_result` block —
 * verified 2026-07-30 against real transcripts under
 * `~/.claude/projects/-Users-apple-Projects-zz-lore/`, DELIBERATELY NOT the
 * `type:"assistant"` shape `stop-doc-sync.mjs` uses for text blocks, since a
 * ticket is a TOOL's stdout, a different entry type). Every expected item id
 * is derived via `formatResumeItemId` over the fixture's own array lengths —
 * never a literal "KD1"/"NS2" string — per D1/D7's contiguous-substring
 * false-oracle discipline.
 *
 * Six-dimension coverage:
 *   HAPPY:      AC-RC-7 full-coverage half (every id dispositioned -> exit 0);
 *               AC-RC-12 positive half (multi-actor transcript -> exit 0)
 *   NEGATIVE:   AC-RC-7 incomplete half (omitted subset -> non-zero, stderr id
 *               set SET-EQUAL to the omission, naming extra/fewer ids fails);
 *               AC-RC-12 control half (single-record incomplete -> non-zero,
 *               proving the multi-actor exit-0 isn't "found no ticket at all")
 *   BOUNDARY:   AC-RC-7 no-ticket half (transcript with no rendered ticket ->
 *               exit 0); a degenerate zero-decisions ticket (D5 "degraded"
 *               semantics, counted by actual array length) fully dispositioned
 *               -> exit 0
 *   ERROR:      malformed/empty stdin -> exit 0, never a crash; unreadable
 *               transcript_path -> exit 0 (both degrade to D6's "no ticket")
 *   STATE:      AC-RC-9 round-trip — the verb recovers exactly the id set
 *               derived from the fixture's OWN array lengths, computed via
 *               `formatResumeItemId`, never compared against a literal list
 *   REGRESSION: the new leading positional does not disturb the pre-existing
 *               write path's flag validation (missing `--next` still exits 2
 *               with the same message, unaffected by `args.subcommand`)
 *
 * @spec_ref spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 *   §Design Decisions D1, D5, D6, D7, D8, D9, D10; AC-RC-7, AC-RC-9, AC-RC-12
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  renderHandoffContent,
  RESUME_DISPOSITION_MARKER,
  RESUME_DISPOSITION_DONE,
  RESUME_DISPOSITION_DEFERRED_PREFIX,
  RESUME_ITEM_ID_PREFIX_KEY_DECISION,
  RESUME_ITEM_ID_PREFIX_NEXT_STEP,
  formatResumeItemId,
  type HandoffExtra,
} from "@lore/core";
import { renderResumeFeed } from "../../src/flows/feed-flow.js";
import type { ResumeHandoffRecord, ResumeResult } from "../../src/service/session-service.js";

// tests/unit/ -> packages/lore/
const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── Subprocess helpers ─────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns `bun run src/index.ts handoff coverage-check`, piping `payload` (JSON-stringified, or the raw string if already a string) as stdin. */
function runCoverageCheck(payload: unknown): RunResult {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const result = spawnSync("bun", ["run", INDEX_TS, "handoff", "coverage-check"], {
    input,
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

/** Spawns `bun run src/index.ts handoff <extraArgs>` — used only by the REGRESSION check on the default write path. */
function runHandoffWrite(extraArgs: string[]): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, "handoff", ...extraArgs], { encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

/**
 * Writes a one-line transcript JSONL file wrapping `toolResultText` in the
 * MEASURED real shape: `type:"user"`, `message.content[]` holding a
 * `{type:"tool_result", content}` block. Returns the file path.
 */
function writeToolResultTranscript(dir: string, toolResultText: string): string {
  const line = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ tool_use_id: "toolu_test", type: "tool_result", content: toolResultText, is_error: false }],
    },
  });
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, line + "\n");
  return path;
}

/** Writes a transcript containing only a plain assistant TEXT entry — no `tool_result` block anywhere, so it carries no ticket at all (D6). */
function writeNoTicketTranscript(dir: string): string {
  const line = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "just chatting, no ticket rendered this turn" }] },
  });
  const path = join(dir, "transcript-no-ticket.jsonl");
  writeFileSync(path, line + "\n");
  return path;
}

/** Extracts every id named on an `UNDISPOSITIONED_ITEM_STDERR_PREFIX` stderr line. */
function parseUndispositionedIds(stderr: string): string[] {
  const ids: string[] = [];
  const re = /Undispositioned resume ticket item: (\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stderr)) !== null) {
    ids.push(match[1] as string);
  }
  return ids;
}

/** The id set a fixture's OWN array lengths imply, via `formatResumeItemId` — never a hand-typed "KD1" literal (D1, D7, AC-RC-9). */
function expectedIdsFor(extra: HandoffExtra): string[] {
  const ids: string[] = [];
  extra.key_decisions.forEach((_, i) => ids.push(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, i + 1)));
  extra.next_steps.forEach((_, i) => ids.push(formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, i + 1)));
  return ids;
}

/** One `${RESUME_DISPOSITION_MARKER} <id>: <disposition>` line. */
function dispositionLine(id: string, disposition: string): string {
  return `${RESUME_DISPOSITION_MARKER} ${id}: ${disposition}`;
}

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

// ─── Fixtures — real renders, never hand-typed ticket text ─────────────────

const TWO_AND_TWO_EXTRA: HandoffExtra = {
  by: "agent:t3-fixture",
  task_refs: [],
  modified_files: [],
  key_decisions: [{ judgment: "decision one" }, { judgment: "decision two" }],
  next_steps: ["step one", "step two"],
};

const ZERO_DECISIONS_EXTRA: HandoffExtra = {
  by: "agent:t3-degraded-fixture",
  task_refs: [],
  modified_files: [],
  key_decisions: [],
  next_steps: ["the only step"],
};

const ALICE_EXTRA: HandoffExtra = {
  by: "agent:t3-alice",
  task_refs: [],
  modified_files: [],
  key_decisions: [{ judgment: "alice decision" }],
  next_steps: ["alice step"],
};

const BOB_EXTRA: HandoffExtra = {
  by: "agent:t3-bob",
  task_refs: [],
  modified_files: [],
  key_decisions: [],
  next_steps: ["bob step"],
};

function buildRecord(extra: HandoffExtra, slug: string): ResumeHandoffRecord {
  return {
    handoff_slug: slug,
    plan_slug: null,
    by: extra.by,
    at: "2026-07-30T00:00:00.000Z",
    age_minutes: 1,
    ttl_warning: false,
    degraded: false,
    content: renderHandoffContent(extra),
  };
}

const TWO_AND_TWO_TICKET_TEXT = renderResumeFeed({
  found: true,
  handoff: buildRecord(TWO_AND_TWO_EXTRA, "knowledge-handoff-agent-t3-fixture-1"),
  multi_actor: false,
  readiness: null,
} satisfies ResumeResult);

const ZERO_DECISIONS_TICKET_TEXT = renderResumeFeed({
  found: true,
  handoff: buildRecord(ZERO_DECISIONS_EXTRA, "knowledge-handoff-agent-t3-degraded-fixture-1"),
  multi_actor: false,
  readiness: null,
} satisfies ResumeResult);

const MULTI_ACTOR_TICKET_TEXT = renderResumeFeed({
  found: true,
  handoffs: [
    buildRecord(ALICE_EXTRA, "knowledge-handoff-agent-t3-alice-1"),
    buildRecord(BOB_EXTRA, "knowledge-handoff-agent-t3-bob-1"),
  ],
  multi_actor: true,
  readiness: null,
} satisfies ResumeResult);

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-handoff-coverage-check-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY", () => {
  it("three-way: full disposition of every printed id exits 0", () => {
    const transcriptPath = writeToolResultTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const ids = expectedIdsFor(TWO_AND_TWO_EXTRA);
    const lastAssistantMessage = [
      dispositionLine(ids[0] as string, RESUME_DISPOSITION_DONE),
      dispositionLine(ids[1] as string, `${RESUME_DISPOSITION_DEFERRED_PREFIX}not this session`),
      dispositionLine(ids[2] as string, RESUME_DISPOSITION_DONE),
      dispositionLine(ids[3] as string, RESUME_DISPOSITION_DONE),
    ].join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: lastAssistantMessage });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("multi-actor exits zero: a multi-actor transcript (no RESUME_COVERAGE_FLOOR) exits 0 regardless of the disposition line", () => {
    const transcriptPath = writeToolResultTranscript(tmpDir, MULTI_ACTOR_TICKET_TEXT);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE", () => {
  it("three-way: an omitted subset of ids exits non-zero and stderr names EXACTLY that subset (set-equal, not superset/subset)", () => {
    const transcriptPath = writeToolResultTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const ids = expectedIdsFor(TWO_AND_TWO_EXTRA); // [KD1, KD2, NS1, NS2]
    const omitted = [ids[1] as string, ids[3] as string]; // KD2, NS2 left undispositioned
    const lastAssistantMessage = [
      dispositionLine(ids[0] as string, RESUME_DISPOSITION_DONE),
      dispositionLine(ids[2] as string, RESUME_DISPOSITION_DONE),
    ].join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: lastAssistantMessage });

    expect(result.exitCode).not.toBe(0);
    const namedIds = parseUndispositionedIds(result.stderr);
    expect(namedIds.length).toBeGreaterThan(0);
    // Set equality both ways: naming extra ids (e.g. re-naming a dispositioned
    // id) or fewer ids (dropping one of the omitted) must each fail this.
    expect(sortedUnique(namedIds)).toEqual(sortedUnique(omitted));
  });

  it("multi-actor exits zero (control): the SAME single-record ticket with an incomplete disposition set exits non-zero — proves the multi-actor exit-0 above cannot come from finding no ticket at all", () => {
    const transcriptPath = writeToolResultTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

    expect(result.exitCode).not.toBe(0);
    expect(parseUndispositionedIds(result.stderr).length).toBe(expectedIdsFor(TWO_AND_TWO_EXTRA).length);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY", () => {
  it("three-way: a transcript with no rendered ticket exits 0", () => {
    const transcriptPath = writeNoTicketTranscript(tmpDir);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "anything at all" });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("a degenerate zero-decisions (D5 'degraded') ticket, fully dispositioned, exits 0 — no KD-tagged id is ever expected", () => {
    const transcriptPath = writeToolResultTranscript(tmpDir, ZERO_DECISIONS_TICKET_TEXT);
    const ids = expectedIdsFor(ZERO_DECISIONS_EXTRA); // [NS1] only — zero KD ids
    expect(ids).toEqual([formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, 1)]);
    const lastAssistantMessage = dispositionLine(ids[0] as string, RESUME_DISPOSITION_DONE);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: lastAssistantMessage });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("ERROR", () => {
  it("malformed stdin JSON never crashes — degrades to 'no ticket found' (exit 0)", () => {
    const result = runCoverageCheck("{ this is not valid json");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("empty stdin never crashes — degrades to 'no ticket found' (exit 0)", () => {
    const result = runCoverageCheck("");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("an unreadable transcript_path degrades to 'no ticket found' (exit 0), never a thrown error", () => {
    const result = runCoverageCheck({
      transcript_path: join(tmpDir, "does-not-exist.jsonl"),
      last_assistant_message: "irrelevant",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE — AC-RC-9 round-trip identity", () => {
  it("round-trip: given a transcript carrying a ticket this build rendered from a handoff fixture, the recovered id set is SET-EQUAL to the ids derived from that fixture's own array lengths", () => {
    const transcriptPath = writeToolResultTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);

    // No disposition at all -> every recovered id surfaces as undispositioned,
    // which IS the recovered id set (computed from key_decisions.length /
    // next_steps.length, never a literal ["KD1","KD2","NS1","NS2"] list).
    const result = runCoverageCheck({ transcript_path: transcriptPath });

    expect(result.exitCode).not.toBe(0);
    const recovered = parseUndispositionedIds(result.stderr);
    expect(sortedUnique(recovered)).toEqual(sortedUnique(expectedIdsFor(TWO_AND_TWO_EXTRA)));
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION", () => {
  it("the new leading positional does not disturb the default write path's flag validation (missing --next still exits 2)", () => {
    const result = runHandoffWrite(["--by", "regression-tester", "--file", "a.ts"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("next_steps");
  });

  it("an unknown subcommand exits 2, naming the offending token", () => {
    const result = runHandoffWrite(["bogus-subcommand"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("bogus-subcommand");
  });
});
