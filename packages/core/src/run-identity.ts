/**
 * Run identity (spec run-identity-slice-1, D2 / D6 / D9 / D10; BR-1027, BR-1040, BR-1044).
 *
 * Pure, browser-safe building blocks for "which run made this write":
 *   - types for runs, invocation identity and the claim decision;
 *   - the harness registry that derives a run id from harness ids (D2);
 *   - the single claim-conflict predicate used by task and phase claim paths (D6);
 *   - the per-call carrier of the run: one export line in front of a Bash command (D14).
 *
 * @invariant No Node builtins, no I/O, no clock: every function is a pure
 *   function of its arguments (core barrel must stay browser-safe).
 * @invariant A Bash command is never parsed or altered: the carrier only prepends one line.
 */
import { z } from "zod";
import { sessionActorFromId } from "./session-actor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Run identifier derived from harness ids, e.g. `cc:<session>` / `cc:<session>:<agent>`. */
export type RunId = string & { readonly __brand: "RunId" };

/**
 * The four known parties a write can be made by (BR-1055): the agent run the integration vouched for (`run`), a
 * registered human session (`human`), an HTTP bearer key's name (`api-key`) or a dashboard login (`dashboard`).
 */
export type NameSource = "run" | "human" | "api-key" | "dashboard";

/** The run harnesses that are not agent integrations: every party that makes a write owns a run (spec end state 4). */
export type PartyHarness = "human" | "api-key" | "dashboard";

/** An invocation whose writer is a known party: the run it writes under, the name it is shown by, and which party kind it is. */
export interface ResolvedInvocationIdentity {
  /** The run this write is made under: an agent run, a human session run, or an api-key / dashboard run. */
  harnessRun: RunId;
  claimed: string;
  claimedSource: NameSource;
}

/**
 * An invocation with no known party: no attested agent run and no applicable human session. Reads proceed; a write
 * is refused with `unresolvedReason` (`UnknownPartyError`, exit 4). There is no substitute name.
 */
export interface UnresolvedInvocationIdentity {
  harnessRun: null;
  claimed: null;
  claimedSource: null;
  /** The refusal text: why no known party exists and how to become one. */
  unresolvedReason: string;
}

/** Who this invocation is: a known party's run and name, or the reason there is none. */
export type InvocationIdentity = ResolvedInvocationIdentity | UnresolvedInvocationIdentity;

export interface WriteContext {
  readonly identity: InvocationIdentity;
}

/** The environment variable an agent harness sets in every process it runs; `value` is what it sets it to. */
export interface HarnessMarker {
  readonly env: string;
  readonly value: string;
}

export interface HarnessAdapter {
  readonly harness: string;
  /** Prefix of every run id this adapter derives (`cc:` for Claude Code). */
  readonly runIdPrefix: string;
  /**
   * The harness's own environment marker. ⛔ Every agent integration lore ships MUST declare one: a process carrying
   * it is an agent and never writes under a person's human session (BR-1350).
   */
  readonly marker: HarnessMarker;
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
  /** Where another session can message this run (`uds:<absolute path>`), or null: none recorded (BR-1360). */
  messageAddress: string | null;
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
  messageAddress: z.string().min(1).nullable(),
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
  runIdPrefix: "cc:",
  marker: { env: "CLAUDECODE", value: "1" },
  derive({ sessionId, agentId }) {
    assertHarnessId("session id", sessionId);
    if (agentId === undefined) return `cc:${sessionId}` as RunId;
    assertHarnessId("agent id", agentId);
    return `cc:${sessionId}:${agentId}` as RunId;
  },
};

/** The shipped agent integrations; adding one is adding a key here, and it must declare its {@link HarnessMarker}. */
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

/**
 * Every environment variable a shipped agent harness uses as its marker, derived from {@link HARNESS_ADAPTERS} so it
 * cannot drift from {@link hasAgentHarnessMarker}. The test runner strips exactly these (with `LORE_HARNESS_RUN`) at
 * config load so a test run behaves identically inside an agent session and in CI (#531, regression of #503).
 */
export function listAgentHarnessMarkerEnvs(): readonly string[] {
  return Object.values(HARNESS_ADAPTERS).map((adapter) => adapter.marker.env);
}

/**
 * Whether `env` carries the marker of any shipped agent harness: the process runs inside an agent, so no human
 * session applies to it (BR-1350). Pure; `env` is the invocation's environment.
 */
export function hasAgentHarnessMarker(env: Readonly<Record<string, string | undefined>>): boolean {
  return Object.values(HARNESS_ADAPTERS).some((adapter) => env[adapter.marker.env] === adapter.marker.value);
}

/** Whether `run` was derived by a shipped agent integration (`cc:...`), as opposed to a party run. */
export function isAgentRunId(run: string): boolean {
  return Object.values(HARNESS_ADAPTERS).some((adapter) => run.startsWith(adapter.runIdPrefix));
}

/**
 * The name an attested agent run is shown by: `agent:session-<8>` of the run's session (the same name the session
 * tier always gave), so every run of one session reads alike and the RUN, not the name, tells them apart.
 *
 * @throws {Error} when `run` is not an agent run id or its session sanitizes to nothing.
 */
export function nameOfAgentRun(run: RunId): string {
  const adapter = Object.values(HARNESS_ADAPTERS).find((a) => run.startsWith(a.runIdPrefix));
  if (adapter === undefined) throw new Error(`Run ${JSON.stringify(run)} was not derived by a shipped agent integration`);
  const session = run.slice(adapter.runIdPrefix.length).split(":")[0] ?? "";
  return sessionActorFromId(session);
}

/** Run id of a human session: derived from the hash of its token, so the registry never holds the token (BR-1350). */
export function deriveHumanRunId(tokenHash: string): RunId {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new Error("A human run id derives from the 64-hex SHA-256 of the session token");
  return `human:${tokenHash.slice(0, 16)}` as RunId;
}

/** Run id of an HTTP bearer key (`api-key`) or a dashboard login (`dashboard`), reused by every write of the same name. */
export function derivePartyRunId(harness: "api-key" | "dashboard", name: string): RunId {
  if (name.trim() === "") throw new Error(`A ${harness} run needs a non-empty name`);
  return `${harness}:${encodeURIComponent(name)}` as RunId;
}

// ---------------------------------------------------------------------------
// Claim conflict predicate (D6, BR-1040 / BR-1043 / BR-1056)
// ---------------------------------------------------------------------------

/** The acting party of a claim or release: its display name and the RUN it acts as (null = no run was resolved). */
export interface ClaimParty {
  by: string;
  harnessRun: RunId | null;
}

/**
 * The stored lease as the predicate sees it. `harnessRun` is `null` only for a claim written before runs existed
 * (the schema upgrade expires those once, so a store at the current schema holds none); such a lease belongs to no
 * run and therefore conflicts with everyone.
 */
export interface ClaimHolder extends ClaimParty {
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
 * Decide a claim against an existing holder, by RUN ONLY (BR-1040). A stale holder is taken over. Otherwise the same
 * run refreshes; every other case conflicts, including two parties that carry the same display name, and a claimant
 * or holder with no run at all (a missing run is never "equal" to another missing run: name equality is not identity).
 */
export function hasClaimConflict(holder: ClaimHolder, claimant: ClaimParty): ClaimDecision {
  if (holder.stale) return { kind: "takeover" };
  const sameRun = holder.harnessRun !== null && claimant.harnessRun !== null && holder.harnessRun === claimant.harnessRun;
  if (sameRun) return { kind: "refresh" };
  return { kind: "conflict", holder: holder.by, holderRun: holder.harnessRun };
}

// ---------------------------------------------------------------------------
// Per-call run carrier (D14)
// ---------------------------------------------------------------------------

/** The environment variable that carries the per-call run into every lore process of one Bash call. */
export const HARNESS_RUN_ENV = "LORE_HARNESS_RUN";

const SAFE_RUN_PATTERN = /^[A-Za-z0-9:._-]+$/;

/**
 * Put one export line in front of a Bash command: the whole result is the line, a newline, then `command` byte for
 * byte. No shell scan: the command is never parsed, so no shell form can hide a lore call from the carrier.
 *
 * @throws {Error} when `run` is not shell-safe (`[A-Za-z0-9:._-]+`).
 */
export function prefixRunExport(command: string, run: RunId): string {
  if (!SAFE_RUN_PATTERN.test(run)) {
    throw new Error(`Run id ${JSON.stringify(run)} is not shell-safe; expected [A-Za-z0-9:._-]+`);
  }
  return `export ${HARNESS_RUN_ENV}='${run}'\n${command}`;
}
