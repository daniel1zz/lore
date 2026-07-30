/**
 * lore handoff — SPEC-041 S2 lossless session-continuity handoff authoring surface,
 * PLUS the `coverage-check` subcommand (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 * D6, D8, D9, D10).
 *
 * ── Default (write) path ──────────────────────────────────────────────────────
 *
 * PRIMARY path: `--json-file <path>` — the file IS the `extra.handoff` SSOT payload
 * (D6: "the JSON IS the extra.handoff SSOT — no fork"). Human convenience path:
 * repeatable `--file` / `--decision "<judgment>[@<conf>]"` / `--next` flags, plus
 * `--failing-command` + `--failing-tail-file` (mutually required). `--plan`/`--by`
 * work with BOTH paths (D6) — passed explicitly, they override the json-file's own
 * `plan_ref`/`by`; omitted, the json-file's own values are left untouched. The two
 * paths are otherwise mutually exclusive: `--json-file` rejects any field flag
 * (`--file`/`--decision`/`--next`/`--failing-command`/`--failing-tail-file`).
 *
 * Both paths funnel through the SAME `handoffExtraSchema` validation before calling
 * `SessionService.writeHandoff` — a Zod failure (including the schema's
 * `next_steps.min(1)` constraint — "a handoff naming no next step is a status
 * report, not a handoff") prints a field-precise message and exits 2.
 * `SessionService`-level errors (e.g. an unresolvable `--plan`) map through the
 * normal `exitCode()`/`formatError()` pipeline (VALIDATION_ERROR → 4).
 *
 * The pure candidate-assembly/parsing functions (`parseDecisionFlag`,
 * `assembleHandoffInput`, `parseHandoffJsonFile`) live in `../handoff-input.js`,
 * NOT this file — this file transitively imports `loader.ts` (`bun:sqlite`), which
 * vitest cannot resolve, so `session-roundtrip.test.ts` (AC-SL-7) imports them from
 * that sibling module instead (mirrors `assess-render.ts`'s split for
 * `commands/assess.ts`, `packages/lore/src/adapters/cli/CLAUDE.md`).
 *
 * There is deliberately no `--content`/`--content-file` flag, ever — a
 * hand-authored body would fork the SSOT; `content` is always the deterministic
 * `renderHandoffContent(extra.handoff)` projection (D6).
 *
 * ── `coverage-check` subcommand ───────────────────────────────────────────────
 *
 * `lore handoff coverage-check` is the SOLE parser of both the rendered
 * resume-ticket grammar (`@lore/core`'s ordinal `KD<n>`/`NS<n>` tags + cardinality
 * line + `RESUME_COVERAGE_FLOOR`) and the disposition-line grammar a consumer
 * writes back (`RESUME_DISPOSITION_MARKER <id>: done|deferred:<reason>`) — D9: the
 * grammar lives in exactly ONE place, this verb, never duplicated into the Stop
 * hook that calls it (`assets/hooks/stop-handoff-coverage.mjs`, T5, NOT edited
 * here — it is a blind pipe that relays this verb's exit code/stderr verbatim).
 * Dispatched via a leading OPTIONAL positional (`args.subcommand`), NOT citty's
 * own `subCommands` mechanism: citty's `runCommand` invokes a matched subcommand
 * AND STILL calls the parent's own `run()` afterwards (verified against
 * `citty/dist/index.mjs`'s `runCommand`), which would run this file's write path
 * a second time with no flags supplied — the same "manual positional dispatch"
 * pattern `commands/seat.ts`/`commands/context.ts` already use for the identical
 * reason. Reads its input from ITS OWN stdin (`CoverageCheckStdinPayload`, D8/D9's
 * doc below explains why stdin rather than flags), never touches the corpus/store,
 * and never routes through `assets/hooks/lib/turn-state.mjs` (D8 — that module's
 * `resolveSessionId()` reads an env var unset in this harness; a Stop hook and a
 * Bash-tool child resolve DIFFERENT ppids, so side-written state would be invisible
 * across them). Side-effect class: IO (stdin + the transcript file `readFileSync`)
 * — otherwise pure; no store, no network, no wall-clock reads.
 *
 * Source: SPEC-041 §3 D6; spec-resume-ticket-coverage-a-shipped-upper-bound-left-the.
 */

import { readFileSync } from "fs";
import { defineCommand } from "citty";
import {
  handoffExtraSchema,
  tailChars,
  RESUME_COVERAGE_FLOOR,
  RESUME_DISPOSITION_DEFERRED_PREFIX,
  RESUME_DISPOSITION_DONE,
  RESUME_DISPOSITION_MARKER,
  RESUME_ITEM_ID_PREFIX_KEY_DECISION,
  RESUME_ITEM_ID_PREFIX_NEXT_STEP,
  formatResumeItemId,
  renderResumeCoverageCardinalityLine,
} from "@lore/core";
import type { HandoffExtra } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { assembleHandoffInput, parseHandoffJsonFile } from "../handoff-input.js";

/** Field flags mutually exclusive with `--json-file` (D6) — `--plan`/`--by` are NOT in this list; they work with both paths. */
const FIELD_FLAGS = ["file", "decision", "next", "failing-command", "failing-tail-file"] as const;

/** The only recognized `lore handoff` subcommand positional (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D9). Any other non-empty positional is a usage error (exit 2); omitted entirely, the command runs its default write path unchanged. */
const COVERAGE_CHECK_SUBCOMMAND = "coverage-check";

/**
 * Own presentation literal — NOT part of the shared grammar D9 pins to
 * `@lore/core` (that grammar is the ticket/disposition format this verb
 * PARSES, not the format it uses to REPORT its own verdict). One
 * undispositioned item id per stderr line, behind a fixed, greppable prefix
 * so a consumer/test parses exact ids rather than scraping free text.
 */
const UNDISPOSITIONED_ITEM_STDERR_PREFIX = "Undispositioned resume ticket item: ";

/**
 * Shape this verb reads from ITS OWN stdin
 * (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the D8, D9). The
 * Stop hook that calls this verb (`assets/hooks/stop-handoff-coverage.mjs`,
 * T5, NOT edited here) is a blind pipe: it parses the Stop payload's JSON
 * only far enough to forward these two fields, then relays this verb's exit
 * code and stderr verbatim. Read via stdin rather than CLI flags for two
 * reasons: it mirrors the shape a Stop hook itself receives on ITS OWN
 * stdin (one relay, one shape, D9), and it sidesteps OS argv-length limits
 * for `last_assistant_message`, which can carry an entire turn's prose.
 * Fields are `unknown` at this boundary — narrowed defensively in
 * `runCoverageCheck`, never trusted as pre-validated.
 */
interface CoverageCheckStdinPayload {
  readonly transcript_path?: unknown;
  readonly last_assistant_message?: unknown;
}

/** Narrows `unknown` to a plain object so `payload.field` reads are safe without a full schema (this stdin shape is two optional loosely-typed fields, not worth a Zod schema — see `CoverageCheckStdinPayload`'s own doc for why each field is individually coerced instead). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Coerces the Stop payload's `last_assistant_message` field to plain text —
 * mirrors `assets/hooks/stop-doc-sync.mjs`'s own probe-verified handling of
 * the SAME field (string in the common case; `JSON.stringify` as a
 * defensive fallback for any other JSON-serializable shape; empty string
 * when absent or unserializable).
 */
function coerceToPlainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * Extracts the printable text of one Claude Code transcript `tool_result`
 * content block. Measured 2026-07-30 against real transcripts under
 * `~/.claude/projects/-Users-apple-Projects-zz-lore/`: a Bash-tool result's
 * `content` is a plain string; other tool kinds (e.g. the Agent tool) carry
 * an array of `{type:"text", text}` blocks instead — the same shape
 * `stop-doc-sync.mjs` already handles for `assistant` message content,
 * generalized here to `tool_result` blocks. Any other shape yields `""` —
 * never throws.
 */
function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: string; text: string } =>
          isPlainRecord(block) && block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

/**
 * Builds a regex that recognizes `renderResumeCoverageCardinalityLine`'s OWN
 * rendered line and captures its two input counts — derived at RUNTIME from
 * calling the exported renderer with `(0, 0)`, never from a hand-typed copy
 * of its prose (spec D1, D7: text-derived matching against a REMEMBERED
 * literal is exactly the contiguous-substring false-oracle vector this repo
 * has measured five times — a wording change would silently drop the match,
 * and "no ticket found" reading as success is D6's exact failure mode). The
 * zero-args template has exactly three digit runs (the two counts plus their
 * sum); splitting on `"0"` isolates the four fixed text segments around
 * them, which are then regex-escaped and rejoined with `(\d+)` capture
 * groups in their place. A template shape that no longer has EXACTLY three
 * `"0"`s throws immediately — fail loud rather than silently building a
 * matcher that can never match.
 */
function buildCardinalityLineMatcher(): RegExp {
  const zeroTemplate = renderResumeCoverageCardinalityLine(0, 0);
  const segments = zeroTemplate.split("0");
  if (segments.length !== 4) {
    throw new Error(
      `Internal error: renderResumeCoverageCardinalityLine(0, 0) no longer has exactly 3 digit placeholders (got ${segments.length - 1}) — the coverage-check verb's cardinality-line matcher must be updated to match the new template shape.`,
    );
  }
  const escaped = segments.map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`${escaped[0]}(\\d+)${escaped[1]}(\\d+)${escaped[2]}(\\d+)${escaped[3]}`);
}

/** One recovered resume-ticket render: the full source text plus the two counts read off its cardinality line. */
interface FoundTicket {
  readonly text: string;
  readonly keyDecisionsCount: number;
  readonly nextStepsCount: number;
}

/**
 * Scans a Claude Code transcript JSONL file for the MOST RECENT tool-result
 * block whose text carries a genuine `renderResumeCoverageCardinalityLine`
 * line, and returns that block's full text plus the two counts recovered
 * from it. Returns `undefined` when no such block exists — the D6 "no
 * ticket rendered into this session's transcript" case.
 *
 * Read-channel discipline (spec D8): the ticket was rendered in an EARLIER
 * turn, so `transcript_path` is safe to read here — unlike the CURRENT
 * turn's disposition line (read from `last_assistant_message` instead, see
 * `runCoverageCheck` below), the transcript's own newest entry possibly
 * being unflushed at Stop time is irrelevant to an already-earlier ticket.
 *
 * A tool result lands in the transcript as `type: "user"` with
 * `message.content[]` holding `{type:"tool_result", content}` blocks —
 * MEASURED 2026-07-30 against real transcripts, deliberately NOT assumed
 * from `stop-doc-sync.mjs`'s `type:"assistant"` shape, which is a DIFFERENT
 * entry type (an assistant TEXT block, not a tool's stdout).
 */
function findLatestTicket(transcriptText: string): FoundTicket | undefined {
  const matcher = buildCardinalityLineMatcher();
  let latest: FoundTicket | undefined;

  for (const rawLine of transcriptText.split("\n")) {
    if (rawLine.trim().length === 0) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (!isPlainRecord(entry) || entry.type !== "user") continue;
    const message = entry.message;
    if (!isPlainRecord(message) || !Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (!isPlainRecord(block) || block.type !== "tool_result") continue;
      const text = extractToolResultText(block.content);
      const match = matcher.exec(text);
      if (match === null) continue;
      const keyDecisionsCount = Number(match[1]);
      const nextStepsCount = Number(match[2]);
      const total = Number(match[3]);
      if (keyDecisionsCount + nextStepsCount !== total) continue; // coincidental match in unrelated text
      latest = { text, keyDecisionsCount, nextStepsCount };
    }
  }

  return latest;
}

/**
 * Parses `${RESUME_DISPOSITION_MARKER} <item-id>: <disposition>` lines out of
 * the CURRENT turn's final assistant text and returns the set of item ids
 * carrying an ACCEPTED disposition (`RESUME_DISPOSITION_DONE` or
 * `RESUME_DISPOSITION_DEFERRED_PREFIX<reason>` — spec D5: the obligation is
 * to account, not to complete). A line carrying the marker but an
 * unrecognized disposition token is NOT counted as dispositioned — that id
 * then surfaces on stderr, which is the loud-failure behavior D7 requires
 * over a silent accept-anything parse.
 */
function parseDispositionedIds(lastAssistantMessage: string): ReadonlySet<string> {
  const dispositioned = new Set<string>();
  for (const rawLine of lastAssistantMessage.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith(RESUME_DISPOSITION_MARKER)) continue;
    const rest = line.slice(RESUME_DISPOSITION_MARKER.length).trim();
    const colonIndex = rest.indexOf(":");
    if (colonIndex === -1) continue;
    const itemId = rest.slice(0, colonIndex).trim();
    const disposition = rest.slice(colonIndex + 1).trim();
    const isAccepted =
      disposition === RESUME_DISPOSITION_DONE || disposition.startsWith(RESUME_DISPOSITION_DEFERRED_PREFIX);
    if (itemId.length > 0 && isAccepted) dispositioned.add(itemId);
  }
  return dispositioned;
}

/**
 * `lore handoff coverage-check` (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 * D6, D8, D9, D10) — the SOLE parser of both the rendered resume-ticket
 * grammar and the disposition-line grammar. Reads a
 * `CoverageCheckStdinPayload` from its own stdin, never touches the
 * corpus/store, and carries zero cross-process state (D8).
 *
 * Exit behavior is a business-outcome convention, distinct from
 * `exitCode()`'s `LoreError` mapping (mirrors `phase status`'s own
 * documented split):
 *   - No ticket found in the transcript (incl. an unreadable/missing
 *     transcript, or malformed stdin) → exit 0 — D6: no ticket, no ambient
 *     obligation.
 *   - Ticket found but its block carries no `RESUME_COVERAGE_FLOOR` → D10
 *     multi-actor render → exit 0 unconditionally, without inspecting the
 *     disposition line at all.
 *   - Single-record ticket, every recovered item id dispositioned → exit 0.
 *   - Single-record ticket, ≥1 recovered item id undispositioned → exit 1,
 *     each missing id on its own `UNDISPOSITIONED_ITEM_STDERR_PREFIX` line.
 */
function runCoverageCheck(): void {
  let payload: unknown = {};
  try {
    const raw = readFileSync(0, "utf8");
    if (raw.trim().length > 0) payload = JSON.parse(raw);
  } catch {
    payload = {}; // malformed/empty stdin degrades to "no ticket" below (D6) — never a crash
  }

  const transcriptPath =
    isPlainRecord(payload) && typeof payload.transcript_path === "string" ? payload.transcript_path : undefined;
  const lastAssistantMessage = coerceToPlainText(isPlainRecord(payload) ? payload.last_assistant_message : undefined);

  let transcriptText = "";
  if (transcriptPath !== undefined) {
    try {
      transcriptText = readFileSync(transcriptPath, "utf8");
    } catch {
      transcriptText = ""; // unreadable transcript is indistinguishable from "no ticket rendered" (D6)
    }
  }

  const ticket = transcriptText.length > 0 ? findLatestTicket(transcriptText) : undefined;
  if (ticket === undefined) return; // D6: no ticket rendered this session — exit 0

  if (!ticket.text.includes(RESUME_COVERAGE_FLOOR)) return; // D10: multi-actor render — exit 0, disposition line never inspected

  const expectedIds: string[] = [];
  for (let i = 1; i <= ticket.keyDecisionsCount; i++) {
    expectedIds.push(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, i));
  }
  for (let i = 1; i <= ticket.nextStepsCount; i++) {
    expectedIds.push(formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, i));
  }

  const dispositioned = parseDispositionedIds(lastAssistantMessage);
  const missing = expectedIds.filter((id) => !dispositioned.has(id));

  if (missing.length === 0) return; // every item accounted for — exit 0

  for (const id of missing) {
    process.stderr.write(`${UNDISPOSITIONED_ITEM_STDERR_PREFIX}${id}\n`);
  }
  process.exitCode = 1;
}

/** citty/mri yields a single string for one occurrence of a repeatable flag, an array for ≥2, or `undefined` for zero. Normalizes to a string array. */
function normalizeRepeatable(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

export default defineCommand({
  meta: {
    name: "handoff",
    description: "Write a lossless session-continuity handoff document (SPEC-041 S2); or `coverage-check` (Stop-time resume-ticket coverage verb)",
  },
  args: {
    subcommand: {
      type: "positional",
      description:
        "Optional: 'coverage-check' runs the Stop-time resume-ticket coverage verb (reads a JSON payload from stdin). Omit entirely for the default handoff-write path.",
      required: false,
    },
    "json-file": {
      type: "string",
      description:
        "PRIMARY path: path to a handoffExtraSchema-valid JSON file — the file IS the extra.handoff payload. Mutually exclusive with --file/--decision/--next/--failing-command/--failing-tail-file.",
    },
    file: {
      type: "string",
      description: "[repeatable] Modified file path (human path; mutually exclusive with --json-file)",
    },
    decision: {
      type: "string",
      description: '[repeatable] "<judgment>[@<confidence 0-100>]" (human path)',
    },
    next: {
      type: "string",
      description: "[repeatable, required unless --json-file] Next step (human path)",
    },
    "failing-command": {
      type: "string",
      description: "Failing oracle command — requires --failing-tail-file (human path)",
    },
    "failing-tail-file": {
      type: "string",
      description:
        "Path to a file whose last 2000 chars become the failing oracle's output_tail — requires --failing-command (human path)",
    },
    plan: {
      type: "string",
      description: "Plan doc id/slug this handoff's parent should resolve to (works with both paths)",
    },
    by: {
      type: "string",
      description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username (works with both paths)",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
    const subcommand = typeof args.subcommand === "string" ? args.subcommand : undefined;
    if (subcommand === COVERAGE_CHECK_SUBCOMMAND) {
      runCoverageCheck();
      return;
    }
    if (subcommand !== undefined) {
      process.stderr.write(
        `Error: unknown \`lore handoff\` subcommand "${subcommand}" (expected: ${COVERAGE_CHECK_SUBCOMMAND}, or omit for the default write path)\n`,
      );
      process.exitCode = 2;
      return;
    }

    const rawArgv = process.argv.slice(2);
    const jsonFilePassed = typeof args["json-file"] === "string";
    const conflictingFlags = FIELD_FLAGS.filter((f) => rawArgv.includes(`--${f}`));

    if (jsonFilePassed && conflictingFlags.length > 0) {
      process.stderr.write(
        `Error: --json-file is mutually exclusive with ${conflictingFlags.map((f) => `--${f}`).join(", ")}.\n`,
      );
      process.exitCode = 2;
      return;
    }

    const explicitBy = typeof args.by === "string" && args.by.trim() !== "" ? args.by : undefined;
    const explicitPlan = typeof args.plan === "string" && args.plan.trim() !== "" ? args.plan : undefined;

    let candidate: HandoffExtra;

    if (jsonFilePassed) {
      let raw: string;
      try {
        raw = readFileSync(args["json-file"] as string, "utf8");
      } catch (e) {
        process.stderr.write(
          `Error: cannot read --json-file '${args["json-file"] as string}': ${e instanceof Error ? e.message : String(e)}\n`,
        );
        process.exitCode = 2;
        return;
      }

      const parsed = parseHandoffJsonFile(raw, {
        ...(explicitBy !== undefined ? { by: explicitBy } : {}),
        ...(explicitPlan !== undefined ? { plan: explicitPlan } : {}),
      });
      if (!parsed.ok) {
        process.stderr.write(`Error: ${parsed.error}\n`);
        process.exitCode = 2;
        return;
      }
      candidate = parsed.value;
    } else {
      const hasFailingCommand = typeof args["failing-command"] === "string";
      const hasFailingTailFile = typeof args["failing-tail-file"] === "string";
      if (hasFailingCommand !== hasFailingTailFile) {
        process.stderr.write(
          "Error: --failing-command and --failing-tail-file must be passed together.\n",
        );
        process.exitCode = 2;
        return;
      }

      let failingTail: string | undefined;
      if (hasFailingTailFile) {
        try {
          failingTail = tailChars(readFileSync(args["failing-tail-file"] as string, "utf8"), 2000);
        } catch (e) {
          process.stderr.write(
            `Error: cannot read --failing-tail-file '${args["failing-tail-file"] as string}': ${e instanceof Error ? e.message : String(e)}\n`,
          );
          process.exitCode = 2;
          return;
        }
      }

      const assembled = assembleHandoffInput({
        by: resolveActor(explicitBy),
        ...(explicitPlan !== undefined ? { plan: explicitPlan } : {}),
        files: normalizeRepeatable(args.file),
        decisions: normalizeRepeatable(args.decision),
        next: normalizeRepeatable(args.next),
        ...(hasFailingCommand ? { failingCommand: args["failing-command"] as string } : {}),
        ...(failingTail !== undefined ? { failingTail } : {}),
      });

      const validated = handoffExtraSchema.safeParse(assembled);
      if (!validated.success) {
        const issue = validated.error.issues[0];
        process.stderr.write(
          `Error: invalid handoff payload — field '${issue !== undefined ? issue.path.join(".") : "(root)"}': ${issue?.message ?? "validation failed"}\n`,
        );
        process.exitCode = 2;
        return;
      }
      candidate = validated.data;
    }

    const { app } = loadLoreApp();
    try {
      if (app.sessionService === undefined) {
        process.stderr.write("Error: SessionService not wired on this App instance.\n");
        process.exitCode = 1;
        return;
      }

      const result = await app.sessionService.writeHandoff(candidate);
      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const doc = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Recorded handoff by ${candidate.by}`);
        console.log(`  Slug:   ${doc.slug}`);
        console.log(`  Status: ${doc.status} (v${doc.version})`);
        console.log(`\nRun \`lore get ${doc.slug}\` to view the document.`);
      }
    } finally {
      app.close();
    }
  },
});
