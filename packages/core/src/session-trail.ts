/**
 * session-trail.ts — schemas, run-id parsing and the pure reader of the session trail.
 *
 * Purpose: define the one shape of the session-local trail that hooks write under
 * `<stateBase>/sessions/<session_id>/` and that CLI consumers read (spec
 * spec-session-trail-a-session-local-record-of-what-each-run-4, Design > Trail layout).
 *
 * Public surface: zod schemas (`TrailChangeSchema`, `TurnChangesSchema`, `HelperRecordSchema`,
 * `SessionJsonSchema`, `RemovedMarkerSchema`, `JudgedFileSchema`, `TrailEditSchema`), their
 * inferred types, `parseRunId` / `sessionOfRun`, `assertTrailSessionId`, and
 * `buildSessionTrail(raw)` (pure: raw file contents in, `SessionTrail` out).
 *
 * Invariants:
 *   - Twin of `assets/hooks/lib/session-trail.mjs` (hooks cannot import `@lore/core`). Schemas,
 *     run-id parsing and `buildSessionTrail` output are pinned equal by
 *     `packages/lore/tests/integration/hooks/session-trail-runs.test.ts` (AC-ST-1). Changing
 *     either side without the other turns that test red.
 *   - All object schemas are `.strict()`: an unknown or renamed key is invalid, never ignored.
 *   - "Not measured" is data, never an empty list: a missing or unreadable per-turn file reads
 *     `{measured:false, reason}` (reasons are fixed strings so both readers agree).
 *   - A malformed session-level file (session.json, removed.json, helper record) throws
 *     `TrailFileInvalidError`; per-turn files degrade to `measured:false`.
 *   - The trail stores run ids only; parentage belongs to the run registry (spec D10).
 *
 * Side-effect class: pure (no Node builtin; browser-safe). File reading lives in
 * `session-trail-node.ts`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** A run id that is not `cc:<session>[:<agent>]` with ids in `[A-Za-z0-9._-]+`. */
export class TrailRunIdInvalidError extends Error {
  constructor(readonly run: unknown) {
    super(`not a claude-code run id (cc:<session>[:<agent>]): ${JSON.stringify(run)}`);
    this.name = "TrailRunIdInvalidError";
  }
}

/** A session id that is unusable as a directory name (empty, slashy, `.`/`..`, bad characters). */
export class TrailSessionIdInvalidError extends Error {
  constructor(readonly sessionId: unknown) {
    super(`unusable session id for a trail path: ${JSON.stringify(sessionId)}`);
    this.name = "TrailSessionIdInvalidError";
  }
}

/** A session-level trail file that exists but does not match its schema. */
export class TrailFileInvalidError extends Error {
  constructor(readonly file: string, readonly reason: string) {
    super(`session trail file ${file} is invalid: ${reason}`);
    this.name = "TrailFileInvalidError";
  }
}

// ---------------------------------------------------------------------------
// Schemas (SSOT; types derive from them)
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const measuredOf = <T extends z.ZodTypeAny>(value: T) =>
  z.discriminatedUnion("measured", [
    z.object({ measured: z.literal(true), value }).strict(),
    z.object({ measured: z.literal(false), reason: z.string().min(1) }).strict(),
  ]);

export const ChangeSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run"), run: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("vcs") }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]);
export type ChangeSource = z.infer<typeof ChangeSourceSchema>;

export const TrailChangeSchema = z
  .object({
    path: z.string().min(1),
    status: z.enum(["A", "M", "D"]),
    lines: z.number().int().nonnegative(),
    source: ChangeSourceSchema,
  })
  .strict();
export type TrailChange = z.infer<typeof TrailChangeSchema>;

export type Measured<T> = { measured: true; value: T } | { measured: false; reason: string };

/** `<turn>/changes.json`, written by the turn-end review. */
export const TurnChangesSchema = z
  .object({
    turn: z.string().min(1),
    at: z.string().min(1),
    shared_working_copy: z.boolean(),
    changes: measuredOf(z.array(TrailChangeSchema)),
  })
  .strict();
export type TurnChanges = z.infer<typeof TurnChangesSchema>;

/** `helpers/<agent_id>.json`, written only by SubagentStart / SubagentStop. */
export const HelperRecordSchema = z
  .object({
    run: z.string().min(1),
    started_at: z.string().min(1),
    ended_at: z.string().min(1).optional(),
    end_count: z.number().int().nonnegative(),
    working_copy: z.string().min(1).optional(),
    isolated: z.boolean().optional(),
    /** Helper base fixed at its FIRST measured end; kept across failed ends and reused by every later end. */
    base: z.string().min(1).optional(),
    changes: measuredOf(
      z.object({ base: z.string().min(1), files: z.array(TrailChangeSchema) }).strict(),
    ).optional(),
    /** The working copy's HEAD commit and branch (null = detached) read at the latest end, while the copy existed. */
    head: measuredOf(z.object({ commit: z.string().min(1), branch: z.string().min(1).nullable() }).strict()).optional(),
  })
  .strict();
export type HelperRecord = z.infer<typeof HelperRecordSchema>;

/** `helpers/<agent_id>.judged.json`: a legacy file no hook writes any more (the turn-end helper review was removed, BR-1349); still read so an older trail stays valid. */
export const JudgedFileSchema = z
  .object({
    judged_end_count: z.number().int().nonnegative(),
    /**
     * Instant (epoch ms) of the review-start snapshot that judged `judged_end_count`: edit records of the helper
     * with `ts <= judged_at_ms` were judged by that review. Absent on a file written before AU-T25.
     */
    judged_at_ms: z.number().int().nonnegative().optional(),
  })
  .strict();

/** `session.json`: written once at SessionStart. */
export const SessionJsonSchema = z.object({ started_at: z.string().min(1) }).strict();

/**
 * `removed.json`: left by retention. `started_at` is null when the removed trail predates
 * `session.json` (nothing to copy) — never a invented date.
 */
export const RemovedMarkerSchema = z
  .object({ removed_at: z.string().min(1), started_at: z.string().min(1).nullable() })
  .strict();
export type RemovedMarker = z.infer<typeof RemovedMarkerSchema>;

/** One line of `<turn>/edited-files.jsonl` (written by post-edit-mark.mjs, unchanged). */
export const TrailEditRecordSchema = z
  .object({
    file: z.string().min(1),
    ts: z.number(),
    agent_id: z.string().regex(ID_PATTERN).optional(),
    agent_type: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Run ids
// ---------------------------------------------------------------------------

export interface ParsedRunId {
  readonly session: string;
  /** null for the main run `cc:<session>`. */
  readonly agent: string | null;
}

/** Ids that cannot be a single path segment. */
function isUsableId(id: string): boolean {
  return ID_PATTERN.test(id) && id !== "." && id !== "..";
}

/**
 * Parse a claude-code run id.
 * @param run - candidate run id.
 * @returns the session id and the agent id (null for the main run).
 * @throws {TrailRunIdInvalidError} for anything but `cc:<session>[:<agent>]` over `[A-Za-z0-9._-]+`.
 * @example parseRunId("cc:S:A") // { session: "S", agent: "A" }
 */
export function parseRunId(run: unknown): ParsedRunId {
  if (typeof run !== "string") throw new TrailRunIdInvalidError(run);
  const parts = run.split(":");
  if (parts[0] !== "cc" || parts.length < 2 || parts.length > 3) throw new TrailRunIdInvalidError(run);
  const [, session, agent] = parts as [string, string, string | undefined];
  if (!isUsableId(session)) throw new TrailRunIdInvalidError(run);
  if (agent === undefined) return { session, agent: null };
  if (!ID_PATTERN.test(agent)) throw new TrailRunIdInvalidError(run);
  return { session, agent };
}

/** The session id a run belongs to (`cc:S` and `cc:S:A` both give `S`). */
export function sessionOfRun(run: unknown): string {
  return parseRunId(run).session;
}

/** @throws {TrailSessionIdInvalidError} when `sessionId` cannot be one directory name. */
export function assertTrailSessionId(sessionId: unknown): asserts sessionId is string {
  if (typeof sessionId !== "string" || !isUsableId(sessionId)) throw new TrailSessionIdInvalidError(sessionId);
}

// ---------------------------------------------------------------------------
// Pure reader
// ---------------------------------------------------------------------------

/** Raw contents of one turn directory; `null` = file absent. */
export interface RawTurn {
  readonly turn: string;
  /** mtime (ms) of `turn-start-snapshot.json`; null when that file is absent. */
  readonly opened_at_ms: number | null;
  readonly edited_files_jsonl: string | null;
  readonly changes_json: string | null;
}

export interface RawHelper {
  readonly agent_id: string;
  readonly record_json: string;
  readonly judged_json: string | null;
}

export interface RawSessionTrail {
  readonly session: string;
  readonly session_json: string | null;
  readonly removed_json: string | null;
  readonly turns: readonly RawTurn[];
  readonly helpers: readonly RawHelper[];
}

export interface TrailEdit {
  readonly file: string;
  readonly ts: number;
  /** `cc:<session>` for the main session, `cc:<session>:<agent_id>` for a helper. */
  readonly run: string;
  readonly agent_type: string | null;
}

export interface TrailTurn {
  readonly turn: string;
  readonly opened_at: string | null;
  readonly edits: Measured<TrailEdit[]>;
  /** null when changes.json is absent or unreadable. */
  readonly at: string | null;
  readonly shared_working_copy: boolean | null;
  readonly changes: Measured<TrailChange[]>;
}

export type TrailHelper = HelperRecord & { agent_id: string; judged_end_count: number; judged_at_ms?: number };

export interface SessionTrail {
  readonly session: string;
  readonly started_at: string | null;
  readonly removed: RemovedMarker | null;
  readonly turns: TrailTurn[];
  readonly helpers: TrailHelper[];
}

function parseJsonOrNull(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function parseSessionFile<T>(file: string, text: string, schema: z.ZodType<T>): T {
  const json = parseJsonOrNull(text);
  if (!json.ok) throw new TrailFileInvalidError(file, "not valid JSON");
  const parsed = schema.safeParse(json.value);
  if (!parsed.success) throw new TrailFileInvalidError(file, "does not match the trail schema");
  return parsed.data;
}

function readEdits(session: string, text: string | null): Measured<TrailEdit[]> {
  if (text === null) return { measured: true, value: [] };
  const edits: TrailEdit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    const json = parseJsonOrNull(line);
    const parsed = json.ok ? TrailEditRecordSchema.safeParse(json.value) : null;
    if (parsed === null || !parsed.success) {
      return { measured: false, reason: `edited-files.jsonl line ${i + 1} is not a valid edit record` };
    }
    const { file, ts, agent_id, agent_type } = parsed.data;
    edits.push({
      file,
      ts,
      run: agent_id === undefined ? `cc:${session}` : `cc:${session}:${agent_id}`,
      agent_type: agent_type ?? null,
    });
  }
  return { measured: true, value: edits };
}

function readTurn(session: string, raw: RawTurn): TrailTurn {
  const opened_at = raw.opened_at_ms === null ? null : new Date(raw.opened_at_ms).toISOString();
  const edits = readEdits(session, raw.edited_files_jsonl);
  const unmeasured = (reason: string): TrailTurn => ({
    turn: raw.turn, opened_at, edits, at: null, shared_working_copy: null,
    changes: { measured: false, reason },
  });
  if (raw.changes_json === null) return unmeasured("changes.json absent");
  const json = parseJsonOrNull(raw.changes_json);
  if (!json.ok) return unmeasured("changes.json is not valid JSON");
  const parsed = TurnChangesSchema.safeParse(json.value);
  if (!parsed.success) return unmeasured("changes.json does not match the trail schema");
  return {
    turn: raw.turn, opened_at, edits, at: parsed.data.at,
    shared_working_copy: parsed.data.shared_working_copy, changes: parsed.data.changes,
  };
}

function readHelper(session: string, raw: RawHelper): TrailHelper {
  const recordFile = `helpers/${raw.agent_id}.json`;
  const record = parseSessionFile(recordFile, raw.record_json, HelperRecordSchema);
  if (record.run !== `cc:${session}:${raw.agent_id}`) {
    throw new TrailFileInvalidError(recordFile, "run does not name this session and agent");
  }
  const judged = raw.judged_json === null
    ? { judged_end_count: 0 }
    : parseSessionFile(`helpers/${raw.agent_id}.judged.json`, raw.judged_json, JudgedFileSchema);
  return {
    ...record,
    agent_id: raw.agent_id,
    judged_end_count: judged.judged_end_count,
    ...(judged.judged_at_ms === undefined ? {} : { judged_at_ms: judged.judged_at_ms }),
  };
}

/** Chronological by snapshot mtime (unopened turns last), ties by turn id. */
function compareTurns(a: RawTurn, b: RawTurn): number {
  const am = a.opened_at_ms ?? Number.POSITIVE_INFINITY;
  const bm = b.opened_at_ms ?? Number.POSITIVE_INFINITY;
  if (am !== bm) return am < bm ? -1 : 1;
  return a.turn < b.turn ? -1 : a.turn > b.turn ? 1 : 0;
}

/**
 * Build the typed trail from raw file contents.
 * @param raw - contents read by `readSessionTrail` (node) or the hook-lib twin.
 * @returns the session trail; turns chronological, helpers by agent id.
 * @throws {TrailSessionIdInvalidError} bad session id.
 * @throws {TrailFileInvalidError} malformed session.json, removed.json or helper record.
 */
export function buildSessionTrail(raw: RawSessionTrail): SessionTrail {
  assertTrailSessionId(raw.session);
  const started_at = raw.session_json === null
    ? null
    : parseSessionFile("session.json", raw.session_json, SessionJsonSchema).started_at;
  const removed = raw.removed_json === null
    ? null
    : parseSessionFile("removed.json", raw.removed_json, RemovedMarkerSchema);
  return {
    session: raw.session,
    started_at,
    removed,
    turns: [...raw.turns].sort(compareTurns).map((t) => readTurn(raw.session, t)),
    helpers: [...raw.helpers]
      .sort((a, b) => (a.agent_id < b.agent_id ? -1 : a.agent_id > b.agent_id ? 1 : 0))
      .map((h) => readHelper(raw.session, h)),
  };
}
