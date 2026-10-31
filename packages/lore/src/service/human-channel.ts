/**
 * Human channel — the rules that decide whether a `lore decide` invocation is a human at a terminal.
 *
 * Purpose: turn "is this process a human on an interactive terminal, outside any agent harness?" into one checked
 * proof (`HumanChannelProof`) that `DecisionService.resolvePending` demands before it writes a `human-tty` record.
 * Public surface: checkHumanChannelPreconditions, confirmHumanNonce, proveHumanChannel, findAgentHarnessAncestor,
 *   findAgentEnvMarker, snapshotAncestry, isIssuedHumanChannelProof, issueHarnessAskProof, HumanChannelPorts, HumanChannelProof,
 *   HumanChannelRefusal, HUMAN_CHANNEL_REFUSAL_EXIT.
 * Invariants:
 *   - Checks run in a fixed order and the FIRST failure names its rule: `tty-required` (stdin AND stdout are a TTY,
 *     and a controlling terminal opens), then `agent-ancestry` (no agent run identity in argv or environment, no
 *     harness process among the ancestors, process table readable), then `nonce-mismatch`.
 *   - The nonce is generated per call, written ONLY through `HumanTerminal.write` (the controlling terminal), held
 *     in memory, and never stored, logged, returned or placed in an error. A refusal carries the rule and a fixed
 *     message, never the typed answer.
 *   - An unreadable process table REFUSES (fail closed): "could not look" is not "no harness".
 *   - A proof can only be obtained from this module; `isIssuedHumanChannelProof` rejects a forged literal.
 * Side-effect class: IO through the injected ports only (no ambient process/env/fs access here).
 *
 * What this does NOT stop: a same-user agent that allocates its own pty, scrubs its environment, re-parents out of
 * the harness's process tree and reads the nonce off that pty can complete the dance — see adr D7: the channel
 * raises the bar from "type a flag" to "defeat process ancestry on purpose"; it is not a security boundary against
 * a determined same-user adversary.
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-3;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D7.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { basename } from "node:path";
import { HARNESS_RUN_ENV, isAgentRunId } from "@lore/core";

/** Exit code of every `lore decide` refusal (same bucket as rejected input). */
export const HUMAN_CHANNEL_REFUSAL_EXIT = 4;

/** Success/failure value with a caller-chosen error type (@lore/core's Result is bound to LoreError). */
export type HumanChannelOutcome<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

function err<E>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}

/** Closed set of rule names a refusal can carry; each appears verbatim in the refusal message. */
export type HumanChannelRule = "tty-required" | "agent-ancestry" | "nonce-mismatch";

export interface HumanChannelRefusal {
  readonly rule: HumanChannelRule;
  /** Human-readable, starts with the rule name, never contains the nonce or the typed answer. */
  readonly message: string;
}

/** One row of the OS process table. */
export interface ProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

/** One ancestor recorded on the decision record. */
export interface AncestrySnapshotEntry {
  readonly pid: number;
  readonly ppid: number;
  /** Command line, truncated. */
  readonly command: string;
}

/** The controlling terminal (/dev/tty in production). */
export interface HumanTerminal {
  /** @lore-site BR-1250 */
  write(text: string): void;
  /** Blocks until the human submits a line; returns it without the line terminator. */
  /** @lore-site BR-1250 */
  readLine(): string;
  close(): void;
}

/** Everything the channel needs from the outside world; production wiring is adapters/real-human-channel-port.ts. */
export interface HumanChannelPorts {
  /** @lore-site BR-1249 */
  stdinIsTty(): boolean;
  /** @lore-site BR-1249 */
  stdoutIsTty(): boolean;
  /** @lore-site BR-1249 */
  env(): Readonly<Record<string, string | undefined>>;
  /** argv after the program name, as the OS delivered it (informational; an agent run is read from the environment). */
  /** @lore-site BR-1249 */
  argv(): readonly string[];
  /** @lore-site BR-1249 */
  selfPid(): number;
  /** @lore-site BR-1249 */
  readProcessTable(): HumanChannelOutcome<readonly ProcessEntry[], string>;
  /** Fresh per call. */
  /** @lore-site BR-1250 */
  newNonce(): string;
  /** null when the process has no controlling terminal. */
  /** @lore-site BR-1249 */
  openTerminal(): HumanTerminal | null;
}

declare const humanChannelProofBrand: unique symbol;

/** Evidence that every channel check passed in THIS process; only `confirmHumanNonce` mints one. */
export interface HumanChannelProof {
  readonly [humanChannelProofBrand]: true;
  readonly channel: "human-tty";
  /** How the human answered: at a terminal (`terminal`) or in the agent session through the harness (`harness-ask`, BR-1374). */
  readonly via: "terminal" | "harness-ask" | "human-party";
  readonly ancestry: readonly AncestrySnapshotEntry[];
  readonly verified_at: string;
}

const issuedProofs = new WeakSet<object>();

/** True only for a proof object minted by `confirmHumanNonce` in this process. */
export function isIssuedHumanChannelProof(candidate: unknown): candidate is HumanChannelProof {
  return typeof candidate === "object" && candidate !== null && issuedProofs.has(candidate);
}

// ─── agent detection ─────────────────────────────────────────────────────────

const HARNESS_EXECUTABLES: ReadonlySet<string> = new Set(["claude", "claude-code", "codex", "cursor-agent", "gemini", "opencode"]);
const SCRIPT_HOSTS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "env", "node", "bun", "deno", "python", "python3"]);
const HARNESS_PACKAGE_MARKERS: readonly string[] = ["@anthropic-ai/claude-code", "/claude-code/cli"];
const MAX_ANCESTRY_DEPTH = 64;
const SNAPSHOT_COMMAND_MAX = 160;

/** Environment variable NAMES that mean "an agent harness started this process". */
const AGENT_ENV_EXACT: ReadonlySet<string> = new Set(["CLAUDECODE", "AI_AGENT", "CLAUDE_PID", "CLAUDE_SESSION_ID", "CLAUDE_EFFORT"]);
const AGENT_ENV_PREFIXES: readonly string[] = ["CLAUDE_CODE_", "CLAUDE_AGENT_", "CODEX_"];

/** First agent marker variable present with a non-empty value, or null. */
export function findAgentEnvMarker(env: Readonly<Record<string, string | undefined>>): string | null {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value === "") continue;
    if (AGENT_ENV_EXACT.has(name) || AGENT_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) return name;
  }
  return null;
}

function isAgentHarnessCommand(command: string): boolean {
  const tokens = command.trim().split(/\s+/);
  const head = basename(tokens[0] ?? "").replace(/^-/, "");
  if (HARNESS_EXECUTABLES.has(head)) return true;
  if (!SCRIPT_HOSTS.has(head)) return false;
  // reason: a harness started through an interpreter (`node …/claude-code/cli.js`, `sh /path/claude`) shows the
  // interpreter as argv0; only the first non-flag argument is inspected so `vim claude` style look-alikes stay clean.
  const script = tokens.slice(1).find((token) => !token.startsWith("-"));
  if (script === undefined) return false;
  if (HARNESS_PACKAGE_MARKERS.some((marker) => script.includes(marker))) return true;
  return HARNESS_EXECUTABLES.has(basename(script));
}

function ancestryFrom(table: readonly ProcessEntry[], startPid: number): ProcessEntry[] {
  const byPid = new Map(table.map((entry) => [entry.pid, entry] as const));
  const chain: ProcessEntry[] = [];
  const seen = new Set<number>();
  let current = byPid.get(startPid);
  while (current !== undefined && !seen.has(current.pid) && chain.length < MAX_ANCESTRY_DEPTH) {
    chain.push(current);
    seen.add(current.pid);
    current = byPid.get(current.ppid);
  }
  return chain;
}

/** The nearest ancestor (starting at `startPid` itself) whose command is an agent harness, or null. */
export function findAgentHarnessAncestor(table: readonly ProcessEntry[], startPid: number): ProcessEntry | null {
  return ancestryFrom(table, startPid).find((entry) => isAgentHarnessCommand(entry.command)) ?? null;
}

/** The ancestry chain of `startPid` as recorded on the decision record. */
export function snapshotAncestry(table: readonly ProcessEntry[], startPid: number): AncestrySnapshotEntry[] {
  return ancestryFrom(table, startPid).map((entry) => ({
    pid: entry.pid,
    ppid: entry.ppid,
    command: entry.command.length > SNAPSHOT_COMMAND_MAX ? `${entry.command.slice(0, SNAPSHOT_COMMAND_MAX)}…` : entry.command,
  }));
}

// ─── the checks ──────────────────────────────────────────────────────────────

/** What the preconditions established; consumed by `confirmHumanNonce`. */
export interface HumanChannelPreconditions {
  readonly terminal: HumanTerminal;
  readonly ancestry: readonly AncestrySnapshotEntry[];
}

function refusal(rule: HumanChannelRule, detail: string): HumanChannelOutcome<never, HumanChannelRefusal> {
  return err({ rule, message: `${rule}: ${detail}` });
}

/**
 * Checks 1 and 2: interactive terminal, then no agent identity or harness ancestor. Opens the controlling terminal
 * on success (the caller must close it via `confirmHumanNonce`, or `terminal.close()` when it stops early).
 *
 * @returns err with `rule` `tty-required` or `agent-ancestry`; nothing is written anywhere on refusal.
 */
export function checkHumanChannelPreconditions(ports: HumanChannelPorts): HumanChannelOutcome<HumanChannelPreconditions, HumanChannelRefusal> {
  if (!ports.stdinIsTty() || !ports.stdoutIsTty()) {
    return refusal("tty-required", "lore decide needs an interactive terminal: stdin and stdout must both be a TTY");
  }
  const marker = findAgentEnvMarker(ports.env());
  if (marker !== null) {
    return refusal("agent-ancestry", `the environment carries an agent identity (${marker}); a human answers from their own shell`);
  }
  // reason: only an AGENT run is an agent identity; a person's own `human:...` run is exactly who answers this channel (BR-1350)
  const carriedRun = ports.env()[HARNESS_RUN_ENV];
  if (carriedRun !== undefined && carriedRun !== "" && isAgentRunId(carriedRun)) {
    return refusal("agent-ancestry", `the environment carries an agent run identity (${HARNESS_RUN_ENV})`);
  }
  const table = ports.readProcessTable();
  if (!table.ok) {
    return refusal("agent-ancestry", `the process table could not be read (${table.error}); refusing rather than assuming no harness`);
  }
  const harness = findAgentHarnessAncestor(table.value, ports.selfPid());
  if (harness !== null) {
    return refusal("agent-ancestry", `an ancestor process is an agent harness (pid ${harness.pid}: ${harness.command.slice(0, 80)})`);
  }
  const terminal = ports.openTerminal();
  if (terminal === null) {
    return refusal("tty-required", "no controlling terminal (/dev/tty) could be opened");
  }
  return ok({ terminal, ancestry: snapshotAncestry(table.value, ports.selfPid()) });
}

/**
 * Check 3: show a fresh nonce on the controlling terminal and require it typed back. Always closes the terminal.
 *
 * @param summary - one line shown above the code ("accept decision 12: stash-drop stash@{0}")
 * @returns the proof, or err `nonce-mismatch` (the message never contains the nonce or the typed text).
 */
export function confirmHumanNonce(
  ports: HumanChannelPorts,
  preconditions: HumanChannelPreconditions,
  summary: string,
): HumanChannelOutcome<HumanChannelProof, HumanChannelRefusal> {
  const { terminal } = preconditions;
  try {
    const nonce = ports.newNonce();
    terminal.write(`\nlore decide — human channel\n  ${summary}\nConfirmation code: ${nonce}\nType the code to confirm: `);
    const typed = terminal.readLine().trim().toUpperCase();
    terminal.write("\n");
    const expected = Buffer.from(nonce);
    const actual = Buffer.from(typed);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return refusal("nonce-mismatch", "the typed code does not match; nothing was recorded");
    }
    const proof = {
      channel: "human-tty" as const,
      via: "terminal" as const,
      ancestry: preconditions.ancestry,
      verified_at: new Date().toISOString(),
    } as unknown as HumanChannelProof;
    issuedProofs.add(proof);
    return ok(proof);
  } finally {
    terminal.close();
  }
}

/**
 * The proof for an answer the harness reported (BR-1374): the human picked Accept or Reject in the interactive question
 * lore wrote, and the PostToolUse hook handed that answer to `lore decide --from-harness`.
 *
 * ⛔ Call ONLY after `service/harness-answer.ts` verified the nonce (issued, latest, unused, consumed now), the decision
 * id and subject version, and that the question hashes to the value bound to the nonce. No ancestry is recorded: the
 * caller is a hook under the harness by design.
 */
export function issueHarnessAskProof(verifiedAt: string): HumanChannelProof {
  const proof = { channel: "human-tty" as const, via: "harness-ask" as const, ancestry: [], verified_at: verifiedAt } as unknown as HumanChannelProof;
  issuedProofs.add(proof);
  return proof;
}

/**
 * The proof for a call made BY a human party itself (a human session, a dashboard login or an api key), where the invocation
 * identity already established that no agent run is the caller (BR-1055): the party's own direct command is its answer, so
 * there is no pending question to hand back.
 *
 * ⛔ Call ONLY when `inv.identity.claimedSource` is `human`, `dashboard` or `api-key`; never for a `run`. Today's only caller
 * is `GateAcceptanceService` (a human party's `--accept-gate`, spec-an-agent-s-gate-acceptance-waits-for-a-human-decision).
 */
export function issueHumanPartyProof(verifiedAt: string): HumanChannelProof {
  const proof = { channel: "human-tty" as const, via: "human-party" as const, ancestry: [], verified_at: verifiedAt } as unknown as HumanChannelProof;
  issuedProofs.add(proof);
  return proof;
}

/** Preconditions then nonce in one call — the injectable seam in-process callers and tests use. */
export function proveHumanChannel(ports: HumanChannelPorts, context: { readonly summary: string }): HumanChannelOutcome<HumanChannelProof, HumanChannelRefusal> {
  const pre = checkHumanChannelPreconditions(ports);
  if (!pre.ok) return pre;
  return confirmHumanNonce(ports, pre.value, context.summary);
}

const NONCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 symbols, no 0/O/1/I: a byte masked to 5 bits is uniform
const NONCE_LENGTH = 8;

/** A fresh 40-bit nonce from the OS CSPRNG. */
export function generateNonce(): string {
  const bytes = randomBytes(NONCE_LENGTH);
  let nonce = "";
  for (const byte of bytes) nonce += NONCE_ALPHABET[byte & 31];
  return nonce;
}
