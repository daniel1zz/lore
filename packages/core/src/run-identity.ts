/**
 * Run identity (spec run-identity-slice-1, D2 / D6 / D9 / D10; BR-1027, BR-1040, BR-1044).
 *
 * Pure, browser-safe building blocks for "which run made this write":
 *   - types for runs, invocation identity and the claim decision;
 *   - the harness registry that derives a run id from harness ids (D2);
 *   - the single claim-conflict predicate used by task and phase claim paths (D6);
 *   - the command / MCP-input rewrite that carries the run (D10), with ONE
 *     implementation of the shell scan shared by insertion and stripping.
 *
 * @invariant No Node builtins, no I/O, no clock: every function is a pure
 *   function of its arguments (core barrel must stay browser-safe).
 * @invariant `--harness-run` is owned by the harness: any caller-written
 *   occurrence on a lore command is removed before the harness's own is inserted.
 *
 * Known limits of the shell scan (a missed command is stored unattested, never
 * mangled): `lore` behind a wrapper (`sudo lore`, `env lore`, a path), inside
 * backticks, or inside a quoted string passed to `bash -c` is not rewritten.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Run identifier derived from harness ids, e.g. `cc:<session>` / `cc:<session>:<agent>`. */
export type RunId = string & { readonly __brand: "RunId" };

/** Where the claimed (self-reported) name came from; never attestation. */
export type NameSource = "flag" | "env" | "mcp" | "session" | "worktree" | "os";

/** An invocation whose writer is named: the claimed name and where it came from. */
export interface ResolvedInvocationIdentity {
  /** The run the agent integration vouched for; null = unattested. */
  harnessRun: RunId | null;
  claimed: string;
  claimedSource: NameSource;
}

/**
 * An invocation that has no name for its writer: no `--by`, session or working-copy name, and the OS user lookup
 * failed. Reads proceed; a write that needs an actor fails loud with `unresolvedReason` (`OsUserLookupError`).
 * There is no substitute name.
 */
export interface UnresolvedInvocationIdentity {
  harnessRun: RunId | null;
  claimed: null;
  claimedSource: null;
  /** Why no name could be resolved (the OS user lookup's failure). */
  unresolvedReason: string;
}

/** Who this invocation is: a run vouched for plus either a claimed name or the reason there is none. */
export type InvocationIdentity = ResolvedInvocationIdentity | UnresolvedInvocationIdentity;

export interface WriteContext {
  readonly identity: InvocationIdentity;
}

export interface HarnessAdapter {
  readonly harness: string;
  derive(ids: { sessionId: string; agentId?: string }): RunId;
}

export interface CompositionRecord {
  readonly schemaVersion: 1;
  readonly fragments: ReadonlyArray<{ id: string; sha256: string }>;
}

export interface RunRecord {
  id: RunId;
  kind: "main" | "subagent";
  harness: string;
  sessionRef: string;
  agentRef: string | null;
  agentType: string | null;
  parentRunId: RunId | null;
  branch: string | null;
  composition: CompositionRecord;
  registeredAt: string;
}

const runIdSchema = z.string().min(1).transform((s) => s as RunId);

export const runRecordSchema = z.object({
  id: runIdSchema,
  kind: z.enum(["main", "subagent"]),
  harness: z.string().min(1),
  sessionRef: z.string().min(1),
  agentRef: z.string().min(1).nullable(),
  agentType: z.string().min(1).nullable(),
  parentRunId: runIdSchema.nullable(),
  branch: z.string().min(1).nullable(),
  composition: z.object({
    schemaVersion: z.literal(1),
    fragments: z.array(z.object({ id: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/) })),
  }),
  registeredAt: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Harness registry and run id derivation (D2)
// ---------------------------------------------------------------------------

/** Ids become part of a shell word and of a `:`-joined run id, so they must be plain. */
const HARNESS_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function assertHarnessId(label: string, value: string): void {
  if (!HARNESS_ID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label} ${JSON.stringify(value)}: expected non-empty [A-Za-z0-9._-]+`);
  }
}

const claudeCodeAdapter: HarnessAdapter = {
  harness: "claude-code",
  derive({ sessionId, agentId }) {
    assertHarnessId("session id", sessionId);
    if (agentId === undefined) return `cc:${sessionId}` as RunId;
    assertHarnessId("agent id", agentId);
    return `cc:${sessionId}:${agentId}` as RunId;
  },
};

/** Slice 1 ships one adapter; adding a harness is adding a key here. */
export const HARNESS_ADAPTERS: Readonly<Record<string, HarnessAdapter>> = {
  "claude-code": claudeCodeAdapter,
};

/** Derive a run id through the registry. Throws on an unknown harness (no guessing). */
export function deriveRunId(harness: string, ids: { sessionId: string; agentId?: string }): RunId {
  if (!Object.hasOwn(HARNESS_ADAPTERS, harness)) {
    throw new Error(
      `Unknown harness ${JSON.stringify(harness)}; registered: ${Object.keys(HARNESS_ADAPTERS).join(", ")}`,
    );
  }
  return HARNESS_ADAPTERS[harness]!.derive(ids);
}

// ---------------------------------------------------------------------------
// Claim conflict predicate (D6, BR-1040 / BR-1042)
// ---------------------------------------------------------------------------

export interface ClaimParty {
  by: string;
  harnessRun: RunId | null;
}

/** `legacy` = the stored claim has no `harness_run` key at all (written before migration 016). */
export interface ClaimHolder extends ClaimParty {
  legacy: boolean;
  stale: boolean;
}

/**
 * `grant` is what a caller answers when there is NO holder; this predicate is
 * only consulted with a holder, so it never returns `grant`.
 */
export type ClaimDecision =
  | { kind: "grant" }
  | { kind: "refresh" }
  | { kind: "takeover" }
  | { kind: "conflict"; holder: string; holderRun: RunId | null };

/**
 * Decide a claim against an existing holder.
 * Stale holder -> takeover. Legacy holder, or both sides unattested -> compare
 * by name (same name refreshes). Otherwise compare by run: same run refreshes;
 * different runs, or exactly one side unattested, conflict.
 */
export function hasClaimConflict(holder: ClaimHolder, claimant: ClaimParty): ClaimDecision {
  if (holder.stale) return { kind: "takeover" };
  const compareByName = holder.legacy || (holder.harnessRun === null && claimant.harnessRun === null);
  const same = compareByName ? holder.by === claimant.by : holder.harnessRun === claimant.harnessRun;
  if (same) return { kind: "refresh" };
  return { kind: "conflict", holder: holder.by, holderRun: holder.harnessRun };
}

// ---------------------------------------------------------------------------
// Command / MCP input rewrite (D10)
// ---------------------------------------------------------------------------

export const HARNESS_RUN_FLAG = "--harness-run";

const SAFE_RUN_PATTERN = /^[A-Za-z0-9:._-]+$/;
const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;
const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\r";
const isOperatorChar = (c: string): boolean => c === ";" || c === "&" || c === "|" || c === "(" || c === ")";

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** End index of the shell word starting at `from` (quotes and backslash escapes included). */
function wordEnd(cmd: string, from: number): number {
  let i = from;
  while (i < cmd.length) {
    const c = cmd.charAt(i);
    if (c === "\n" || isSpace(c) || isOperatorChar(c) || c === "<" || c === ">") break;
    if (c === "\\") {
      i += 2;
    } else if (c === "'") {
      const close = cmd.indexOf("'", i + 1);
      i = close === -1 ? cmd.length : close + 1;
    } else if (c === '"') {
      i++;
      while (i < cmd.length && cmd.charAt(i) !== '"') i += cmd.charAt(i) === "\\" ? 2 : 1;
      i++;
    } else {
      i++;
    }
  }
  return Math.min(i, cmd.length);
}

/** Heredoc delimiter text with its quoting removed. */
function unquote(raw: string): string {
  return raw.replace(/\\(.)|'([^']*)'|"([^"]*)"/g, (_m, esc, sq, dq) => esc ?? sq ?? dq);
}

/** Index just past the heredoc body that starts at `from` (first char of the first body line). */
function skipHeredocBody(cmd: string, from: number, delimiter: string, stripTabs: boolean): number {
  let i = from;
  while (i < cmd.length) {
    const nl = cmd.indexOf("\n", i);
    const lineEnd = nl === -1 ? cmd.length : nl;
    const line = stripTabs ? cmd.slice(i, lineEnd).replace(/^\t+/, "") : cmd.slice(i, lineEnd);
    i = nl === -1 ? cmd.length : nl + 1;
    if (line === delimiter) break;
  }
  return i;
}

/**
 * The one shell scan. Strips caller-written `--harness-run <v>` / `--harness-run=<v>`
 * from every lore command; when `run` is given, also inserts the flag right after
 * each command-position `lore` word. Never touches quoted text, comments or heredoc bodies.
 */
function transform(command: string, run: RunId | null): string {
  const edits: Edit[] = [];
  const pending: Array<{ delimiter: string; stripTabs: boolean }> = [];
  let atCommand = true;
  let inLore = false;
  let i = 0;

  while (i < command.length) {
    const c = command.charAt(i);
    if (c === "\n") {
      i++;
      for (const h of pending) i = skipHeredocBody(command, i, h.delimiter, h.stripTabs);
      pending.length = 0;
      atCommand = true;
      inLore = false;
      continue;
    }
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === "#") {
      const nl = command.indexOf("\n", i);
      i = nl === -1 ? command.length : nl;
      continue;
    }
    if (c === ")") {
      atCommand = false;
      inLore = false;
      i++;
      continue;
    }
    if (isOperatorChar(c)) {
      atCommand = true;
      inLore = false;
      i++;
      continue;
    }
    if (c === "<" || c === ">") {
      if (command.startsWith("<<", i) && !command.startsWith("<<<", i)) {
        i += 2;
        const stripTabs = command.charAt(i) === "-";
        if (stripTabs) i++;
        while (i < command.length && isSpace(command.charAt(i))) i++;
        const end = wordEnd(command, i);
        pending.push({ delimiter: unquote(command.slice(i, end)), stripTabs });
        i = end;
      } else {
        while (i < command.length && (command.charAt(i) === "<" || command.charAt(i) === ">")) i++;
        if (command.charAt(i) === "&") i++;
        while (i < command.length && isSpace(command.charAt(i))) i++;
        i = wordEnd(command, i); // redirection target is not a command word
      }
      continue;
    }

    const start = i;
    const end = wordEnd(command, i);
    i = end > start ? end : start + 1;
    const word = command.slice(start, end);
    if (/^[0-9]+$/.test(word) && (command.charAt(end) === "<" || command.charAt(end) === ">")) continue; // fd prefix of a redirection

    if (atCommand) {
      if (ASSIGNMENT_WORD.test(word)) continue;
      atCommand = false;
      inLore = word === "lore";
      if (inLore && run !== null) edits.push({ start: end, end, text: ` ${HARNESS_RUN_FLAG} ${run}` });
      continue;
    }
    if (!inLore) continue;
    if (word === HARNESS_RUN_FLAG) {
      let removeStart = start;
      while (removeStart > 0 && isSpace(command.charAt(removeStart - 1))) removeStart--;
      let removeEnd = end;
      let j = end;
      while (j < command.length && isSpace(command.charAt(j))) j++;
      if (j < command.length && command.charAt(j) !== "\n" && !isOperatorChar(command.charAt(j))) {
        removeEnd = wordEnd(command, j);
        i = removeEnd;
      }
      edits.push({ start: removeStart, end: removeEnd, text: "" });
    } else if (word.startsWith(`${HARNESS_RUN_FLAG}=`)) {
      let removeStart = start;
      while (removeStart > 0 && isSpace(command.charAt(removeStart - 1))) removeStart--;
      edits.push({ start: removeStart, end, text: "" });
    }
  }

  // Insertions are zero-width and share a start with a following removal: apply insert first.
  edits.sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start));
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    out += command.slice(cursor, e.start) + e.text;
    cursor = e.end;
  }
  return out + command.slice(cursor);
}

/** Remove every caller-written `--harness-run` flag from lore commands in `command`. */
export function stripHarnessRunFlag(command: string): string {
  return transform(command, null);
}

/**
 * Put `--harness-run <run>` right after every command-position `lore` word,
 * replacing any caller-written one. Idempotent; never edits quoted text or heredoc bodies.
 */
export function rewriteBashCommand(command: string, run: RunId): string {
  if (!SAFE_RUN_PATTERN.test(run)) {
    throw new Error(`Run id ${JSON.stringify(run)} is not shell-safe; expected [A-Za-z0-9:._-]+`);
  }
  return transform(command, run);
}

/** Return a copy of an MCP tool input carrying `harness_run: run`, overwriting any caller value. */
export function rewriteMcpInput<T extends object>(input: T, run: RunId): T & { harness_run: RunId } {
  return { ...input, harness_run: run };
}
