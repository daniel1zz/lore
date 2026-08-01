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
 * writes back (`RESUME_DISPOSITION_MARKER <id>: <accepted disposition>`) — D9: the
 * grammar lives in exactly ONE place, this verb, never duplicated into the Stop
 * hook that calls it (`assets/hooks/stop-handoff-coverage.mjs`, T5, NOT edited by
 * either spec — it is a blind pipe that relays this verb's stdout, stderr and
 * exit status verbatim, which is exactly why moving the verdict onto stdout
 * needed no asset edit and no assets-manifest regeneration:
 * spec-resume-ticket-coverage-floor-blocking-channel-arming H1).
 *
 * The VERDICT travels stdout as one Stop-contract block decision, never the
 * exit status (H1/H2). Measured 2026-08-01 over a single 7h46m session: two
 * Stop hooks armed at the same Stop moments with the same model — the one
 * delivering `{"decision":"block","reason":<instruction + required-output
 * template>}` on stdout at exit 0 earned 10/10 compliance, this verb's
 * then-current "exit 1 + one stderr symptom line" earned 0/130. Exit 1 is a
 * NON-blocking status under the Stop contract: it surfaces as a
 * `hook_non_blocking_error` attachment carrying a symptom with no statement of
 * the required output. So after H1 this verb has no deliberate non-zero path at
 * all — incomplete, complete, no-ticket, malformed-stdin and unreadable-transcript
 * are ALL exit 0 and stdout is the only channel that separates them (AC-RCH-8
 * pins that indistinguishability, so a later change cannot quietly re-load the
 * verdict onto the status).
 *
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
 * Source: SPEC-041 §3 D6; spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 * (D5, D6 arming predicate SUPERSEDED, D7, D8, D9, D10);
 * spec-resume-ticket-coverage-floor-blocking-channel-arming H1–H6.
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
import { SESSION_RESUME_CHECKPOINT } from "../../../flows/feed-flow.js";
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
 * The Claude Code Stop-hook contract's blocking decision value
 * (spec-resume-ticket-coverage-floor-blocking-channel-arming H1) — emitted as
 * `{"decision": "block", "reason": <text>}` on stdout at exit 0, the SAME
 * channel and shape `assets/hooks/stop-doc-sync.mjs` uses. That hook is this
 * repo's measured control arm (10/10 turns complied against this verb's
 * previous exit-1 channel's 0/130), which is why the shape is copied rather
 * than invented. Not sourced from a shared constant because the Stop contract
 * is the HARNESS's vocabulary, not lore's corpus grammar — the two other
 * writers of it are an installed `.mjs` asset and the harness itself, neither
 * importable from here.
 */
const STOP_HOOK_BLOCK_DECISION = "block";

/**
 * The `lore` subcommand token whose invocation ARMS this floor
 * (spec-resume-ticket-coverage-floor-blocking-channel-arming H4) — one of the
 * two lone tokens a Bash-shaped originating call must carry, the other being
 * {@link SESSION_RESUME_CHECKPOINT} (imported, not typed, since `feed-flow.ts`
 * is that checkpoint name's SSOT).
 *
 * @invariant Renaming the `feed` CLI verb (`adapters/cli/index.ts`'s registry)
 *   or the `lore_feed` MCP tool (`adapters/mcp/tools.ts`) MUST update this
 *   constant — neither surface exports its own name, and a stale token here
 *   degrades silently to "no ticket → no block", which is H4's own named
 *   failure mode. AC-RCH-5's fixture array is the oracle that a rename broke it.
 */
const FEED_VERB_TOKEN = "feed";

/**
 * The MCP tool name for the same feed verb — DERIVED from
 * {@link FEED_VERB_TOKEN} rather than typed a second time, so the CLI-shaped
 * and MCP-shaped arming predicates cannot drift apart on the verb they mean.
 */
const FEED_MCP_TOOL_NAME = `lore_${FEED_VERB_TOKEN}`;

/**
 * Separator the harness puts between an MCP tool's server namespace and its
 * tool name — a `lore_feed` call arrives in a transcript as
 * `mcp__lore__lore_feed`, so the arming predicate compares the LAST separated
 * segment rather than the whole name (an unnamespaced `lore_feed` then has
 * exactly one segment and still matches).
 */
const MCP_TOOL_NAME_SEGMENT_SEPARATOR = "__";

/**
 * Punctuation stripped from both ends of a whitespace-delimited command word
 * before comparing it to an arming token — quoting and shell operators
 * (`lore feed 'session-resume';`) must not defeat the comparison, while
 * characters INSIDE a word are left alone so a path segment
 * (`docs/feed/session-resume.md`) stays one non-matching word rather than
 * decomposing into two matching tokens and arming a `cat`.
 */
const COMMAND_WORD_EDGE_PUNCTUATION = /^[`'"([{;&|]+|[`'")\]};&|,]+$/g;

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
 * Extracts the printable text of one Claude Code transcript content field —
 * either a `tool_result` block's `content` or an `assistant` message's
 * `message.content`. Measured 2026-07-30 against real transcripts under
 * `~/.claude/projects/-Users-apple-Projects-zz-lore/`: a Bash-tool result's
 * `content` is a plain string; other tool kinds (e.g. the Agent tool) carry
 * an array of `{type:"text", text}` blocks instead — the same shape
 * `stop-doc-sync.mjs` already handles for `assistant` message content. ONE
 * extractor serves both channels deliberately: they carry the identical
 * string-or-text-block union, and a second copy would be free to drift on
 * which shapes it accepts. Any other shape yields `""` — never throws.
 */
function extractContentText(content: unknown): string {
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

/**
 * Splits a Bash-tool `command` string into the lone tokens the arming
 * predicate compares against
 * (spec-resume-ticket-coverage-floor-blocking-channel-arming H4). Words are
 * whitespace-delimited, then stripped of {@link COMMAND_WORD_EDGE_PUNCTUATION}
 * at both ends; comparison is exact word equality, never substring
 * containment.
 *
 * reason: the two required tokens are matched INDEPENDENTLY and by equality —
 * never as a contiguous `"feed session-resume"` phrase — because a remembered
 * contiguous substring that stops matching degrades silently to "no ticket →
 * no block", which is both this repo's measured contiguous-substring
 * false-oracle vector and the exact silent-inertness failure mode SPEC-112 D6
 * shipped. Equality (rather than `\b`-anchored search) additionally keeps
 * `--feed-something` and `docs/feed/session-resume.md` from arming: they are
 * single words that equal neither token.
 *
 * @param command - The `command` input of a Bash-shaped `tool_use` block.
 * @returns The command's edge-trimmed words, deduplicated.
 * @example
 * toLoneCommandTokens("./dist/lore feed --json session-resume");
 * // => Set { "./dist/lore", "feed", "--json", "session-resume" }
 */
function toLoneCommandTokens(command: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const word of command.split(/\s+/)) {
    const trimmed = word.replace(COMMAND_WORD_EDGE_PUNCTUATION, "");
    if (trimmed.length > 0) tokens.add(trimmed);
  }
  return tokens;
}

/**
 * Answers whether one transcript `tool_use` block is a `lore feed
 * session-resume` invocation — the ONLY originating call that arms this floor
 * (spec-resume-ticket-coverage-floor-blocking-channel-arming H4).
 *
 * reason: SPEC-112 D6 CLAIMED the gate arms "only when a ticket was actually
 * rendered into this session's transcript", but its predicate keyed on any
 * tool_result whose text carried a cardinality line, with no notion of which
 * tool produced it. Probed 2026-08-01: a transcript that merely holds
 * `cat docs/archive/old-handoff.md` output armed a fabricated 9-item
 * accounting duty, so auditing/grepping/quoting an archived handoff imposed an
 * obligation nothing had actually handed the session. Pairing the result with
 * its producing call by `tool_use_id` is what makes "was rendered INTO this
 * session" checkable rather than asserted.
 *
 * Two recognized shapes, both keyed on shape rather than on a tool-name
 * allowlist: MCP-shaped is tested first (a name match plus a
 * {@link SESSION_RESUME_CHECKPOINT} `checkpoint` argument), then any block
 * carrying a string `command` input is treated as Bash-shaped. A `cat`/`grep`
 * call therefore reaches the token test and fails it, which is what AC-RCH-5's
 * negative fixtures pin.
 *
 * @param name - The `tool_use` block's `name` field.
 * @param input - The `tool_use` block's `input` field, untrusted `unknown`.
 * @returns `true` only for a session-resume feed call.
 */
function isSessionResumeFeedToolUse(name: string, input: unknown): boolean {
  const nameSegments = name.split(MCP_TOOL_NAME_SEGMENT_SEPARATOR);
  if (nameSegments[nameSegments.length - 1] === FEED_MCP_TOOL_NAME) {
    return isPlainRecord(input) && input.checkpoint === SESSION_RESUME_CHECKPOINT;
  }
  if (!isPlainRecord(input) || typeof input.command !== "string") return false;
  const tokens = toLoneCommandTokens(input.command);
  return tokens.has(FEED_VERB_TOKEN) && tokens.has(SESSION_RESUME_CHECKPOINT);
}

/** One recovered resume-ticket render: the full source text, the two counts read off its cardinality line, and the transcript entry index it landed on (which bounds the "after the ticket" disposition window — {@link TranscriptScan}). */
interface FoundTicket {
  readonly text: string;
  readonly keyDecisionsCount: number;
  readonly nextStepsCount: number;
  readonly entryIndex: number;
}

/** One assistant text message carrying at least one `RESUME_DISPOSITION_MARKER` line, tagged with its transcript entry index so it can be ordered against a {@link FoundTicket}. */
interface DispositionBearingMessage {
  readonly entryIndex: number;
  readonly text: string;
}

/** What one pass over a transcript recovers: the most recent ARMING ticket render (if any) and every marker-bearing assistant message, each positioned by entry index. */
interface TranscriptScan {
  readonly ticket: FoundTicket | undefined;
  readonly dispositionBearingMessages: readonly DispositionBearingMessage[];
}

/**
 * Single forward pass over a Claude Code transcript JSONL file, recovering
 * both halves of the coverage verdict's transcript-side input
 * (spec-resume-ticket-coverage-floor-blocking-channel-arming H4, H5):
 *
 *   1. the MOST RECENT tool-result block that BOTH carries a genuine
 *      `renderResumeCoverageCardinalityLine` line AND is paired by
 *      `tool_use_id` with a `lore feed session-resume` call
 *      ({@link isSessionResumeFeedToolUse}) — SPEC-112 D6's arming predicate,
 *      replaced wholesale;
 *   2. every `assistant` text message carrying the disposition marker, so
 *      accounting done in an EARLIER post-ticket turn still counts (H5) —
 *      MAIN-CHAIN entries only (`spec-resume-coverage-floor-the-satisfaction-boundaries-a`
 *      S2): an entry whose `isSidechain` field is exactly `true` is excluded
 *      from this collection, so no subagent output can discharge the
 *      obligation. Arming (point 1 above) is deliberately NOT filtered the
 *      same way — a sidechain-produced ticket still arms — which is the
 *      asymmetry S2 exists to create.
 *
 * Only marker-bearing MAIN-CHAIN assistant texts are retained — a whole
 * session's prose would be an unbounded copy of the transcript in memory, and
 * `parseDispositionedIds` can only ever recognize a line that starts with the
 * marker, so a text without one (or one filtered out by S2) contributes
 * nothing.
 *
 * One forward pass suffices because a JSONL transcript is append-only and a
 * tool's result is always appended after its call, so the producing
 * `tool_use` id is already known by the time its `tool_result` is read. An
 * UNPAIRED result therefore means unknown provenance and does not arm — the
 * same verdict as a non-feed producer.
 *
 * Read-channel discipline (SPEC-112 D8, preserved): everything read here is an
 * EARLIER turn's entry, so an unflushed newest transcript entry cannot change
 * this verdict. The CURRENT turn's dispositions come from
 * `last_assistant_message` instead — see `runCoverageCheck`.
 *
 * Entry shapes are MEASURED, not assumed: a tool result lands as
 * `type:"user"` with `message.content[]` holding `{type:"tool_result",
 * tool_use_id, content}`; a tool call and an assistant text both land as
 * `type:"assistant"` with `message.content[]` holding `{type:"tool_use", id,
 * name, input}` / `{type:"text", text}` blocks.
 *
 * @param transcriptText - The whole transcript file's contents.
 * @returns Both halves of the transcript-side input; `ticket: undefined` is
 *   SPEC-112 D6's "no ticket rendered into this session" case.
 */
function scanTranscript(transcriptText: string): TranscriptScan {
  const matcher = buildCardinalityLineMatcher();
  const armingToolUseIds = new Set<string>();
  const dispositionBearingMessages: DispositionBearingMessage[] = [];
  let ticket: FoundTicket | undefined;

  const rawLines = transcriptText.split("\n");
  for (let entryIndex = 0; entryIndex < rawLines.length; entryIndex++) {
    const rawLine = rawLines[entryIndex] as string;
    if (rawLine.trim().length === 0) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (!isPlainRecord(entry)) continue;
    const message = entry.message;
    if (!isPlainRecord(message)) continue;
    const content = message.content;

    if (entry.type === "assistant") {
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isPlainRecord(block) || block.type !== "tool_use") continue;
          if (typeof block.id !== "string" || typeof block.name !== "string") continue;
          // S2: arming stays chain-blind — a sidechain-produced ticket still
          // arms the floor, so this scan is deliberately NOT filtered on
          // `entry.isSidechain`.
          if (isSessionResumeFeedToolUse(block.name, block.input)) armingToolUseIds.add(block.id);
        }
      }
      // S2: satisfaction is main-chain only. `entry.isSidechain === true`
      // (strict equality, never truthiness, so a field absent on every
      // pre-existing transcript preserves today's behaviour) excludes this
      // entry from the disposition-bearing set — no subagent output can
      // discharge an obligation the main agent has not itself accounted for.
      const text = extractContentText(content);
      if (text.includes(RESUME_DISPOSITION_MARKER) && entry.isSidechain !== true) {
        dispositionBearingMessages.push({ entryIndex, text });
      }
      continue;
    }

    if (entry.type !== "user" || !Array.isArray(content)) continue;
    for (const block of content) {
      if (!isPlainRecord(block) || block.type !== "tool_result") continue;
      if (typeof block.tool_use_id !== "string" || !armingToolUseIds.has(block.tool_use_id)) continue;
      const text = extractContentText(block.content);
      const match = matcher.exec(text);
      if (match === null) continue;
      const keyDecisionsCount = Number(match[1]);
      const nextStepsCount = Number(match[2]);
      const total = Number(match[3]);
      if (keyDecisionsCount + nextStepsCount !== total) continue; // coincidental match in unrelated text
      ticket = { text, keyDecisionsCount, nextStepsCount, entryIndex };
    }
  }

  return { ticket, dispositionBearingMessages };
}

/**
 * Parses `${RESUME_DISPOSITION_MARKER} <item-id>: <disposition>` lines out of
 * ONE assistant text and returns the set of item ids carrying an ACCEPTED
 * disposition (`RESUME_DISPOSITION_DONE` or
 * `RESUME_DISPOSITION_DEFERRED_PREFIX<reason>` — SPEC-112 D5: the obligation is
 * to account, not to complete). A line carrying the marker but an
 * unrecognized disposition token is NOT counted as dispositioned — that id
 * then surfaces on stderr, which is the loud-failure behavior D7 requires
 * over a silent accept-anything parse.
 *
 * `spec-resume-coverage-floor-the-satisfaction-boundaries-a` S1: a deferral is
 * accepted only when the text FOLLOWING `RESUME_DISPOSITION_DEFERRED_PREFIX`,
 * trimmed, is non-empty. A bare `deferred:` and a whitespace-only
 * `deferred:   ` are both UNRECOGNIZED dispositions under this rule — routed
 * through the same loud path as any other unrecognized token (the id stays
 * out of `dispositioned`, surfaces on stderr, and appears in the block
 * reason), never a second warning channel. `assistantText` arrives here
 * already `.trim()`ed per-line by the loop above, so a whitespace-only reason
 * in practice reduces to the bare-prefix case before this function ever sees
 * it — the explicit `.trim()` below is kept anyway so this function's own
 * contract does not silently depend on that upstream trim.
 *
 * Called once per disposition source and unioned by the caller
 * (spec-resume-ticket-coverage-floor-blocking-channel-arming H5): every
 * post-ticket assistant message from the transcript, plus the current turn's
 * `last_assistant_message`. It is also the parser AC-RCH-2 feeds the block
 * reason's own template lines back through — {@link buildBlockReason} composes
 * lines this function accepts, so "ready to copy" is a round-trip property, not
 * a claim about wording.
 *
 * @param assistantText - One assistant message's plain text.
 * @returns The item ids that text accounts for.
 */
function parseDispositionedIds(assistantText: string): ReadonlySet<string> {
  const dispositioned = new Set<string>();
  for (const rawLine of assistantText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith(RESUME_DISPOSITION_MARKER)) continue;
    const rest = line.slice(RESUME_DISPOSITION_MARKER.length).trim();
    const colonIndex = rest.indexOf(":");
    if (colonIndex === -1) continue;
    const itemId = rest.slice(0, colonIndex).trim();
    const disposition = rest.slice(colonIndex + 1).trim();
    // S1: a deferral is accepted only with a non-empty reason after the
    // prefix — a bare `deferred:` (or one reducing to it after trimming
    // whitespace) leaves `deferralReason` empty and is therefore rejected,
    // same as any other unrecognized disposition token.
    const deferralReason = disposition.startsWith(RESUME_DISPOSITION_DEFERRED_PREFIX)
      ? disposition.slice(RESUME_DISPOSITION_DEFERRED_PREFIX.length).trim()
      : undefined;
    const isAccepted =
      disposition === RESUME_DISPOSITION_DONE || (deferralReason !== undefined && deferralReason.length > 0);
    if (itemId.length > 0 && isAccepted) dispositioned.add(itemId);
  }
  return dispositioned;
}

/**
 * Composes the block decision's `reason` text — the payload that has to make a
 * model actually emit the accounting
 * (spec-resume-ticket-coverage-floor-blocking-channel-arming H3).
 *
 * Two properties, both mechanically checkable, are what this function exists
 * for:
 *
 *   1. Every token of the grammar comes from a `@lore/core` export
 *      (`RESUME_COVERAGE_FLOOR`, `RESUME_DISPOSITION_MARKER`,
 *      `RESUME_DISPOSITION_DONE`, `RESUME_DISPOSITION_DEFERRED_PREFIX`) —
 *      never a hand-typed copy, which would be the remembered-wording drift
 *      vector SPEC-112 D7 forbids and which AC-RCH-2 pins with a zero-hit
 *      search over this source for a typed marker literal.
 *   2. Feeding the returned text back through {@link parseDispositionedIds}
 *      recognizes EXACTLY `missingIds` — the per-id lines are literally
 *      copyable, and the surrounding prose lines are written so none of them
 *      begins with the marker and parses as a spurious id. Round-tripping,
 *      rather than substring presence, is what makes "ready to copy" a
 *      measurable property.
 *
 * reason for carrying a template at all: the measured control arm. Over one
 * 7h46m session, `stop-doc-sync.mjs`'s reason (an instruction plus a
 * `Required output` template) earned 10/10 compliance while this verb's bare
 * stderr symptom line earned 0/130 — the model was never told what to write.
 * The `Required output` framing is copied from that arm deliberately.
 *
 * @param missingIds - The undispositioned item ids, in ticket order.
 * @returns The `reason` text for the stdout block decision.
 */
function buildBlockReason(missingIds: readonly string[]): string {
  const dispositionLines = missingIds
    .map((id) => `${RESUME_DISPOSITION_MARKER} ${id}: ${RESUME_DISPOSITION_DONE}`)
    .join("\n");
  return [
    `${missingIds.length} item(s) from this session's resume ticket are still unaccounted for. ${RESUME_COVERAGE_FLOOR}`,
    "",
    `Required output — emit exactly these lines in your final message, replacing \`${RESUME_DISPOSITION_DONE}\` with \`${RESUME_DISPOSITION_DEFERRED_PREFIX}<reason>\` on any item this session did not handle:`,
    "",
    dispositionLines,
    "",
    `Accounting is not completion: \`${RESUME_DISPOSITION_DONE}\` and \`${RESUME_DISPOSITION_DEFERRED_PREFIX}<reason>\` are equally accepted, and a deferral must carry its reason after the colon. Items already dispositioned earlier in this session are not listed above and need not be restated.`,
  ].join("\n");
}

/**
 * `lore handoff coverage-check` (spec-resume-ticket-coverage-a-shipped-upper-bound-left-the
 * D5, D8, D9, D10; spec-resume-ticket-coverage-floor-blocking-channel-arming
 * H1–H5) — the SOLE parser of both the rendered resume-ticket grammar and the
 * disposition-line grammar. Reads a `CoverageCheckStdinPayload` from its own
 * stdin, never touches the corpus/store, and carries zero cross-process state
 * (D8).
 *
 * The verdict is a business outcome carried ENTIRELY on stdout (H1/H2), never
 * on the exit status — this function has no non-zero path at all, and the five
 * input classes below are told apart by stdout alone (AC-RCH-8):
 *   - No ARMING ticket in the transcript — no `lore feed session-resume` call
 *     produced a cardinality-line-bearing result (incl. an unreadable/missing
 *     transcript, or malformed stdin) → empty stdout. SPEC-112 D6 as amended by
 *     H4: no ticket handed to this session, no ambient obligation.
 *   - Ticket found but its block carries no `RESUME_COVERAGE_FLOOR` → D10
 *     multi-actor render → empty stdout, checked BEFORE any disposition
 *     inspection.
 *   - Every recovered item id dispositioned, by any post-ticket turn or this
 *     one (H5) → empty stdout.
 *   - ≥1 recovered item id undispositioned → one `{"decision":"block"}` JSON
 *     object on stdout, plus each missing id on its own
 *     `UNDISPOSITIONED_ITEM_STDERR_PREFIX` stderr line for the operator
 *     watching a terminal (H2).
 *
 * `process.exitCode` is deliberately left untouched on every path; the only
 * non-zero exits reachable through this verb are the cardinality-template
 * shape check ({@link buildCardinalityLineMatcher} — an internal-invariant
 * fault report, not a verdict) and the calling hook's own `FAULT_EXIT_CODE`.
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

  const scan = transcriptText.length > 0 ? scanTranscript(transcriptText) : undefined;
  const ticket = scan?.ticket;
  if (scan === undefined || ticket === undefined) return; // D6 + H4: no session-resume feed produced a ticket — nothing on stdout

  if (!ticket.text.includes(RESUME_COVERAGE_FLOOR)) return; // D10: multi-actor render — nothing on stdout, dispositions never inspected

  const expectedIds: string[] = [];
  for (let i = 1; i <= ticket.keyDecisionsCount; i++) {
    expectedIds.push(formatResumeItemId(RESUME_ITEM_ID_PREFIX_KEY_DECISION, i));
  }
  for (let i = 1; i <= ticket.nextStepsCount; i++) {
    expectedIds.push(formatResumeItemId(RESUME_ITEM_ID_PREFIX_NEXT_STEP, i));
  }

  // H5: the union of every post-ticket accounting — earlier turns read from the
  // transcript, THIS turn read from `last_assistant_message`. The channel split
  // is D8's and survives: only the current turn's final message is exposed to
  // the flush race, and it is exactly the one not read from the transcript.
  const dispositioned = new Set<string>();
  for (const message of scan.dispositionBearingMessages) {
    if (message.entryIndex <= ticket.entryIndex) continue;
    for (const id of parseDispositionedIds(message.text)) dispositioned.add(id);
  }
  for (const id of parseDispositionedIds(lastAssistantMessage)) dispositioned.add(id);

  const missing = expectedIds.filter((id) => !dispositioned.has(id));

  if (missing.length === 0) return; // every item accounted for — nothing on stdout

  for (const id of missing) {
    process.stderr.write(`${UNDISPOSITIONED_ITEM_STDERR_PREFIX}${id}\n`);
  }
  // H1: the verdict travels the Stop contract's block channel. One JSON object,
  // no trailing newline (byte-identical framing to `stop-doc-sync.mjs`, whose
  // relay this hook already mirrors), and the exit status stays 0 — a non-zero
  // status is the channel measured to change nothing (H2).
  process.stdout.write(JSON.stringify({ decision: STOP_HOOK_BLOCK_DECISION, reason: buildBlockReason(missing) }));
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
