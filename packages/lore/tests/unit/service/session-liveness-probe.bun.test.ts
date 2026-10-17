/**
 * AC-OWN-5 (spec-multi-session-concurrency-queryable-ownership-checkout) —
 * `lore session list` derives each liveness verdict from the orchestrator
 * pid PLUS process start time, and NEVER from claim age. `isClaimStale`'s
 * TTL arithmetic may inform REPORTING (`ReadySession.stale`) but must never
 * decide the verdict — proved here by two directly contrasting cases: a
 * FRESH claim held by a DEAD process reports "dead", and a STALE claim held
 * by a LIVE process reports "alive". A pid that is currently alive but whose
 * OS-observed start time no longer matches the recorded one is the pid-reuse
 * defence and reports "dead" — pid alone is not sufficient identity.
 *
 * Three layers are exercised — the first two in-process, the third through
 * the SHIPPED command surface the AC's own prose names ("`lore session
 * list` derives ..."), closing the gap `assess` flagged 2026-08-13: an
 * attested pass resting only on layers 1/2 certifies the decision function,
 * never the command a caller actually runs:
 *   1. `deriveLivenessVerdict` (`service/session-liveness.ts`) — the pure
 *      three-valued decision, in isolation.
 *   2. `SessionService.recordOwnHeartbeat` / `deriveSessionLiveness` — the
 *      service-level join, with FAKE `probeProcessStartTimePort`/
 *      `writeHeartbeatPort`/`readHeartbeatPort` injected via the
 *      constructor (never a real `ps` subprocess or real tmpdir file).
 *   3. `lore session list [--json]` (`adapters/cli/commands/session.ts`) —
 *      spawns the COMPILED `dist/lore` binary (`Bun.spawnSync`, mirrors
 *      `cli-claim-anchors.bun.test.ts`'s established pattern) against a
 *      THROWAWAY corpus, asserting the REAL `liveness` field the command
 *      prints on `--json` output for two REAL claimed sessions — one that
 *      self-registers by running the command (reports `"alive"`, a genuine
 *      pid+start-time probe of the actual test-runner process, nothing
 *      faked), one that never does (reports `"unmeasured"`). Also asserts,
 *      on the human-readable render, that `"unmeasured"` carries an
 *      EXPLICIT reason clause naming the self-registration precondition
 *      (`commands/session.ts::formatSessionLine`) — surfaced at the CLI
 *      output itself, not left only in JSDoc, so a reader can tell "this
 *      peer has never run the command" apart from any other reading of the
 *      bare word "unmeasured".
 *
 * Six-dimension coverage (service-level `deriveSessionLiveness` suite):
 *   HAPPY:      a fresh claim's recorded pid is alive with a matching start
 *               time → "alive"
 *   NEGATIVE:   a FRESH claim's recorded pid is confirmed dead (probe
 *               returns null) → "dead" — proves freshness does not grant
 *               "alive"
 *   BOUNDARY:   a STALE claim (`stale: true`) whose recorded pid is alive
 *               with a matching start time → "alive" — proves claim age
 *               does NOT decide the verdict, the direct contrast with NEGATIVE
 *   ERROR:      a live pid whose OS-observed start time no longer matches
 *               the recorded one (pid reuse) → "dead"
 *   STATE:      a session with no `session_id` at all → "unmeasured",
 *               regardless of whatever heartbeat data happens to exist
 *   REGRESSION: a claim recorded on a DIFFERENT machine → "unmeasured" even
 *               when the heartbeat data would otherwise say "alive" —
 *               probing is same-machine only
 *
 * @spec_ref spec-multi-session-concurrency-queryable-ownership-checkout AC-OWN-5
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateDocInput, DocRecord, LoreError, ReadySession, Result } from "@lore/core";
import { err, sessionIdDiscriminator } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SessionService } from "../../../src/service/session-service.js";
import {
  deriveLivenessVerdict,
  type SessionHeartbeatRecord,
} from "../../../src/service/session-liveness.js";
import { assertFreshBinary } from "../../integration/helpers/assert-fresh-binary";

// tests/unit/service/ -> tests/unit/ -> tests/ -> packages/lore/ -> packages/ -> repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

// ─── Pure deriveLivenessVerdict ──────────────────────────────────────────────

describe("deriveLivenessVerdict (pure)", () => {
  it("HAPPY: a matching probed start time is alive", () => {
    expect(deriveLivenessVerdict({ pid: 1, started_at: "T0" }, "T0", true)).toBe("alive");
  });

  it("NEGATIVE: a null probe (no such process) is dead", () => {
    expect(deriveLivenessVerdict({ pid: 1, started_at: "T0" }, null, true)).toBe("dead");
  });

  it("ERROR: a mismatched probed start time (pid reuse) is dead, never alive", () => {
    expect(deriveLivenessVerdict({ pid: 1, started_at: "T0" }, "T1", true)).toBe("dead");
  });

  it("STATE: an absent recorded heartbeat is unmeasured, regardless of the probe value", () => {
    expect(deriveLivenessVerdict(undefined, "T0", true)).toBe("unmeasured");
  });

  it("REGRESSION: cross-machine is always unmeasured even with a matching probe", () => {
    expect(deriveLivenessVerdict({ pid: 1, started_at: "T0" }, "T0", false)).toBe("unmeasured");
  });
});

// ─── Service-level join (fake ports) ────────────────────────────────────────

function makeSession(overrides: Partial<ReadySession>): ReadySession {
  return {
    by: "agent:x",
    branches: [],
    task_slugs: [],
    newest_at: "2026-08-12T10:00:00.000Z",
    ...overrides,
  };
}

/** Never-called stub — none of these tests exercise handoff creation. */
async function stubCreateHandoffDoc(_input: CreateDocInput): Promise<Result<DocRecord, LoreError>> {
  return err({
    code: "VALIDATION_ERROR",
    field: "handoff",
    message: "stubCreateHandoffDoc is not used by this suite",
  });
}

interface FakePorts {
  probePid: Map<number, string | null>;
  heartbeats: Map<string, SessionHeartbeatRecord>;
}

function makeService(): { service: SessionService; ports: FakePorts } {
  const ports: FakePorts = { probePid: new Map(), heartbeats: new Map() };
  const store = new InMemoryStore();
  const service = new SessionService(
    store,
    { claimTtlMinutes: 120, handoffTtlMinutes: 10080, createHandoffDoc: stubCreateHandoffDoc },
    async (pid: number) => (ports.probePid.has(pid) ? (ports.probePid.get(pid) as string | null) : null),
    async (sessionId: string, record: SessionHeartbeatRecord) => {
      ports.heartbeats.set(sessionId, record);
    },
    async (sessionId: string) => ports.heartbeats.get(sessionId),
  );
  return { service, ports };
}

describe("SessionService.deriveSessionLiveness (AC-OWN-5)", () => {
  it("HAPPY: a fresh claim's recorded pid is alive with a matching start time", async () => {
    const { service, ports } = makeService();
    ports.heartbeats.set("sess-happy", { pid: 100, started_at: "T0", machine: "host-a" });
    ports.probePid.set(100, "T0");

    const session = makeSession({ session_id: "sess-happy", machine: "host-a" });
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("alive");
  });

  it("NEGATIVE: a FRESH claim held by a dead process reports dead (freshness grants nothing)", async () => {
    const { service, ports } = makeService();
    ports.heartbeats.set("sess-fresh-dead", { pid: 101, started_at: "T0", machine: "host-a" });
    ports.probePid.set(101, null); // process no longer exists

    const session = makeSession({
      session_id: "sess-fresh-dead",
      machine: "host-a",
      newest_at: new Date().toISOString(), // as fresh as possible
    });
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("dead");
  });

  it("BOUNDARY: a STALE claim held by a live process reports alive — claim age never decides the verdict", async () => {
    const { service, ports } = makeService();
    ports.heartbeats.set("sess-stale-alive", { pid: 102, started_at: "T0", machine: "host-a" });
    ports.probePid.set(102, "T0");

    const session = makeSession({
      session_id: "sess-stale-alive",
      machine: "host-a",
      stale: true, // ReadySession.stale — deliberately present to prove it's ignored
      newest_at: "2020-01-01T00:00:00.000Z", // ancient, would fail any TTL check
    });
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("alive");
    expect(record?.stale).toBe(true); // stale is carried through UNCHANGED, never merged into liveness
  });

  it("ERROR: a live pid whose start time no longer matches the recorded one (pid reuse) reports dead", async () => {
    const { service, ports } = makeService();
    ports.heartbeats.set("sess-reused", { pid: 103, started_at: "T0", machine: "host-a" });
    ports.probePid.set(103, "T1"); // a DIFFERENT process now occupies pid 103

    const session = makeSession({ session_id: "sess-reused", machine: "host-a" });
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("dead");
  });

  it("STATE: a session with no session_id at all is unmeasured, even when a coincidentally-matching heartbeat exists", async () => {
    const { service, ports } = makeService();
    // reason: seed a heartbeat under a key that could never be looked up
    // anyway (no session_id to key by) — proves the absence check short-circuits
    // BEFORE any heartbeat lookup, not merely that this particular lookup misses.
    ports.heartbeats.set("unused-key", { pid: 104, started_at: "T0", machine: "host-a" });
    ports.probePid.set(104, "T0");

    const session = makeSession({ machine: "host-a" }); // no session_id
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("unmeasured");
  });

  it("REGRESSION: a claim recorded on a different machine is unmeasured even though the heartbeat would say alive", async () => {
    const { service, ports } = makeService();
    ports.heartbeats.set("sess-cross-machine", { pid: 105, started_at: "T0", machine: "host-b" });
    ports.probePid.set(105, "T0"); // would report "alive" if probed

    const session = makeSession({ session_id: "sess-cross-machine", machine: "host-b" });
    // currentMachine is "host-a" — DIFFERS from the claim's recorded "host-b".
    const [record] = await service.deriveSessionLiveness([session], "host-a");

    expect(record?.liveness).toBe("unmeasured");
  });

  it("never drops a session — one record per input session, same order", async () => {
    const { service } = makeService();
    const sessions = [
      makeSession({ by: "a", session_id: "s1" }),
      makeSession({ by: "b" }),
      makeSession({ by: "c", session_id: "s3", machine: "elsewhere" }),
    ];

    const records = await service.deriveSessionLiveness(sessions, "host-a");

    expect(records).toHaveLength(3);
    expect(records.map((r) => r.by)).toEqual(["a", "b", "c"]);
  });
});

describe("SessionService.recordOwnHeartbeat (AC-OWN-5 write half)", () => {
  it("HAPPY: records a probed start time, later readable and joinable as alive", async () => {
    const { service, ports } = makeService();
    ports.probePid.set(200, "T5");

    await service.recordOwnHeartbeat("sess-self", 200, "host-a");
    expect(ports.heartbeats.get("sess-self")).toEqual({ pid: 200, started_at: "T5", machine: "host-a" });

    const session = makeSession({ session_id: "sess-self", machine: "host-a" });
    const [record] = await service.deriveSessionLiveness([session], "host-a");
    expect(record?.liveness).toBe("alive");
  });

  it("ERROR: a probe that cannot measure the caller's own pid records nothing (never a fabricated timestamp)", async () => {
    const { service, ports } = makeService();
    ports.probePid.set(201, null); // even our OWN pid probe can fail

    await service.recordOwnHeartbeat("sess-unmeasurable-self", 201, "host-a");

    expect(ports.heartbeats.has("sess-unmeasurable-self")).toBe(false);
  });
});

// ─── Command-level oracle: `lore session list` (AC-OWN-5's own named surface) ─
//
// Layers 1/2 above prove `deriveLivenessVerdict`/`deriveSessionLiveness` — the
// DECISION function. AC-OWN-5's own prose names a COMMAND ("`lore session
// list` derives each liveness verdict from ..."), and nothing above ever
// spawns it. This block does: it drives the COMPILED `dist/lore session list
// [--json]` command against a throwaway corpus with two REAL claimed
// sessions, and asserts the `liveness` field the command itself prints.

interface CliRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the COMPILED `dist/lore` binary — mirrors `cli-claim-anchors.bun.test.ts`'s established pattern. */
function runLoreCmd(args: string[], cwd: string, extraEnv: Record<string, string | undefined> = {}): CliRunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", ...extraEnv },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Like {@link runLoreCmd}, but throws with the captured stderr on a nonzero exit — fixture setup steps must never silently continue past a failure. */
function mustRunLoreCmd(args: string[], cwd: string, extraEnv?: Record<string, string | undefined>): CliRunResult {
  const result = runLoreCmd(args, cwd, extraEnv);
  if (result.exitCode !== 0) {
    throw new Error(`lore ${args.join(" ")} failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  return result;
}

function parseSlugFromCreateOutput(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from output: ${stdout}`);
  return slug;
}

interface SessionListJsonRecord {
  readonly session_id?: string;
  readonly liveness: string;
}

interface SessionListJsonEnvelope {
  readonly ok: boolean;
  readonly data: { readonly sessions: readonly SessionListJsonRecord[] };
}

/** `lore-session-heartbeat-<id>.json` under `os.tmpdir()` — same filename convention as `session-heartbeat-port.ts::heartbeatFilename` (id already sanitizes to plain `[a-z0-9]` here, so no further transform is needed). */
function heartbeatFilePath(sessionId: string): string {
  return join(tmpdir(), `lore-session-heartbeat-${sessionId}.json`);
}

describe("`lore session list` command-level oracle (AC-OWN-5's own named surface, not just the pure function)", () => {
  // Raw env values chosen so `sessionIdDiscriminator` (`@lore/core`, the SAME
  // sanitize+slice transform `commands/claim.ts`/`commands/session.ts` use)
  // yields a predictable, collision-unlikely 8-char id — computed via the
  // SSOT function itself, never hand-derived, so a future change to the
  // sanitizer cannot silently desync this test from production behavior.
  const MINE_RAW_SESSION_ID = "MINE0001-cmd-oracle-session";
  const PEER_RAW_SESSION_ID = "PEER0002-cmd-oracle-session";
  const MINE_SESSION_ID = sessionIdDiscriminator(MINE_RAW_SESSION_ID);
  const PEER_SESSION_ID = sessionIdDiscriminator(PEER_RAW_SESSION_ID);

  let tmpDir: string;

  beforeAll(() => {
    assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  });

  afterEach(() => {
    // reason: best-effort cleanup — never touches this repo's own `.lore/`
    // corpus (the throwaway `tmpDir` below is a SEPARATE mkdtemp corpus), but
    // the heartbeat sidecar is deliberately OUTSIDE any repo (`os.tmpdir()`,
    // per the ADR) and must not linger on the real machine after this suite.
    if (tmpDir !== undefined) rmSync(tmpDir, { recursive: true, force: true });
    for (const id of [MINE_SESSION_ID, PEER_SESSION_ID]) {
      rmSync(heartbeatFilePath(id), { force: true });
    }
  });

  it(
    "HAPPY/STATE: a self-registered session reports \"alive\" on --json, a peer that never ran the command reports \"unmeasured\" WITH an explicit reason clause on the human render",
    () => {
      tmpDir = mkdtempSync(join(tmpdir(), "lore-session-cmd-oracle-"));
      mustRunLoreCmd(["init"], tmpDir);

      const planSlug = parseSlugFromCreateOutput(
        mustRunLoreCmd(["create", "plan", "--title", "Session cmd oracle plan", "--content", "Plan body.", "--no-ai"], tmpDir).stdout,
      );
      const mineTaskSlug = parseSlugFromCreateOutput(
        mustRunLoreCmd(
          ["create", "task", "--title", "Mine task", "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "Task body."],
          tmpDir,
        ).stdout,
      );
      const peerTaskSlug = parseSlugFromCreateOutput(
        mustRunLoreCmd(
          ["create", "task", "--title", "Peer task", "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "Task body."],
          tmpDir,
        ).stdout,
      );

      // Two REAL claimed sessions, each with its own captured session_id.
      mustRunLoreCmd(["claim", mineTaskSlug], tmpDir, { CLAUDE_CODE_SESSION_ID: MINE_RAW_SESSION_ID });
      mustRunLoreCmd(["claim", peerTaskSlug], tmpDir, { CLAUDE_CODE_SESSION_ID: PEER_RAW_SESSION_ID });
      // ⛔ The peer session NEVER runs `lore session list|show` — no heartbeat
      // is ever recorded for it. This is the precondition itself: liveness is
      // measurable ONLY for a session that has self-registered by running the
      // command at least once.

      // Drives the SHIPPED command, not the pure function: only "mine" runs
      // `lore session list`, which self-registers ITS OWN heartbeat (real
      // pid = this test-runner process, real `ps` probe) before querying.
      const jsonResult = mustRunLoreCmd(["session", "list", "--json"], tmpDir, { CLAUDE_CODE_SESSION_ID: MINE_RAW_SESSION_ID });
      const parsed = JSON.parse(jsonResult.stdout) as SessionListJsonEnvelope;
      expect(parsed.ok).toBe(true);

      const mineRecord = parsed.data.sessions.find((s) => s.session_id === MINE_SESSION_ID);
      const peerRecord = parsed.data.sessions.find((s) => s.session_id === PEER_SESSION_ID);
      expect(mineRecord).toBeDefined();
      expect(peerRecord).toBeDefined();
      // AC-OWN-5's own field, read off the REAL command's REAL stdout:
      expect(mineRecord?.liveness).toBe("alive");
      expect(peerRecord?.liveness).toBe("unmeasured");

      // Surfaced at the CLI OUTPUT itself (never only JSDoc): the peer's
      // "unmeasured" line names WHY — it never ran `lore session list|show`
      // on this machine — so a reader can tell that apart from any other
      // reading of the bare word "unmeasured" (`commands/session.ts::
      // formatSessionLine`).
      const humanResult = mustRunLoreCmd(["session", "list"], tmpDir, { CLAUDE_CODE_SESSION_ID: MINE_RAW_SESSION_ID });
      const peerLine = humanResult.stdout.split("\n").find((line) => line.includes(PEER_SESSION_ID));
      expect(peerLine).toBeDefined();
      expect(peerLine).toContain("never run");
      expect(peerLine).toContain("lore session list|show");
    },
    20000,
  );
});
