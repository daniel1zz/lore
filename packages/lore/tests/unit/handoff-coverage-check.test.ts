/**
 * `lore handoff coverage-check` — the SOLE parser of the rendered
 * resume-ticket grammar and of the disposition-line grammar.
 *
 * Governed by `spec-resume-ticket-coverage-floor-blocking-channel-arming`
 * (H1–H6, AC-RCH-1..6 + AC-RCH-8; task
 * `task-t2-unit-oracles-for-the-coverage-check-verb`), which SUPERSEDES two
 * halves of `spec-resume-ticket-coverage-a-shipped-upper-bound-left-the`
 * (SPEC-112): its AC-RC-7 exit-status assertion (H2 — the exit status now
 * carries NO verdict) and its D6 arming predicate (H4 — arming keys on the
 * tool that PRODUCED the ticket). Every other SPEC-112 decision is preserved
 * and still asserted here: D5 (account, not complete), D8 (zero cross-process
 * state), D9 (the hook holds no grammar), D10 (multi-actor render exempt).
 *
 * ## Why H6 shapes every assertion in this file
 *
 * SPEC-112's AC-RC-7 asserted "exits non-zero". Exit 1 satisfied that while
 * delivering nothing: under the Stop-hook contract a non-zero status is
 * NON-blocking, so the AC stayed green for eight days over a mechanism with
 * zero measured effect (10/10 compliance through the stdout block channel vs
 * 0/130 through exit 1, same model, same Stop moments). So no assertion below
 * keys on the exit status as a verdict. What is asserted instead:
 *   - the PARSED stdout `decision` value (`JSON.parse` throwing on trailing
 *     garbage is itself the "exactly ONE JSON object" proof);
 *   - constant IDENTITY against the `@lore/core` exports, never a re-typed
 *     literal, each guarded by a non-empty/distinctness check so a
 *     `toContain("")` cannot pass vacuously;
 *   - ROUND-TRIP through the verb's own parser — the block reason fed straight
 *     back as the next turn's message must close the floor;
 *   - a CONTROL ARM for every negative, proving the detector was live when it
 *     declined to fire (an "exit 0 + empty stdout" that comes from finding no
 *     ticket at all is indistinguishable from a passing verdict — SPEC-112 D6's
 *     exact silent-inertness failure mode).
 *
 * ## Fixture discipline
 *
 * Ticket text is always a REAL render — `renderHandoffContent` +
 * `renderResumeFeed` — never hand-typed, and every expected item id is derived
 * via `formatResumeItemId` over the fixture's own array lengths, never a
 * literal "KD1"/"NS2" (SPEC-112 D1/D7's contiguous-substring discipline).
 * Transcript entry shapes are the MEASURED ones: a tool result is
 * `type:"user"` + `message.content[{type:"tool_result", tool_use_id, content}]`;
 * a tool call and an assistant text are both `type:"assistant"` +
 * `message.content[{type:"tool_use", id, name, input}]` / `[{type:"text"}]`.
 * Under H4 a ticket arms ONLY when its `tool_use_id` pairs with a
 * `lore feed session-resume` call, so `writeArmedTicketTranscript` always
 * emits the producing call and `writeUnpairedTicketTranscript` deliberately
 * does not.
 *
 * Spawns the LIVE source CLI (`bun run src/index.ts handoff coverage-check`)
 * rather than importing `commands/handoff.ts`: that file transitively imports
 * `loader.ts` (`bun:sqlite`), unresolvable by vitest. The verb needs no corpus
 * (pure stdin/transcript parsing, D8), so only a throwaway JSONL file is set
 * up per test. Spawning is also why `bun run test:changed` selects NOTHING for
 * a change to the verb — there is no import edge to walk; this file must be
 * run explicitly.
 *
 * Six-dimension coverage:
 *   HAPPY:      AC-RCH-1 control (full accounting -> empty stdout); AC-RCH-3
 *               relay; AC-RCH-5's five arming shapes; AC-RCH-6 earlier-turn
 *               accounting closes the floor
 *   NEGATIVE:   AC-RCH-1 incomplete -> stdout block + stderr set-equal to the
 *               omission; AC-RCH-4 non-feed producer; AC-RCH-5 cat/grep/
 *               path-word/lone-token negatives; unrecognized and
 *               reason-less disposition tokens are not accountings
 *   BOUNDARY:   a degenerate zero-decisions ticket; an UNPAIRED tool_result;
 *               a disposition that predates the ticket; the multi-actor render
 *   ERROR:      malformed / empty / non-object stdin, unreadable transcript
 *               path — all degrade, never crash
 *   STATE:      AC-RCH-6 union across several post-ticket turns plus the
 *               current one; AC-RCH-1/2 round-trip id recovery
 *   REGRESSION: SPEC-112 D10 multi-actor exemption under the REPLACED arming
 *               predicate; D9 zero grammar in the hook asset; the leading
 *               positional leaves the write path's flag validation intact
 *
 * @spec_ref spec-resume-ticket-coverage-floor-blocking-channel-arming
 *   §Design Decisions H1–H6; AC-RCH-1, AC-RCH-2, AC-RCH-3, AC-RCH-4,
 *   AC-RCH-5, AC-RCH-6, AC-RCH-8
 * @spec_ref spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 *   D1, D5, D7, D8, D9, D10 (D6 + AC-RC-7 superseded above)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  renderHandoffContent,
  renderResumeCoverageCardinalityLine,
  RESUME_COVERAGE_FLOOR,
  RESUME_DISPOSITION_MARKER,
  RESUME_DISPOSITION_DONE,
  RESUME_DISPOSITION_DEFERRED_PREFIX,
  RESUME_DISPOSITION_MISSING_DESTINATION_STDERR_PREFIX,
  RESUME_ITEM_ID_PREFIX_KEY_DECISION,
  RESUME_ITEM_ID_PREFIX_NEXT_STEP,
  formatResumeItemId,
  type HandoffExtra,
} from "@lore/core";
import { renderResumeFeed, SESSION_RESUME_CHECKPOINT } from "../../src/flows/feed-flow.js";
import type { ResumeHandoffRecord, ResumeResult } from "../../src/service/session-service.js";

// tests/unit/ -> packages/lore/ -> repo root
const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
/** The SHIPPED Stop hook asset, run unmodified from its own path (AC-RCH-3 / H1: this spec edits no asset). */
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "stop-handoff-coverage.mjs");
/** The verb's own source, read only to prove it types no grammar literal (AC-RCH-2). */
const VERB_SOURCE_PATH = join(PACKAGE_ROOT, "src", "adapters", "cli", "commands", "handoff.ts");

/**
 * The verb's own stderr presentation prefix. Hand-typed here deliberately —
 * it is NOT part of the `@lore/core` grammar (it is how the verb reports its
 * OWN verdict, not a format it parses), so there is no export to key on. Every
 * negative assertion below therefore also asserts a POSITIVE id count, so a
 * drifted prefix fails loudly instead of degrading to "found no ids, set-equal
 * to an empty expectation".
 */
const UNDISPOSITIONED_PREFIX = "Undispositioned resume ticket item: ";

/**
 * The verb's DISTINCT stderr prefix for "this id was named, but with a token
 * matching neither accepted form"
 * (task-resume-coverage-disposition-parser-an-unrecognised-token). Hand-typed
 * here for the same reason {@link UNDISPOSITIONED_PREFIX} is — not part of the
 * `@lore/core` grammar, no export to key on. Deliberately a DIFFERENT literal
 * from that prefix: the whole point of this task is that the two facts
 * ("never mentioned" vs. "mentioned with a bad token") must not collapse into
 * one channel.
 */
const UNRECOGNIZED_DISPOSITION_PREFIX = "Unrecognized disposition for resume ticket item: ";

/** The Stop-hook contract's blocking decision value — the HARNESS's vocabulary, not lore corpus grammar, so a literal is correct here (see the verb's own `STOP_HOOK_BLOCK_DECISION` doc). */
const BLOCK_DECISION = "block";

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
 * Runs the UNMODIFIED hook asset with `stubDir` prepended to `PATH`, so the
 * hook's own `spawnSync('lore', …)` resolves the stub instead of a real
 * binary — the same `PATH` substitution SPEC-112 AC-RC-10 uses. stdout is
 * captured as a RAW Buffer (no `encoding`), because AC-RCH-3's property is
 * byte-for-byte reproduction, which a decode/re-encode round could mask.
 */
function runHookWithStub(stubDir: string, payload: unknown): { stdout: Buffer; stderr: string; exitCode: number } {
  const result = spawnSync("node", [HOOK_PATH], {
    input: JSON.stringify(payload),
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
  });
  return {
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8"),
    exitCode: result.status ?? 1,
  };
}

/**
 * Writes an executable `lore` shim into a fresh directory and returns that
 * directory. The shim drains its stdin (the hook writes the forwarded payload
 * there and a non-reading child would risk an EPIPE that masks the relay),
 * then writes `stdout` with NO added newline and exits 0.
 */
function writeLoreStub(dir: string, stdout: string): string {
  const stubDir = join(dir, "stub-bin");
  mkdirSync(stubDir, { recursive: true });
  const stubPath = join(stubDir, "lore");
  writeFileSync(stubPath, `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${stdout}'\nexit 0\n`);
  chmodSync(stubPath, 0o755);
  return stubDir;
}

// ─── Transcript construction (MEASURED entry shapes) ────────────────────────

/** The `tool_use_id` every paired fixture below uses. */
const TICKET_TOOL_USE_ID = "toolu_ticket_01";

/** One `type:"assistant"` entry carrying a single `tool_use` block. */
function toolUseEntry(id: string, name: string, input: unknown): unknown {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } };
}

/** A Bash-shaped originating call. */
function bashToolUseEntry(id: string, command: string): unknown {
  return toolUseEntry(id, "Bash", { command });
}

/** An MCP-shaped originating call — namespaced exactly as the harness renders it (`mcp__<server>__<tool>`). */
function mcpFeedToolUseEntry(id: string, checkpoint: string): unknown {
  return toolUseEntry(id, "mcp__lore__lore_feed", { checkpoint });
}

/** One `type:"user"` entry carrying a single `tool_result` block. */
function toolResultEntry(toolUseId: string, text: string): unknown {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ tool_use_id: toolUseId, type: "tool_result", content: text, is_error: false }],
    },
  };
}

/** One `type:"assistant"` entry carrying plain text — the channel post-ticket dispositions arrive on (H5). */
function assistantTextEntry(text: string): unknown {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } };
}

let transcriptSeq = 0;

/** Writes `entries` as one JSONL file and returns its path. */
function writeTranscript(dir: string, entries: readonly unknown[]): string {
  const path = join(dir, `transcript-${++transcriptSeq}.jsonl`);
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return path;
}

/** A ticket whose `tool_result` is paired with an explicit `producer` call, plus any `trailing` entries (later turns). */
function writeProducedTicketTranscript(
  dir: string,
  ticketText: string,
  producer: unknown,
  trailing: readonly unknown[] = [],
): string {
  return writeTranscript(dir, [producer, toolResultEntry(TICKET_TOOL_USE_ID, ticketText), ...trailing]);
}

/** A ticket produced by a genuine `lore feed session-resume` Bash call — the arming shape under H4. */
function writeArmedTicketTranscript(dir: string, ticketText: string, trailing: readonly unknown[] = []): string {
  return writeProducedTicketTranscript(
    dir,
    ticketText,
    bashToolUseEntry(TICKET_TOOL_USE_ID, `lore ${FEED_TOKEN} ${SESSION_RESUME_CHECKPOINT}`),
    trailing,
  );
}

/** A ticket whose `tool_result` has NO originating `tool_use` anywhere — unknown provenance (H4). */
function writeUnpairedTicketTranscript(dir: string, ticketText: string): string {
  return writeTranscript(dir, [toolResultEntry(TICKET_TOOL_USE_ID, ticketText)]);
}

/** A transcript with no `tool_result` block at all, so no ticket was ever handed to the session. */
function writeNoTicketTranscript(dir: string): string {
  return writeTranscript(dir, [assistantTextEntry("just chatting, no ticket rendered this turn")]);
}

/** Reads back every `tool_result` payload a transcript file carries — used to prove two fixtures differ ONLY in their producing call. */
function readToolResultContents(path: string): string[] {
  const contents: string[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    const entry = JSON.parse(line) as { message?: { content?: unknown } };
    const blocks = entry.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (block !== null && typeof block === "object" && (block as { type?: unknown }).type === "tool_result") {
        contents.push(String((block as { content?: unknown }).content));
      }
    }
  }
  return contents;
}

// ─── Assertion helpers ──────────────────────────────────────────────────────

/**
 * Parses the verb's stdout as the Stop contract's decision object. A
 * successful `JSON.parse` IS the "exactly ONE JSON object" assertion AC-RCH-1
 * asks for: two concatenated objects, or any trailing byte, make `JSON.parse`
 * throw. Throws (failing the test loudly) on empty stdout rather than
 * returning a shrug value.
 */
function parseDecisionPayload(stdout: string): { decision: unknown; reason: unknown } {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`stdout parsed to a non-object (${JSON.stringify(parsed)})`);
  }
  return parsed as { decision: unknown; reason: unknown };
}

/** The `reason` text of a block decision, type-narrowed. */
function blockReasonOf(result: RunResult): string {
  const payload = parseDecisionPayload(result.stdout);
  expect(payload.decision).toBe(BLOCK_DECISION);
  expect(typeof payload.reason).toBe("string");
  return payload.reason as string;
}

/** Extracts every id named on an `UNDISPOSITIONED_PREFIX` stderr line. */
function parseUndispositionedIds(stderr: string): string[] {
  const ids: string[] = [];
  for (const line of stderr.split("\n")) {
    if (!line.startsWith(UNDISPOSITIONED_PREFIX)) continue;
    ids.push(line.slice(UNDISPOSITIONED_PREFIX.length).trim());
  }
  return ids;
}

/** Extracts every id named on an `UNRECOGNIZED_DISPOSITION_PREFIX` stderr line (task-resume-coverage-disposition-parser-an-unrecognised-token). */
function parseUnrecognizedDispositionIds(stderr: string): string[] {
  const ids: string[] = [];
  for (const line of stderr.split("\n")) {
    if (!line.startsWith(UNRECOGNIZED_DISPOSITION_PREFIX)) continue;
    const rest = line.slice(UNRECOGNIZED_DISPOSITION_PREFIX.length);
    const colonIndex = rest.indexOf(":");
    ids.push((colonIndex === -1 ? rest : rest.slice(0, colonIndex)).trim());
  }
  return ids;
}

/** The id set a fixture's OWN array lengths imply, via `formatResumeItemId` — never a hand-typed "KD1" literal (D1, D7). */
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

/**
 * A full accounting of `ids`, alternating the two accepted dispositions so
 * both are exercised (D5). The deferred half's reason carries an S4
 * destination token (`see issue #5`) — spec-resume-coverage-floor-the-satisfaction-boundaries-a
 * S4 makes a reason ALONE insufficient to close a deferred item, so every
 * pre-existing caller of this helper that expects full closure needs this
 * fixture to satisfy S4 too, not just S1.
 */
function fullAccounting(ids: readonly string[]): string {
  return ids
    .map((id, i) =>
      dispositionLine(
        id,
        i % 2 === 0 ? RESUME_DISPOSITION_DONE : `${RESUME_DISPOSITION_DEFERRED_PREFIX}out of scope, see issue #5`,
      ),
    )
    .join("\n");
}

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

/** Non-overlapping occurrence count of `needle` in `haystack` — the searcher every zero-hit assertion below is paired with a positive control for. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) throw new Error("countOccurrences: an empty needle is always found — refusing");
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

// ─── Fixtures — real renders, never hand-typed ticket text ─────────────────

/** The `lore` subcommand token whose invocation arms the floor (H4). Kept local so the fixtures below never depend on the verb's own private constant. */
const FEED_TOKEN = "feed";

const TWO_AND_TWO_EXTRA: HandoffExtra = {
  by: "agent:t2-fixture",
  task_refs: [],
  modified_files: [],
  key_decisions: [{ judgment: "decision one" }, { judgment: "decision two" }],
  next_steps: ["step one", "step two"],
};

const ZERO_DECISIONS_EXTRA: HandoffExtra = {
  by: "agent:t2-degraded-fixture",
  task_refs: [],
  modified_files: [],
  key_decisions: [],
  next_steps: ["the only step"],
};

const ALICE_EXTRA: HandoffExtra = {
  by: "agent:t2-alice",
  task_refs: [],
  modified_files: [],
  key_decisions: [{ judgment: "alice decision" }],
  next_steps: ["alice step"],
};

const BOB_EXTRA: HandoffExtra = {
  by: "agent:t2-bob",
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
    at: "2026-08-01T00:00:00.000Z",
    age_minutes: 1,
    ttl_warning: false,
    degraded: false,
    content: renderHandoffContent(extra),
  };
}

const TWO_AND_TWO_TICKET_TEXT = renderResumeFeed({
  found: true,
  handoff: buildRecord(TWO_AND_TWO_EXTRA, "knowledge-handoff-agent-t2-fixture-1"),
  multi_actor: false,
  readiness: null,
} satisfies ResumeResult);

const ZERO_DECISIONS_TICKET_TEXT = renderResumeFeed({
  found: true,
  handoff: buildRecord(ZERO_DECISIONS_EXTRA, "knowledge-handoff-agent-t2-degraded-fixture-1"),
  multi_actor: false,
  readiness: null,
} satisfies ResumeResult);

const MULTI_ACTOR_TICKET_TEXT = renderResumeFeed({
  found: true,
  handoffs: [
    buildRecord(ALICE_EXTRA, "knowledge-handoff-agent-t2-alice-1"),
    buildRecord(BOB_EXTRA, "knowledge-handoff-agent-t2-bob-1"),
  ],
  multi_actor: true,
  readiness: null,
} satisfies ResumeResult);

const TWO_AND_TWO_IDS = expectedIdsFor(TWO_AND_TWO_EXTRA);

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-handoff-coverage-check-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── AC-RCH-1 ───────────────────────────────────────────────────────────────

describe("AC-RCH-1 — the verdict travels stdout as a block decision, never the exit status", () => {
  it("NEGATIVE: an incomplete accounting exits 0, writes ONE JSON object whose decision is the block value, and names EXACTLY the omitted ids on stderr", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const omitted = [TWO_AND_TWO_IDS[1] as string, TWO_AND_TWO_IDS[3] as string];
    const accounted = [TWO_AND_TWO_IDS[0] as string, TWO_AND_TWO_IDS[2] as string];
    const lastAssistantMessage = accounted.map((id) => dispositionLine(id, RESUME_DISPOSITION_DONE)).join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: lastAssistantMessage });

    // H2: the status is 0 even though the verdict is "incomplete" — a non-zero
    // status is the channel measured to change nothing (0/130 compliance).
    expect(result.exitCode).toBe(0);
    const payload = parseDecisionPayload(result.stdout);
    expect(payload.decision).toBe(BLOCK_DECISION);
    // Set equality both ways: naming an extra id (e.g. re-naming a dispositioned
    // one) or dropping one of the omitted must each fail. The positive length
    // assertion also proves the stderr matcher is live rather than matching
    // nothing against an empty expectation.
    const namedIds = parseUndispositionedIds(result.stderr);
    expect(namedIds.length).toBe(omitted.length);
    expect(sortedUnique(namedIds)).toEqual(sortedUnique(omitted));
    // One line per missing id and nothing else — an extra diagnostic line the
    // matcher happens not to recognize would slip past the set comparison.
    expect(result.stderr.split("\n").filter((line) => line.length > 0)).toHaveLength(omitted.length);
  });

  it("HAPPY control: the SAME fixture with every id dispositioned writes NOTHING to stdout — the block is conditional, not unconditional", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);

    const result = runCoverageCheck({
      transcript_path: transcriptPath,
      last_assistant_message: fullAccounting(TWO_AND_TWO_IDS),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    // Self-guard: THIS transcript, unaccounted, must block. Without it an
    // "empty stdout" reads identically whether the accounting satisfied a live
    // detector or the detector never armed at all — SPEC-112 D6's exact
    // silent-inertness failure mode, measured green for eight days.
    expect(parseDecisionPayload(runCoverageCheck({ transcript_path: transcriptPath }).stdout).decision).toBe(
      BLOCK_DECISION,
    );
  });

  it("STATE: a DIFFERENT fixture blocks over its own id set — the verdict is derived per ticket, never a fixed payload", () => {
    // Defeats a hardcoded/echoed verdict: same code path, different cardinality
    // line, so the named id set must differ from the 4-item fixture above.
    const transcriptPath = writeArmedTicketTranscript(tmpDir, ZERO_DECISIONS_TICKET_TEXT);
    const ids = expectedIdsFor(ZERO_DECISIONS_EXTRA);
    expect(ids).toEqual([formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, 1)]);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    expect(parseDecisionPayload(result.stdout).decision).toBe(BLOCK_DECISION);
    expect(sortedUnique(parseUndispositionedIds(result.stderr))).toEqual(sortedUnique(ids));
    expect(sortedUnique(parseUndispositionedIds(result.stderr))).not.toEqual(sortedUnique(TWO_AND_TWO_IDS));
  });

  it("BOUNDARY: the same degenerate zero-decisions ticket, fully dispositioned, writes nothing — no KD-tagged id is ever expected", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, ZERO_DECISIONS_TICKET_TEXT);
    const ids = expectedIdsFor(ZERO_DECISIONS_EXTRA);

    const result = runCoverageCheck({
      transcript_path: transcriptPath,
      last_assistant_message: dispositionLine(ids[0] as string, RESUME_DISPOSITION_DONE),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    // Self-guard, as above: the same degenerate ticket unaccounted must block.
    expect(parseDecisionPayload(runCoverageCheck({ transcript_path: transcriptPath }).stdout).decision).toBe(
      BLOCK_DECISION,
    );
  });
});

// ─── AC-RCH-2 ───────────────────────────────────────────────────────────────

describe("AC-RCH-2 — the reason template is composed of exported constants and round-trips through the verb's own parser", () => {
  /** Every grammar value the reason must be composed from, keyed by identity on the `@lore/core` export. */
  const GRAMMAR_EXPORTS: ReadonlyArray<readonly [string, string]> = [
    ["RESUME_DISPOSITION_MARKER", RESUME_DISPOSITION_MARKER],
    ["RESUME_DISPOSITION_DONE", RESUME_DISPOSITION_DONE],
    ["RESUME_DISPOSITION_DEFERRED_PREFIX", RESUME_DISPOSITION_DEFERRED_PREFIX],
  ];

  it("HAPPY: the reason carries each of the three exported disposition constants, asserted by identity against the export", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const reason = blockReasonOf(runCoverageCheck({ transcript_path: transcriptPath }));

    for (const [name, value] of GRAMMAR_EXPORTS) {
      // Anti-vacuity: `toContain("")` always passes, so an emptied export must
      // fail HERE rather than silently satisfying the containment below.
      expect(value.length, `${name} must be a non-empty export`).toBeGreaterThan(0);
      expect(reason).toContain(value);
    }
    // Distinctness: three constants that collapsed into one string would
    // satisfy all three containments above from a single occurrence.
    expect(sortedUnique(GRAMMAR_EXPORTS.map(([, value]) => value))).toHaveLength(GRAMMAR_EXPORTS.length);
    // The floor declaration itself is the obligation being restated (H3).
    expect(reason).toContain(RESUME_COVERAGE_FLOOR);
  });

  it("STATE: feeding the reason back VERBATIM as the next turn's message closes the floor — the template is literally copyable, not merely suggestive", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const reason = blockReasonOf(runCoverageCheck({ transcript_path: transcriptPath }));

    // Round-trip through the SAME parser the verb reads dispositions with —
    // substring presence would not prove the lines parse.
    const replayed = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: reason });

    expect(replayed.exitCode).toBe(0);
    expect(replayed.stdout).toBe("");
    expect(replayed.stderr).toBe("");
  });

  it("STATE: the reason carries exactly one marker line per missing id, each dispositioning THAT id and no other", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const reason = blockReasonOf(runCoverageCheck({ transcript_path: transcriptPath }));

    const markerLines = reason.split("\n").filter((line) => line.trim().startsWith(RESUME_DISPOSITION_MARKER));
    expect(markerLines).toHaveLength(TWO_AND_TWO_IDS.length);

    for (const id of TWO_AND_TWO_IDS) {
      const linesForId = markerLines.filter((line) => line.includes(` ${id}:`));
      expect(linesForId, `the reason must carry exactly one line for ${id}`).toHaveLength(1);

      // Replay ONLY that one line: the verb must then account for exactly this
      // id, leaving the remainder — which is what "dispositions exactly that
      // id and no other" means operationally.
      const replayed = runCoverageCheck({
        transcript_path: transcriptPath,
        last_assistant_message: linesForId[0] as string,
      });
      const remainder = TWO_AND_TWO_IDS.filter((other) => other !== id);
      expect(parseDecisionPayload(replayed.stdout).decision).toBe(BLOCK_DECISION);
      expect(sortedUnique(parseUndispositionedIds(replayed.stderr))).toEqual(sortedUnique(remainder));
    }
  });

  it("REGRESSION: the verb's source types no copy of the marker literal — a hand-typed template is the remembered-wording drift vector D7 forbids", () => {
    const verbSource = readFileSync(VERB_SOURCE_PATH, "utf8");
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const reason = blockReasonOf(runCoverageCheck({ transcript_path: transcriptPath }));

    // Positive control FIRST: the identical search, with the identical needle,
    // finds the marker in text the verb actually emitted. Without this arm a
    // mistyped needle would make the zero-hit assertion pass vacuously.
    expect(countOccurrences(reason, RESUME_DISPOSITION_MARKER)).toBeGreaterThan(0);
    expect(countOccurrences(verbSource, RESUME_DISPOSITION_MARKER)).toBe(0);
  });
});

// ─── AC-RCH-3 ───────────────────────────────────────────────────────────────

describe("AC-RCH-3 — the unmodified hook relays block payloads verbatim and still holds zero grammar", () => {
  /** A payload only the stub can have produced — the real verb never emits this reason. */
  const STUB_STDOUT = JSON.stringify({
    decision: BLOCK_DECISION,
    reason: "stub sentinel 7f3a9c relayed unchanged",
  });

  it("HAPPY: with a stub `lore` earlier on PATH, the shipped hook reproduces the stub's stdout byte-for-byte and exits 0", () => {
    const stubDir = writeLoreStub(tmpDir, STUB_STDOUT);
    const transcriptPath = writeNoTicketTranscript(tmpDir);

    const result = runHookWithStub(stubDir, {
      transcript_path: transcriptPath,
      last_assistant_message: "anything at all",
    });

    // Byte comparison, not a decoded string compare: "byte-for-byte" is the
    // property, and the sentinel proves the stub (not a real binary) answered.
    expect(result.stdout.equals(Buffer.from(STUB_STDOUT, "utf8"))).toBe(true);
    expect(result.exitCode).toBe(0);
    // A fault of the hook's own is never silent — its absence proves the relay
    // path ran rather than the stub failing to resolve.
    expect(result.stderr).not.toContain("stop-handoff-coverage: ");
  });

  it("REGRESSION control: the hook asset yields zero hits for every exported id prefix and disposition token — it gained no grammar (D9)", () => {
    const hookSource = readFileSync(HOOK_PATH, "utf8");
    const needles: ReadonlyArray<readonly [string, string]> = [
      ["RESUME_ITEM_ID_PREFIX_KEY_DECISION", RESUME_ITEM_ID_PREFIX_KEY_DECISION],
      ["RESUME_ITEM_ID_PREFIX_NEXT_STEP", RESUME_ITEM_ID_PREFIX_NEXT_STEP],
      ["RESUME_DISPOSITION_MARKER", RESUME_DISPOSITION_MARKER],
      ["RESUME_DISPOSITION_DONE", RESUME_DISPOSITION_DONE],
      ["RESUME_DISPOSITION_DEFERRED_PREFIX", RESUME_DISPOSITION_DEFERRED_PREFIX],
      ["RESUME_COVERAGE_FLOOR", RESUME_COVERAGE_FLOOR],
    ];
    // Positive control haystack, built from the exports themselves: every
    // needle IS findable by this searcher, so each zero below is a measured
    // absence rather than a broken search or an empty needle.
    const control = needles.map(([, value]) => value).join("\n");

    for (const [name, value] of needles) {
      expect(value.length, `${name} must be a non-empty export`).toBeGreaterThan(0);
      expect(countOccurrences(control, value), `${name} must be findable by this searcher`).toBeGreaterThan(0);
      expect(countOccurrences(hookSource, value), `the hook must not carry ${name}`).toBe(0);
    }
  });
});

// ─── AC-RCH-4 ───────────────────────────────────────────────────────────────

describe("AC-RCH-4 — arming provenance: the producing tool call decides, not text that merely contains a ticket", () => {
  const NON_FEED_COMMAND = "cat docs/archive/old-handoff.md";

  it("NEGATIVE: ticket text produced by a non-feed tool call writes NOTHING to stdout — auditing an archived handoff imposes no accounting duty", () => {
    const transcriptPath = writeProducedTicketTranscript(
      tmpDir,
      TWO_AND_TWO_TICKET_TEXT,
      bashToolUseEntry(TICKET_TOOL_USE_ID, NON_FEED_COMMAND),
    );

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("HAPPY control: the BYTE-IDENTICAL ticket text paired with a real session-resume feed call DOES block — the negative above cannot come from finding no ticket at all", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    expect(parseDecisionPayload(result.stdout).decision).toBe(BLOCK_DECISION);
    expect(sortedUnique(parseUndispositionedIds(result.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
  });

  it("STATE: the two fixtures above differ ONLY in their producing call — their tool_result payloads are byte-identical", () => {
    const negativePath = writeProducedTicketTranscript(
      tmpDir,
      TWO_AND_TWO_TICKET_TEXT,
      bashToolUseEntry(TICKET_TOOL_USE_ID, NON_FEED_COMMAND),
    );
    const controlPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);

    const negativeResults = readToolResultContents(negativePath);
    const controlResults = readToolResultContents(controlPath);

    expect(negativeResults).toHaveLength(1);
    expect(controlResults).toHaveLength(1);
    expect(negativeResults[0]).toBe(controlResults[0]);
    expect(negativeResults[0]).toBe(TWO_AND_TWO_TICKET_TEXT);
  });

  it("BOUNDARY: a tool_result with NO originating tool_use anywhere in the transcript is unknown provenance and does not arm", () => {
    const transcriptPath = writeUnpairedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});

// ─── AC-RCH-5 ───────────────────────────────────────────────────────────────

/** One originating-call shape and the verdict it must produce over the same ticket text. */
interface ProvenanceFixture {
  readonly label: string;
  readonly producer: unknown;
  readonly ticketText: string;
  readonly expectBlock: boolean;
}

const PROVENANCE_FIXTURES: readonly ProvenanceFixture[] = [
  {
    label: "a bare `lore feed session-resume` invocation",
    producer: bashToolUseEntry(TICKET_TOOL_USE_ID, `lore ${FEED_TOKEN} ${SESSION_RESUME_CHECKPOINT}`),
    ticketText: TWO_AND_TWO_TICKET_TEXT,
    expectBlock: true,
  },
  {
    label: "a dist-path invocation carrying extra flags",
    producer: bashToolUseEntry(
      TICKET_TOOL_USE_ID,
      `./dist/lore ${FEED_TOKEN} ${SESSION_RESUME_CHECKPOINT} --plan plan-x`,
    ),
    ticketText: TWO_AND_TWO_TICKET_TEXT,
    expectBlock: true,
  },
  {
    label: "an MCP lore_feed call with a session-resume checkpoint",
    producer: mcpFeedToolUseEntry(TICKET_TOOL_USE_ID, SESSION_RESUME_CHECKPOINT),
    ticketText: TWO_AND_TWO_TICKET_TEXT,
    expectBlock: true,
  },
  {
    label: "unrelated flags interleaved BETWEEN the two required tokens",
    producer: bashToolUseEntry(
      TICKET_TOOL_USE_ID,
      `lore ${FEED_TOKEN} --json --plan plan-x ${SESSION_RESUME_CHECKPOINT}`,
    ),
    ticketText: TWO_AND_TWO_TICKET_TEXT,
    expectBlock: true,
  },
  {
    label: "the two required tokens in REVERSED order",
    // Not a real command line — its only purpose is to pin that the two tokens
    // are matched INDEPENDENTLY, never as a contiguous "feed session-resume"
    // phrase (this repo's measured contiguous-substring false-oracle vector).
    producer: bashToolUseEntry(TICKET_TOOL_USE_ID, `lore ${SESSION_RESUME_CHECKPOINT} ${FEED_TOKEN}`),
    ticketText: TWO_AND_TWO_TICKET_TEXT,
    expectBlock: true,
  },
  {
    label: "`cat` merely transporting the same ticket text",
    producer: bashToolUseEntry(TICKET_TOOL_USE_ID, "cat docs/archive/old-handoff.md"),
    ticketText: TWO_AND_TWO_TICKET_TEXT,
    expectBlock: false,
  },
  {
    label: "`grep` merely transporting the same ticket text",
    producer: bashToolUseEntry(TICKET_TOOL_USE_ID, "grep -n SCOPE docs/archive/old-handoff.md"),
    ticketText: TWO_AND_TWO_TICKET_TEXT,
    expectBlock: false,
  },
  {
    label: "a `grep` carrying the session-resume token but NOT the feed token",
    // Both tokens are required: an `||` where the predicate needs `&&` would
    // arm here, and only here.
    producer: bashToolUseEntry(TICKET_TOOL_USE_ID, `grep -rn ${SESSION_RESUME_CHECKPOINT} docs/`),
    ticketText: TWO_AND_TWO_TICKET_TEXT,
    expectBlock: false,
  },
  {
    label: "a `cat` of a path whose SEGMENTS spell both tokens",
    // `docs/feed/session-resume.md` stays ONE non-matching word: matching is
    // word equality after edge-punctuation trimming, never decomposition.
    producer: bashToolUseEntry(TICKET_TOOL_USE_ID, `cat docs/${FEED_TOKEN}/${SESSION_RESUME_CHECKPOINT}.md`),
    ticketText: TWO_AND_TWO_TICKET_TEXT,
    expectBlock: false,
  },
  {
    label: "a multi-actor render (ordinals present, no coverage-floor declaration) from a GENUINE feed call",
    producer: bashToolUseEntry(TICKET_TOOL_USE_ID, `lore ${FEED_TOKEN} ${SESSION_RESUME_CHECKPOINT}`),
    ticketText: MULTI_ACTOR_TICKET_TEXT,
    expectBlock: false,
  },
];

describe("AC-RCH-5 — provenance shapes, iterated exhaustively", () => {
  for (const fixture of PROVENANCE_FIXTURES) {
    const verdict = fixture.expectBlock ? "arms and blocks" : "does not arm (empty stdout)";
    it(`${fixture.expectBlock ? "HAPPY" : "NEGATIVE"}: ${fixture.label} ${verdict}`, () => {
      const transcriptPath = writeProducedTicketTranscript(tmpDir, fixture.ticketText, fixture.producer);

      const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

      expect(result.exitCode).toBe(0);
      if (fixture.expectBlock) {
        expect(parseDecisionPayload(result.stdout).decision).toBe(BLOCK_DECISION);
        expect(parseUndispositionedIds(result.stderr).length).toBeGreaterThan(0);
      } else {
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
      }
    });
  }

  it("BOUNDARY: the fixture array still covers both arms exhaustively — an emptied or one-sided array registers no vacuous pass", () => {
    // A `for`-generated suite over a truncated array would silently shrink to
    // whichever half survived, so the array's own shape is asserted.
    expect(PROVENANCE_FIXTURES.filter((f) => f.expectBlock).length).toBeGreaterThanOrEqual(5);
    expect(PROVENANCE_FIXTURES.filter((f) => !f.expectBlock).length).toBeGreaterThanOrEqual(5);
    expect(sortedUnique(PROVENANCE_FIXTURES.map((f) => f.label))).toHaveLength(PROVENANCE_FIXTURES.length);
  });

  it("REGRESSION: the multi-actor fixture is genuinely ticket-shaped — it carries a real cardinality line and lacks the floor declaration, so its exit-0 is the D10 exemption and not 'no ticket found'", () => {
    // Without this the D10 arm above would pass for the wrong reason: a text
    // the cardinality matcher never recognized never reaches the exemption.
    expect(MULTI_ACTOR_TICKET_TEXT).toContain(
      renderResumeCoverageCardinalityLine(ALICE_EXTRA.key_decisions.length, ALICE_EXTRA.next_steps.length),
    );
    expect(MULTI_ACTOR_TICKET_TEXT).toContain(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, 1));
    expect(MULTI_ACTOR_TICKET_TEXT).not.toContain(RESUME_COVERAGE_FLOOR);
    // …and the single-record render of the same build DOES carry the floor, so
    // the assertion above is a property of the multi-actor branch, not of the
    // renderer having dropped the declaration everywhere.
    expect(TWO_AND_TWO_TICKET_TEXT).toContain(RESUME_COVERAGE_FLOOR);
  });
});

// ─── AC-RCH-6 ───────────────────────────────────────────────────────────────

describe("AC-RCH-6 — cross-turn accumulation: one accounting closes the item for the rest of the session", () => {
  it("HAPPY: a complete accounting in an EARLIER post-ticket message keeps the floor closed while the current message carries none", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT, [
      assistantTextEntry(fullAccounting(TWO_AND_TWO_IDS)),
      assistantTextEntry("some later turn that says nothing about the ticket"),
    ]);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "no accounting here" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");

    // Self-guard: the SAME transcript with the earlier accounting turn removed
    // must block over the whole id set — so the closure above is attributable
    // to that message and not to a detector that never armed.
    const withoutEarlierAccounting = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT, [
      assistantTextEntry("some later turn that says nothing about the ticket"),
    ]);
    const control = runCoverageCheck({
      transcript_path: withoutEarlierAccounting,
      last_assistant_message: "no accounting here",
    });
    expect(parseDecisionPayload(control.stdout).decision).toBe(BLOCK_DECISION);
    expect(sortedUnique(parseUndispositionedIds(control.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
  });

  it("NEGATIVE control: when that earlier message accounts for only a PROPER SUBSET, the block names SET-EQUAL the remainder — so the exit-0 above cannot come from ignoring the transcript", () => {
    const accounted = [TWO_AND_TWO_IDS[0] as string, TWO_AND_TWO_IDS[2] as string];
    const remainder = TWO_AND_TWO_IDS.filter((id) => !accounted.includes(id));
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT, [
      assistantTextEntry(fullAccounting(accounted)),
    ]);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "no accounting here" });

    expect(result.exitCode).toBe(0);
    expect(parseDecisionPayload(result.stdout).decision).toBe(BLOCK_DECISION);
    const namedIds = parseUndispositionedIds(result.stderr);
    expect(namedIds.length).toBe(remainder.length);
    expect(sortedUnique(namedIds)).toEqual(sortedUnique(remainder));
  });

  it("STATE: the accounting is the UNION of several earlier turns AND the current message — no single source needs to carry the whole set", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT, [
      assistantTextEntry(dispositionLine(TWO_AND_TWO_IDS[0] as string, RESUME_DISPOSITION_DONE)),
      assistantTextEntry("an unrelated turn in between"),
      assistantTextEntry(
        [
          dispositionLine(TWO_AND_TWO_IDS[1] as string, `${RESUME_DISPOSITION_DEFERRED_PREFIX}next session, see issue #5`),
          dispositionLine(TWO_AND_TWO_IDS[2] as string, RESUME_DISPOSITION_DONE),
        ].join("\n"),
      ),
    ]);

    const result = runCoverageCheck({
      transcript_path: transcriptPath,
      last_assistant_message: dispositionLine(TWO_AND_TWO_IDS[3] as string, RESUME_DISPOSITION_DONE),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");

    // Self-guard: drop ONLY the current turn's contribution and the union must
    // fall exactly one id short — proving each source was really consulted
    // rather than the whole set having been satisfied by any single one.
    const withoutCurrentTurn = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });
    expect(parseDecisionPayload(withoutCurrentTurn.stdout).decision).toBe(BLOCK_DECISION);
    expect(sortedUnique(parseUndispositionedIds(withoutCurrentTurn.stderr))).toEqual([
      TWO_AND_TWO_IDS[3] as string,
    ]);
  });

  it("BOUNDARY: an accounting that PREDATES the ticket does not count — the window opens at the render, so a re-handed ticket is a fresh obligation", () => {
    const transcriptPath = writeTranscript(tmpDir, [
      assistantTextEntry(fullAccounting(TWO_AND_TWO_IDS)),
      bashToolUseEntry(TICKET_TOOL_USE_ID, `lore ${FEED_TOKEN} ${SESSION_RESUME_CHECKPOINT}`),
      toolResultEntry(TICKET_TOOL_USE_ID, TWO_AND_TWO_TICKET_TEXT),
    ]);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    expect(parseDecisionPayload(result.stdout).decision).toBe(BLOCK_DECISION);
    expect(sortedUnique(parseUndispositionedIds(result.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
  });
});

// ─── AC-RCH-8 ───────────────────────────────────────────────────────────────

/** One input class and the stdout it must be distinguishable by — the exit status must be identical across all of them (H2). */
interface StatusFixture {
  readonly label: string;
  readonly build: () => unknown;
  readonly expectBlock: boolean;
}

describe("AC-RCH-8 — the exit status carries no verdict", () => {
  const CLASSES: readonly StatusFixture[] = [
    {
      label: "an incomplete accounting",
      build: () => ({ transcript_path: writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT) }),
      expectBlock: true,
    },
    {
      label: "a complete accounting",
      build: () => ({
        transcript_path: writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT),
        last_assistant_message: fullAccounting(TWO_AND_TWO_IDS),
      }),
      expectBlock: false,
    },
    {
      label: "no ticket present in the transcript",
      build: () => ({ transcript_path: writeNoTicketTranscript(tmpDir), last_assistant_message: "anything at all" }),
      expectBlock: false,
    },
    {
      label: "malformed stdin",
      build: () => "{ this is not valid json",
      expectBlock: false,
    },
    {
      label: "an unreadable transcript path",
      build: () => ({ transcript_path: join(tmpDir, "does-not-exist.jsonl"), last_assistant_message: "irrelevant" }),
      expectBlock: false,
    },
  ];

  it("STATE: all five payload classes terminate with the IDENTICAL status, and only stdout tells them apart", () => {
    const observed = CLASSES.map((klass) => ({ label: klass.label, ...runCoverageCheck(klass.build()) }));

    // The status is uninformative BY DESIGN — asserted as a single distinct
    // value across every class, so a later change that re-loads the verdict
    // onto the status fails here rather than passing an "exits non-zero" AC.
    expect(sortedUnique(observed.map((o) => String(o.exitCode)))).toEqual(["0"]);

    for (const [index, klass] of CLASSES.entries()) {
      const result = observed[index] as (typeof observed)[number];
      if (klass.expectBlock) {
        expect(parseDecisionPayload(result.stdout).decision, klass.label).toBe(BLOCK_DECISION);
      } else {
        expect(result.stdout, klass.label).toBe("");
      }
    }
    // The array is only meaningful if it holds BOTH a distinguishable class and
    // several indistinguishable ones — otherwise "all statuses equal" is trivial.
    expect(observed).toHaveLength(5);
    expect(CLASSES.filter((k) => k.expectBlock)).toHaveLength(1);
  });
});

// ─── AC-RCS-1 ───────────────────────────────────────────────────────────────
//
// spec-resume-coverage-floor-the-satisfaction-boundaries-a S1: an accepted
// deferral requires a non-empty reason after RESUME_DISPOSITION_DEFERRED_PREFIX.

describe("AC-RCS-1 — an accepted deferral requires a non-empty reason (S1: deferral reason)", () => {
  /** One `last_assistant_message` payload class against the TWO_AND_TWO fixture (N=4 items) and the verdict it must produce. */
  interface DeferralReasonFixture {
    readonly label: string;
    readonly message: (ids: readonly string[]) => string;
    readonly expectBlock: boolean;
  }

  const DEFERRAL_REASON_FIXTURES: readonly DeferralReasonFixture[] = [
    {
      label: "every item deferred with NOTHING after the colon (bare prefix) still blocks",
      message: (ids) => ids.map((id) => dispositionLine(id, RESUME_DISPOSITION_DEFERRED_PREFIX)).join("\n"),
      expectBlock: true,
    },
    {
      label: "every item deferred with ONLY WHITESPACE after the colon still blocks",
      message: (ids) => ids.map((id) => dispositionLine(id, `${RESUME_DISPOSITION_DEFERRED_PREFIX}   `)).join("\n"),
      expectBlock: true,
    },
    {
      // ⚠️ RE-BASELINED 2026-08-25 (spec-resume-coverage-floor-the-satisfaction-boundaries-a
      // S4): this payload formerly carried a reason with NO destination
      // token, which S4 now blocks — the old payload and S4's negative arm
      // (below, "deferral destination" describe block) were mutually
      // unsatisfiable. The control payload is now STRICTER (it must satisfy
      // S1 AND S4), not weaker: no assertion here is dropped.
      label: "control: every item deferred with a NON-EMPTY reason AND an S4 destination token closes cleanly",
      message: (ids) =>
        ids
          .map((id) => dispositionLine(id, `${RESUME_DISPOSITION_DEFERRED_PREFIX}out of scope, see issue #5`))
          .join("\n"),
      expectBlock: false,
    },
    {
      label: "control: every item marked done closes cleanly",
      message: (ids) => ids.map((id) => dispositionLine(id, RESUME_DISPOSITION_DONE)).join("\n"),
      expectBlock: false,
    },
    {
      label: "control: no disposition lines at all still blocks — the detector was armed and capable of blocking",
      message: () => "no accounting whatsoever",
      expectBlock: true,
    },
  ];

  it("BOUNDARY: the fixture array covers both a blocking half and a control half — an emptied or one-sided array registers no vacuous pass", () => {
    expect(DEFERRAL_REASON_FIXTURES.filter((f) => f.expectBlock).length).toBeGreaterThanOrEqual(2);
    expect(DEFERRAL_REASON_FIXTURES.filter((f) => !f.expectBlock).length).toBeGreaterThanOrEqual(2);
    expect(sortedUnique(DEFERRAL_REASON_FIXTURES.map((f) => f.label))).toHaveLength(DEFERRAL_REASON_FIXTURES.length);
    // N>=2: the fixture ticket carries 4 items (2 key decisions, 2 next steps).
    expect(TWO_AND_TWO_IDS.length).toBeGreaterThanOrEqual(2);
  });

  for (const fixture of DEFERRAL_REASON_FIXTURES) {
    it(`${fixture.expectBlock ? "NEGATIVE" : "HAPPY"}: ${fixture.label}`, () => {
      const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);

      const result = runCoverageCheck({
        transcript_path: transcriptPath,
        last_assistant_message: fixture.message(TWO_AND_TWO_IDS),
      });

      expect(result.exitCode).toBe(0);
      if (fixture.expectBlock) {
        const payload = parseDecisionPayload(result.stdout);
        expect(payload.decision).toBe(BLOCK_DECISION);
        // Set-equality both ways: an empty reason must close NO item, so
        // naming extra or fewer ids than the full set fails.
        expect(sortedUnique(parseUndispositionedIds(result.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
      } else {
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
      }
    });
  }
});

// ─── AC-RCS-2 ───────────────────────────────────────────────────────────────
//
// spec-resume-coverage-floor-the-satisfaction-boundaries-a S2: dispositions
// satisfy only from main-chain entries; arming stays chain-blind.

describe("AC-RCS-2 — a sidechain disposition does not satisfy, but a sidechain-produced ticket still arms (S2: sidechain)", () => {
  /**
   * Tags a transcript entry object with a TOP-LEVEL `isSidechain` field —
   * spreads onto whatever shape the base builder produced. Measured
   * 2026-08-01 against real transcripts: `isSidechain` sits alongside `type`
   * on the entry itself, never nested under `message`.
   */
  function withIsSidechain(entry: unknown, isSidechain: boolean): unknown {
    return { ...(entry as Record<string, unknown>), isSidechain };
  }

  it("NEGATIVE: a disposition-bearing entry with isSidechain exactly true does not satisfy — the full item set stays unaccounted", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT, [
      withIsSidechain(assistantTextEntry(fullAccounting(TWO_AND_TWO_IDS)), true),
    ]);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    const payload = parseDecisionPayload(result.stdout);
    expect(payload.decision).toBe(BLOCK_DECISION);
    expect(sortedUnique(parseUndispositionedIds(result.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
  });

  it("HAPPY control: the BYTE-IDENTICAL disposition text at isSidechain:false DOES satisfy — the negative above is not a parser that stopped reading transcript dispositions altogether", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT, [
      withIsSidechain(assistantTextEntry(fullAccounting(TWO_AND_TWO_IDS)), false),
    ]);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("HAPPY: a ticket whose PRODUCING tool_use and tool_result entries both carry isSidechain:true still ARMS — arming is chain-blind while satisfaction is filtered", () => {
    const transcriptPath = writeTranscript(tmpDir, [
      withIsSidechain(bashToolUseEntry(TICKET_TOOL_USE_ID, `lore ${FEED_TOKEN} ${SESSION_RESUME_CHECKPOINT}`), true),
      withIsSidechain(toolResultEntry(TICKET_TOOL_USE_ID, TWO_AND_TWO_TICKET_TEXT), true),
    ]);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    const payload = parseDecisionPayload(result.stdout);
    expect(payload.decision).toBe(BLOCK_DECISION);
    expect(sortedUnique(parseUndispositionedIds(result.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
  });

  it("BOUNDARY: a disposition-bearing entry with the isSidechain field entirely ABSENT still satisfies — strict equality to true, never truthiness", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT, [
      assistantTextEntry(fullAccounting(TWO_AND_TWO_IDS)),
    ]);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

// ─── AC-RCS-4 ───────────────────────────────────────────────────────────────
//
// spec-resume-coverage-floor-the-satisfaction-boundaries-a S4 (Hole 3): a
// deferral reason alone is not a destination. `deferred:out of scope for
// this session` satisfies S1 (non-empty reason) and still fails S4 (no
// destination token) — measured over this corpus's own 139 handoff docs:
// 458 of 696 next-step items (65.8%) were bare prose parking nothing
// anywhere. S4's refusal must be distinguishable from S1's bare-deferral
// refusal — "no reason given" and "a reason that parks the work nowhere" are
// different operator mistakes with different fixes.

describe("deferral destination", () => {
  /** S1-satisfying reason (non-empty) that names NO destination — Hole 3's measured propagation vector. */
  const REASON_NO_DESTINATION = "out of scope for this session";

  it("(a) NEGATIVE: a reason with no destination token leaves its item unaccounted and blocks", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, ZERO_DECISIONS_TICKET_TEXT);
    const id = expectedIdsFor(ZERO_DECISIONS_EXTRA)[0] as string;
    const message = dispositionLine(id, `${RESUME_DISPOSITION_DEFERRED_PREFIX}${REASON_NO_DESTINATION}`);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    const payload = parseDecisionPayload(result.stdout);
    expect(payload.decision).toBe(BLOCK_DECISION);
  });

  it("(b) INJECTIVITY: the stderr the verb ACTUALLY EMITS startsWith the destination-refusal prefix exported from @lore/core, AND that constant is not byte-equal to the bare-deferral prefix", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, ZERO_DECISIONS_TICKET_TEXT);
    const id = expectedIdsFor(ZERO_DECISIONS_EXTRA)[0] as string;
    const message = dispositionLine(id, `${RESUME_DISPOSITION_DEFERRED_PREFIX}${REASON_NO_DESTINATION}`);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    // Conjunct 1: asserted on the EMITTED BYTES, not merely on the constants
    // — a verb that mis-routes this failure through UNDISPOSITIONED_PREFIX
    // would still pass a constants-only distinctness check but fail this.
    const stderrLines = result.stderr.split("\n").filter((line) => line.length > 0);
    expect(stderrLines).toHaveLength(1);
    expect((stderrLines[0] as string).startsWith(RESUME_DISPOSITION_MISSING_DESTINATION_STDERR_PREFIX)).toBe(true);
    expect(stderrLines[0]).toContain(id);
    // Never through the bare-deferral (S1) generic prefix — that would be
    // exactly the mis-routing this front exists to catch.
    expect(parseUndispositionedIds(result.stderr)).toEqual([]);
    // Conjunct 2: the constants themselves are byte-distinct, never merely
    // their emitted uses — containment is explicitly forbidden by the
    // criterion, so this is `!==` identity, not `toContain`.
    expect(RESUME_DISPOSITION_MISSING_DESTINATION_STDERR_PREFIX).not.toBe(UNDISPOSITIONED_PREFIX);
    expect(RESUME_DISPOSITION_MISSING_DESTINATION_STDERR_PREFIX.length).toBeGreaterThan(0);
  });

  it("(c) CONTROL 1: the same reason plus an issue reference closes and does not block", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, ZERO_DECISIONS_TICKET_TEXT);
    const id = expectedIdsFor(ZERO_DECISIONS_EXTRA)[0] as string;
    const message = dispositionLine(id, `${RESUME_DISPOSITION_DEFERRED_PREFIX}${REASON_NO_DESTINATION}, see issue #5`);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("(d) CONTROL 2: the same reason plus a corpus slug closes and does not block", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, ZERO_DECISIONS_TICKET_TEXT);
    const id = expectedIdsFor(ZERO_DECISIONS_EXTRA)[0] as string;
    const message = dispositionLine(
      id,
      `${RESUME_DISPOSITION_DEFERRED_PREFIX}${REASON_NO_DESTINATION}, tracked in task-some-filed-thing`,
    );

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("(e) CONTROL 3: `done` on the same fixture closes and does not block", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, ZERO_DECISIONS_TICKET_TEXT);
    const id = expectedIdsFor(ZERO_DECISIONS_EXTRA)[0] as string;
    const message = dispositionLine(id, RESUME_DISPOSITION_DONE);

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("IMPLEMENTATION CONTRACT: the predicate is reached through exactly one call site written literally as `!hasDeferralDestination(` in the verb's own source", () => {
    const source = readFileSync(VERB_SOURCE_PATH, "utf8");
    expect(countOccurrences(source, "!hasDeferralDestination(")).toBe(1);
  });
});

// ─── NEGATIVE — the disposition grammar rejects what it must ────────────────

describe("NEGATIVE — an accounting must use one of the two accepted dispositions (D5)", () => {
  // task-resume-coverage-disposition-parser-an-unrecognised-token: both cases
  // below name a REAL item id with a token matching NEITHER accepted form's
  // shape at all ("maybe later" has no colon at all; "deferred" — missing its
  // trailing colon — does not even start with RESUME_DISPOSITION_DEFERRED_PREFIX).
  // Before that task, both were reported identically to a truly-never-mentioned
  // id via UNDISPOSITIONED_PREFIX — a false claim, since the parser had already
  // recovered the item id. They must now surface via the DISTINCT
  // UNRECOGNIZED_DISPOSITION_PREFIX channel instead (full coverage in the
  // dedicated describe block below); asserted here only as the regression
  // guard that they are no longer reported through the generic prefix.
  it("a marker line carrying an unrecognized disposition token is not an accounting, and is NOT reported through the generic 'never mentioned' prefix", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const message = TWO_AND_TWO_IDS.map((id) => dispositionLine(id, "maybe later")).join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(parseDecisionPayload(result.stdout).decision).toBe(BLOCK_DECISION);
    // Still unaccounted (every id remains open)…
    expect(sortedUnique(parseUnrecognizedDispositionIds(result.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
    // …but NOT via the "never mentioned" prefix — the parser recovered every
    // one of these ids, so reporting them as unmentioned would be false.
    expect(parseUndispositionedIds(result.stderr)).toEqual([]);
  });

  it("a disposition token missing its colon entirely (bare 'deferred', not 'deferred:') matches neither accepted form and is NOT reported through the generic 'never mentioned' prefix", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    // `RESUME_DISPOSITION_DEFERRED_PREFIX` minus its trailing colon: the token
    // is derived from the export, never re-typed. Without the colon this does
    // NOT start with the prefix at all — a different case from S1's bare
    // `deferred:` (empty reason AFTER a recognized prefix), which is covered
    // separately by the AC-RCS-1 describe block and stays on the generic path.
    const bareDeferred = RESUME_DISPOSITION_DEFERRED_PREFIX.replace(/:$/, "");
    expect(bareDeferred).not.toBe(RESUME_DISPOSITION_DEFERRED_PREFIX);
    expect(bareDeferred.startsWith(RESUME_DISPOSITION_DEFERRED_PREFIX)).toBe(false);
    const message = TWO_AND_TWO_IDS.map((id) => dispositionLine(id, bareDeferred)).join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(parseDecisionPayload(result.stdout).decision).toBe(BLOCK_DECISION);
    expect(sortedUnique(parseUnrecognizedDispositionIds(result.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
    expect(parseUndispositionedIds(result.stderr)).toEqual([]);
  });

  it("a text with no marker at all leaves every id unaccounted", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);

    const result = runCoverageCheck({
      transcript_path: transcriptPath,
      last_assistant_message: `${TWO_AND_TWO_IDS.join(", ")} are all handled, trust me`,
    });

    expect(sortedUnique(parseUndispositionedIds(result.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
  });
});

// ─── task-resume-coverage-disposition-parser-an-unrecognised-token ─────────
//
// The defect: a recognized item id carrying an unrecognized disposition token
// was reported identically to an item never mentioned at all — a claim the
// parser knew to be false, since it had already recovered the item id. Fixed
// by splitting the "missing" outcome into two distinguishable diagnostics
// (UNRECOGNIZED_DISPOSITION_PREFIX vs. UNDISPOSITIONED_PREFIX), asserted on
// BOTH channels the verb writes to: stderr (the operator channel) and the
// stdout `reason` (the ONLY channel the acting model itself ever sees, per
// H1/H2 — this is why the live incident happened at all: the model read a
// misleading "unaccounted for" claim about an item it had, in fact, named).

describe("task-resume-coverage-disposition-parser-an-unrecognised-token — an unrecognized token on a KNOWN item id fails loud, distinct from 'never mentioned'", () => {
  it("NEGATIVE: a real ticket item named with an unrecognized token produces a diagnostic containing that item id AND the verbatim token, on both stderr and the stdout reason", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const targetId = TWO_AND_TWO_IDS[1] as string;
    const rawToken = "maybe later, need to check with the team first";
    // The other three ids are fully (and validly) accounted for, so only
    // `targetId` can possibly appear in either diagnostic channel below — a
    // sharper assertion than checking set membership over all four.
    const otherIds = TWO_AND_TWO_IDS.filter((id) => id !== targetId);
    const message = [dispositionLine(targetId, rawToken), fullAccounting(otherIds)].join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    const reason = blockReasonOf(result);
    // Assert on the TOKEN SUBSTRING itself, not a remembered phrase of the
    // whole message — a rewritten prose template must not make this vacuous.
    expect(reason).toContain(targetId);
    expect(reason).toContain(rawToken);
    expect(result.stderr).toContain(targetId);
    expect(result.stderr).toContain(rawToken);
    // The two accepted forms must be stated too (requirement 1), composed
    // from the SAME exported constants the verb parses with, never a
    // hand-typed copy.
    expect(reason).toContain(RESUME_DISPOSITION_DONE);
    expect(reason).toContain(RESUME_DISPOSITION_DEFERRED_PREFIX);

    // It must NOT be reported as an unmentioned item: the only id in this
    // fixture ever unaccounted for is `targetId`, and it must surface
    // EXCLUSIVELY via the unrecognized-token channel.
    expect(parseUnrecognizedDispositionIds(result.stderr)).toEqual([targetId]);
    expect(parseUndispositionedIds(result.stderr)).toEqual([]);
  });

  it("CONTROL: a message naming NO ticket item at all (no marker, just garbage) produces no unrecognized-token diagnostic — silence stays correct for 'does not concern a ticket item'", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);

    const result = runCoverageCheck({
      transcript_path: transcriptPath,
      last_assistant_message: "totally unrelated prose, no marker, no colon-shaped item reference anywhere",
    });

    // Positive control FIRST (anti-vacuity): the SAME fixture class, with a
    // marker line naming a real id, DOES fire the diagnostic (proven by the
    // NEGATIVE test above) — so this empty result is a measured absence, not
    // a detector that never runs.
    expect(parseUnrecognizedDispositionIds(result.stderr)).toEqual([]);
    // Case (1) is still correctly silent-as-generic: every id is unmentioned,
    // reported the ORIGINAL way.
    expect(sortedUnique(parseUndispositionedIds(result.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
  });

  it("CONTROL: a marker line naming an id NOT part of this ticket, with a garbled token, produces no diagnostic of any kind once every REAL id is validly accounted for", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const foreignId = "KD99"; // not one of TWO_AND_TWO_IDS — this ticket only ever printed KD1/KD2/NS1/NS2
    expect(TWO_AND_TWO_IDS).not.toContain(foreignId);
    const message = [fullAccounting(TWO_AND_TWO_IDS), dispositionLine(foreignId, "garbled nonsense")].join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("BOUNDARY: the exact live failure — `done` immediately followed by a non-ASCII em-dash and a reason, no separator at all", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const targetId = TWO_AND_TWO_IDS[3] as string;
    // Measured live 2026-08-01: `done` directly touching U+2014 EM DASH
    // (doubled), no space — NOT `done ` + a dash, which would not reproduce
    // this: the absence of any separator is the point.
    const rawToken = `${RESUME_DISPOSITION_DONE}——git branch -a shows only main, the named stale branch no longer exists`;
    expect(rawToken.startsWith(`${RESUME_DISPOSITION_DONE} `)).toBe(false);
    expect(rawToken).not.toBe(RESUME_DISPOSITION_DONE);
    const otherIds = TWO_AND_TWO_IDS.filter((id) => id !== targetId);
    const message = [dispositionLine(targetId, rawToken), fullAccounting(otherIds)].join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    const reason = blockReasonOf(result);
    // The literal character, not an ASCII stand-in — `done--reason` would
    // pass against code that still mishandles U+2014 specifically.
    expect(reason).toContain(rawToken);
    expect(result.stderr).toContain(rawToken);
    expect(parseUnrecognizedDispositionIds(result.stderr)).toEqual([targetId]);
    expect(parseUndispositionedIds(result.stderr)).toEqual([]);
  });

  it("ERROR: a token embedding a literal double-quote character does not crash the verb and still surfaces as a plain substring", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const targetId = TWO_AND_TWO_IDS[0] as string;
    const rawToken = `done, or so I thought — see "the incident notes" for why it wasn't`;
    const otherIds = TWO_AND_TWO_IDS.filter((id) => id !== targetId);
    const message = [dispositionLine(targetId, rawToken), fullAccounting(otherIds)].join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    // A crash would leave stdout unparseable — parseDecisionPayload itself
    // throws on that, so this call is the "did not crash" assertion.
    const reason = blockReasonOf(result);
    expect(reason).toContain(rawToken);
    expect(result.stderr).toContain(rawToken);
  });

  it("STATE: an id first named with an unrecognized token in an EARLIER turn, then correctly dispositioned later, closes cleanly with no diagnostic at all", () => {
    const targetId = TWO_AND_TWO_IDS[2] as string;
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT, [
      assistantTextEntry(dispositionLine(targetId, "not sure yet, will decide")),
    ]);

    const result = runCoverageCheck({
      transcript_path: transcriptPath,
      last_assistant_message: fullAccounting(TWO_AND_TWO_IDS),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");

    // Self-guard: WITHOUT the corrective final accounting, that same stale
    // malformed attempt surfaces via the unrecognized-token channel — proving
    // it was real and the clean close above is attributable to the later
    // correction, not to the malformed attempt never having been read.
    const withoutCorrection = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: "" });
    expect(parseUnrecognizedDispositionIds(withoutCorrection.stderr)).toEqual([targetId]);
  });

  it("REGRESSION: bare `done` and `deferred:<reason>` are both still accepted with no diagnostic of either kind", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);

    const result = runCoverageCheck({
      transcript_path: transcriptPath,
      last_assistant_message: fullAccounting(TWO_AND_TWO_IDS), // alternates RESUME_DISPOSITION_DONE / RESUME_DISPOSITION_DEFERRED_PREFIX+reason
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("REGRESSION: a bare/whitespace-only `deferred:` (S1) is still REJECTED, and still ONLY through the ORIGINAL generic prefix — never the new unrecognized-token one", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const message = TWO_AND_TWO_IDS.map((id) => dispositionLine(id, `${RESUME_DISPOSITION_DEFERRED_PREFIX}   `)).join(
      "\n",
    );

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    expect(parseDecisionPayload(result.stdout).decision).toBe(BLOCK_DECISION);
    // S1's classification (task requirement 2/3: "assert unchanged") — this
    // is the discriminator this task's fix must NOT blur: a token that DOES
    // start with the accepted prefix but fails only the non-empty-reason
    // check stays on the pre-existing generic path.
    expect(sortedUnique(parseUndispositionedIds(result.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
    expect(parseUnrecognizedDispositionIds(result.stderr)).toEqual([]);
  });
});

// ─── task-the-resume-coverage-verb-accepts-a-reason-after-deferred ─────────
//
// The defect: `deferred:<reason>` requires and parses a reason, but `done`
// forbade one outright — appending a reason after `done` invalidated the
// token entirely, punishing the more informative disposition (an author
// explaining a completion's own evidence, exactly this repo's own evidence
// discipline). Measured live TWICE against real handoff tickets
// (2026-08-02 against knowledge-handoff-agent-main-orchestrator-70,
// 2026-08-03 against -77) — both times `done — <evidence>` was rejected.
// Fixed by widening `isAcceptedDoneDisposition` to also recognize
// `done:<reason>` and `done — <reason>` (a SPACE then U+2014 EM DASH),
// discarding the trailing text — never a second diagnostic, never a round
// trip, for exactly the two forms Required #1 names.

describe("task-the-resume-coverage-verb-accepts-a-reason-after-deferred — a reason after `done` is accepted, not rejected", () => {
  it("NEGATIVE (fails before this fix): `done:<reason>` (colon form) is accepted — full accounting, empty stdout, no diagnostic of any kind", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const message = TWO_AND_TWO_IDS.map((id) =>
      dispositionLine(id, `${RESUME_DISPOSITION_DONE}:shipped in commit abc123`),
    ).join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("NEGATIVE (fails before this fix): `done — <reason>` (space + U+2014 em dash + space, the exact live-measured natural-language form) is accepted — full accounting, empty stdout, no diagnostic", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    // The literal em dash character (U+2014), not an ASCII hyphen — matches
    // the measured incident text (`done — 作为本轮基线消费…`).
    const message = TWO_AND_TWO_IDS.map((id) =>
      dispositionLine(id, `${RESUME_DISPOSITION_DONE} — 作为本轮基线消费的证据`),
    ).join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("STATE: bare `done`, `done:<reason>`, `done — <reason>`, and `deferred:<reason>` all accepted TOGETHER across the same ticket's four items", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const dispositions = [
      RESUME_DISPOSITION_DONE,
      `${RESUME_DISPOSITION_DONE}:shipped in commit abc123`,
      `${RESUME_DISPOSITION_DONE} — verified via bun test, all green`,
      // S4 destination token added — a bare "out of scope for this session"
      // (no destination) would now BLOCK, and this test's own point is that
      // all four forms close cleanly TOGETHER.
      `${RESUME_DISPOSITION_DEFERRED_PREFIX}out of scope for this session, see issue #5`,
    ];
    expect(dispositions).toHaveLength(TWO_AND_TWO_IDS.length);
    const message = TWO_AND_TWO_IDS.map((id, i) => dispositionLine(id, dispositions[i] as string)).join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("REGRESSION: a genuinely unmentioned item is STILL reported as unaccounted — this fix widens acceptance, it does not fabricate coverage for an item never named at all", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const mentioned = TWO_AND_TWO_IDS.slice(0, 3);
    const unmentioned = TWO_AND_TWO_IDS[3] as string;
    const message = mentioned
      .map((id) => dispositionLine(id, `${RESUME_DISPOSITION_DONE} — with a reason attached`))
      .join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(parseDecisionPayload(result.stdout).decision).toBe(BLOCK_DECISION);
    expect(sortedUnique(parseUndispositionedIds(result.stderr))).toEqual([unmentioned]);
    expect(parseUnrecognizedDispositionIds(result.stderr)).toEqual([]);
  });

  it("REGRESSION: `deferred:<reason>` with a genuine non-empty reason is STILL accepted, unaffected by this fix — only the `done` side of the grammar changed", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    // S4 destination token added — this test's point is the `done`-widening
    // fix left `deferred:<reason>` alone; it is not exercising S4 (covered by
    // the "deferral destination" describe block below), so the reason must
    // satisfy S4 too or this test would block for an unrelated cause.
    const message = TWO_AND_TWO_IDS.map((id) =>
      dispositionLine(id, `${RESUME_DISPOSITION_DEFERRED_PREFIX}next session, see issue #5`),
    ).join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("BOUNDARY/REGRESSION: `deferred:` with an empty reason is STILL rejected via the original generic 'unaccounted' path — requiring a non-empty deferral reason (S1) is unchanged", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const message = TWO_AND_TWO_IDS.map((id) => dispositionLine(id, RESUME_DISPOSITION_DEFERRED_PREFIX)).join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(parseDecisionPayload(result.stdout).decision).toBe(BLOCK_DECISION);
    expect(sortedUnique(parseUndispositionedIds(result.stderr))).toEqual(sortedUnique(TWO_AND_TWO_IDS));
    expect(parseUnrecognizedDispositionIds(result.stderr)).toEqual([]);
  });

  it("BOUNDARY: bare `done` with trailing whitespace only is STILL accepted, unchanged by this fix", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const message = TWO_AND_TWO_IDS.map((id) => dispositionLine(id, `${RESUME_DISPOSITION_DONE}   `)).join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("BOUNDARY: the glued/doubled-em-dash form with NO space at all (the OTHER, already-fixed live incident) stays unrecognized — the widened acceptance does not swallow it", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const targetId = TWO_AND_TWO_IDS[0] as string;
    // Same shape as the OTHER sibling task's own BOUNDARY fixture: `done`
    // directly touching a DOUBLED em dash, zero whitespace before it. This
    // fix's separator pattern requires `\s+` before the dash, so this string
    // must still fall through to `unrecognized`, never to `accepted`.
    const rawToken = `${RESUME_DISPOSITION_DONE}——no space at all before the dash`;
    const otherIds = TWO_AND_TWO_IDS.filter((id) => id !== targetId);
    const message = [dispositionLine(targetId, rawToken), fullAccounting(otherIds)].join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(parseDecisionPayload(result.stdout).decision).toBe(BLOCK_DECISION);
    expect(parseUnrecognizedDispositionIds(result.stderr)).toEqual([targetId]);
    expect(parseUndispositionedIds(result.stderr)).toEqual([]);
  });

  it("BOUNDARY: `done:` with nothing after the colon is still accepted — a completion's reason, unlike a deferral's, has no non-empty requirement", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const message = TWO_AND_TWO_IDS.map((id) => dispositionLine(id, `${RESUME_DISPOSITION_DONE}:`)).join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("REGRESSION: the unrecognized-token message names all THREE accepted completion forms plus the deferral form, composed from exported constants where they exist", () => {
    const transcriptPath = writeArmedTicketTranscript(tmpDir, TWO_AND_TWO_TICKET_TEXT);
    const targetId = TWO_AND_TWO_IDS[0] as string;
    const otherIds = TWO_AND_TWO_IDS.filter((id) => id !== targetId);
    const message = [dispositionLine(targetId, "not sure yet"), fullAccounting(otherIds)].join("\n");

    const result = runCoverageCheck({ transcript_path: transcriptPath, last_assistant_message: message });

    const reason = blockReasonOf(result);
    expect(reason).toContain(RESUME_DISPOSITION_DONE);
    expect(reason).toContain(RESUME_DISPOSITION_DEFERRED_PREFIX);
    // The colon and em-dash separator forms are presented too, so an author
    // reading this message can actually discover the widened grammar.
    expect(reason).toContain(`${RESUME_DISPOSITION_DONE}:<reason>`);
    expect(reason).toContain(`${RESUME_DISPOSITION_DONE} — <reason>`);
  });
});

// ─── ERROR — degraded inputs degrade, never crash ───────────────────────────

describe("ERROR — a degraded input never crashes and never fabricates an obligation", () => {
  it("empty stdin degrades to 'no ticket' with nothing on either channel", () => {
    const result = runCoverageCheck("");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("stdin that parses to a non-object degrades to 'no ticket'", () => {
    const result = runCoverageCheck("[1, 2, 3]");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("a transcript of unparseable JSONL lines degrades to 'no ticket' rather than throwing", () => {
    const path = join(tmpDir, "garbage.jsonl");
    writeFileSync(path, "not json at all\n{\"partial\": \n\n");

    const result = runCoverageCheck({ transcript_path: path, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("a non-string transcript_path is ignored rather than coerced into a filesystem read", () => {
    const result = runCoverageCheck({ transcript_path: 42, last_assistant_message: "" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});

// ─── REGRESSION — pre-existing surfaces ─────────────────────────────────────

describe("REGRESSION — the subcommand positional leaves the write path untouched", () => {
  it("the default write path's flag validation is unchanged (missing --next still exits 2)", () => {
    const result = runHandoffWrite(["--file", "a.ts"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("next_steps");
  });

  it("an unknown subcommand exits 2, naming the offending token", () => {
    const result = runHandoffWrite(["bogus-subcommand"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("bogus-subcommand");
  });
});
