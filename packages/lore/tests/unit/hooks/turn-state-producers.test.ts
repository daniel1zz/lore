// @spawns assets/hooks/post-edit-mark.mjs
// @spawns assets/hooks/session-start-marker.mjs
// @spawns assets/hooks/session-start-resume.mjs
// @spawns assets/hooks/stop-turn-review.mjs
// @spawns assets/hooks/user-prompt-turn-start.mjs
// @reads assets/hooks/**
/**
 * Task task-gh-1343388703-156 (lore issue #156), ported to the turn-end review by
 * spec-interception-moves-off-every-tool-call-one-turn-end-review AC-TE-5: every producer of the turn
 * state stop-turn-review.mjs reads must ship AND be registered, and producers and consumers must resolve
 * the same session dir from the payload. (The stop-doc-sync behaviour cases died with that hook; the
 * stop-turn-review behaviour itself is pinned by tests/integration/hooks/stop-turn-review*.test.ts.)
 *
 * Isolation: CLAUDE_STATE_BASE_OVERRIDE points at a mkdtemp dir; CLAUDE_SESSION_ID is set to a
 * DIFFERENT value than the payload session_id to prove the payload wins (AC4). Never touches
 * the repo's `.lore/`.
 *
 * Dimensions: HAPPY (producers registered), NEGATIVE (missing session_id), STATE (producer and consumer
 * share the session dir across separate processes), ERROR (edit marker without a started turn),
 * REGRESSION (session-start consumers resolve the payload session id).
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { HOOK_REGISTRATIONS, sessionStartMarkerFilename } from "@lore/core";
import { readSessionStartIso } from "../../../src/flows/feed-flow.js";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOKS = join(REPO_ROOT, "assets", "hooks");
const CONSUMER = "stop-turn-review.mjs";
const TURN_START = "user-prompt-turn-start.mjs";
const EDIT_MARK = "post-edit-mark.mjs";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function stateBase(): string {
  const d = mkdtempSync(join(tmpdir(), "turn-state-"));
  cleanup.push(d);
  return d;
}

function run(file: string, base: string, payload: Record<string, unknown> | string) {
  const env = { ...process.env, CLAUDE_STATE_BASE_OVERRIDE: base, CLAUDE_SESSION_ID: "env-decoy-session" };
  const r = spawnSync("node", [join(HOOKS, file)], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env,
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const SID = "sess-1";
const startTurn = (base: string, sid = SID) =>
  run(TURN_START, base, { session_id: sid, hook_event_name: "UserPromptSubmit", prompt: "hi" });
const edit = (base: string, tool = "Edit", input: Record<string, unknown> = { file_path: "/x/a.ts" }) =>
  run(EDIT_MARK, base, { session_id: SID, hook_event_name: "PostToolUse", tool_name: tool, tool_input: input });

describe("AC3: every producer of consumer-read state ships and is registered", () => {
  const consumerSrc = readFileSync(join(HOOKS, CONSUMER), "utf8");
  const libSrc = readFileSync(join(HOOKS, "lib", "turn-state.mjs"), "utf8");
  // State files the consumer reads: quoted *.flag / *.jsonl / *.id / *.json literals in consumer + its lib.
  const stateFiles = [
    ...new Set([...(consumerSrc + libSrc).matchAll(/['"]([\w-]+\.(?:flag|jsonl|id|json))['"]/g)].map((m) => m[1]!)),
  ];
  const expectedEvent: Record<string, string> = {
    "current-turn.id": "UserPromptSubmit",
    "turn-start-snapshot.json": "UserPromptSubmit",
    "edited-files.jsonl": "PostToolUse",
  };
  const hookFiles = readdirSync(HOOKS).filter((f) => f.endsWith(".mjs"));

  it("AC3 the consumer is registered on Stop and reads the state files this test knows how to pair", () => {
    expect(HOOK_REGISTRATIONS.some((r) => r.file === CONSUMER && r.event === "Stop")).toBe(true);
    expect(stateFiles.sort()).toEqual(Object.keys(expectedEvent).sort());
  });

  it.each(Object.keys(expectedEvent))("AC3 %s has a shipped, registered producer for the right event", (stateFile) => {
    const producers = hookFiles.filter((f) => {
      if (f === CONSUMER) return false;
      const src = readFileSync(join(HOOKS, f), "utf8");
      // A producer WRITES the file: writeFileSync/appendFileSync(join(<dir>, '<stateFile>')...).
      const esc = stateFile.replace(/[.]/g, "\\.");
      return new RegExp(`(?:writeFileSync|appendFileSync)\\(\\s*join\\([^)]*['"]${esc}['"]`).test(src);
    });
    expect(producers.length).toBeGreaterThan(0);
    for (const p of producers) {
      const regs = HOOK_REGISTRATIONS.filter((r) => r.file === p);
      expect(regs.some((r) => r.event === expectedEvent[stateFile])).toBe(true);
    }
  });

  it("AC3 the edit marker is matched on every editing tool", () => {
    const reg = HOOK_REGISTRATIONS.find((r) => r.file === EDIT_MARK && r.event === "PostToolUse");
    expect(reg).toBeDefined();
    const re = new RegExp(`^(?:${(reg as { matcher?: string }).matcher})$`);
    for (const t of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expect(re.test(t)).toBe(true);
    expect(re.test("Read")).toBe(false);
  });

  it("AC3 the stop-doc-sync consumer is gone: no shipped hook file or registration names it", () => {
    expect(existsSync(join(HOOKS, "stop-doc-sync.mjs"))).toBe(false);
    expect(HOOK_REGISTRATIONS.some((r) => r.file === "stop-doc-sync.mjs")).toBe(false);
  });
});

describe("AC4: producer and consumer resolve the same session dir from the payload", () => {
  it("AC4 payload session_id wins over CLAUDE_SESSION_ID env; dir is sessions/<payload id>", () => {
    const base = stateBase();
    startTurn(base, "payload-sid");
    expect(readdirSync(join(base, "sessions"))).toEqual(["payload-sid"]);
  });

  it("AC4 two separate producer processes agree on one session dir and one edit record (no ppid dependence)", () => {
    const base = stateBase();
    startTurn(base);
    edit(base);
    expect(readdirSync(join(base, "sessions"))).toEqual([SID]);
    const turnId = readFileSync(join(base, "sessions", SID, "current-turn.id"), "utf8").trim();
    const records = readFileSync(join(base, "sessions", SID, turnId, "edited-files.jsonl"), "utf8").trim().split("\n");
    expect(records).toHaveLength(1);
  });
});

describe("AC5: missing state is reported as not measured", () => {
  it("AC5 the consumer with no turn state at all -> exit 0, empty stdout, one stderr line saying not measured", () => {
    const r = run(CONSUMER, stateBase(), { session_id: SID, hook_event_name: "Stop", stop_hook_active: false });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("not measured");
  });

  it("AC5 edit marker without a started turn writes nothing and says so on stderr", () => {
    const base = stateBase();
    const r = edit(base);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("not measured");
    expect(readdirSync(base)).toEqual([]);
  });
});

// ── Other consumers of lib/turn-state.mjs (regression 2026-10-11: 40 tests turned red) ──────────

describe("turn-state consumers migrated to the payload session id", () => {
  const RESUME = "session-start-resume.mjs";

  function runResume(base: string, input: string) {
    const r = spawnSync("node", [join(HOOKS, RESUME)], {
      input,
      cwd: base,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, CLAUDE_STATE_BASE_OVERRIDE: base, CLAUDE_SESSION_ID: "env-decoy-session" },
    });
    return { code: r.status, stderr: r.stderr };
  }

  function seed(base: string) {
    const live = join(base, "sessions", SID);
    const stale = join(base, "sessions", "stale-session");
    mkdirSync(live, { recursive: true });
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(live, "autopilot.lock"), "x");
    const old = new Date(Date.now() - 20 * 24 * 3600 * 1000);
    utimesSync(live, old, old); // even an old-looking current session must survive the GC
    utimesSync(stale, old, old);
    return { live, stale };
  }

  it("session-start-resume: payload id -> clears THAT session's lock, GC keeps it, sweeps the stale one", () => {
    const base = stateBase();
    const { live, stale } = seed(base);
    const r = runResume(base, JSON.stringify({ session_id: SID, hook_event_name: "SessionStart", source: "startup" }));
    expect(r.code).toBe(0);
    expect(existsSync(join(live, "autopilot.lock"))).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  it("session-start-resume: no usable payload -> exit 0, nothing swept or cleared, one stderr line (never the env/ppid guess)", () => {
    const base = stateBase();
    const { live, stale } = seed(base);
    const r = runResume(base, "");
    expect(r.code).toBe(0);
    expect(existsSync(join(live, "autopilot.lock"))).toBe(true);
    expect(existsSync(stale)).toBe(true);
    expect(r.stderr).toContain("not measured");
  });
});

describe("session-start marker: writer == reader (both resolve the session via CLAUDE_CODE_SESSION_ID)", () => {
  // Docs (https://code.claude.com/docs/en/env-vars): CLAUDE_CODE_SESSION_ID is "Set automatically to the
  // current session ID in Bash and PowerShell tool subprocesses, hook command subprocesses ... For Bash,
  // PowerShell, and hooks this matches the `session_id` field in the hook JSON input" — so the hook-side
  // writer and the CLI-side reader (`lore feed`, a Bash child) agree without sharing turn-state.mjs.
  it("the marker the SessionStart hook writes is the one readSessionStartIso reads back", () => {
    const tmp = mkdtempSync(join(tmpdir(), "marker-pin-"));
    cleanup.push(tmp);
    const sid = `pin-${Math.random().toString(36).slice(2)}`;
    const env: Record<string, string | undefined> = { ...process.env, TMPDIR: tmp, CLAUDE_CODE_SESSION_ID: sid };
    delete env.CLAUDE_SESSION_ID;
    const r = spawnSync("node", [join(HOOKS, "session-start-marker.mjs")], {
      input: JSON.stringify({ session_id: sid, hook_event_name: "SessionStart" }),
      env,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(readdirSync(tmp)).toEqual([sessionStartMarkerFilename(sid)]);
    const prevTmp = process.env.TMPDIR; // readSessionStartIso resolves os.tmpdir() from the live process env
    process.env.TMPDIR = tmp;
    let read: ReturnType<typeof readSessionStartIso>;
    try {
      read = readSessionStartIso({ CLAUDE_CODE_SESSION_ID: sid }, tmp);
    } finally {
      if (prevTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prevTmp;
    }
    expect(read.kind).toBe("measured");
  });
});
