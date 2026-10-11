/**
 * Task task-gh-1343388703-156 (lore issue #156): stop-doc-sync must not block a turn that made no
 * edits, and every producer of the turn state it reads must ship + be registered.
 *
 * Isolation: CLAUDE_STATE_BASE_OVERRIDE points at a mkdtemp dir; CLAUDE_SESSION_ID is set to a
 * DIFFERENT value than the payload session_id to prove the payload wins (AC4). Never touches
 * the repo's `.lore/`.
 *
 * Six dimensions: HAPPY (no-edit silent / edit blocks once), NEGATIVE (missing session_id),
 * BOUNDARY (edit in an earlier turn does not leak), ERROR (unreadable state), STATE (producer and
 * consumer share the session dir across separate processes), REGRESSION (2b compliant pass, file list).
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { HOOK_REGISTRATIONS } from "@lore/core";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOKS = join(REPO_ROOT, "assets", "hooks");
const CONSUMER = "stop-doc-sync.mjs";
const TURN_START = "user-prompt-turn-start.mjs";
const EDIT_MARK = "post-edit-mark.mjs";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function stateBase(): string {
  const d = mkdtempSync(join(tmpdir(), "stop-doc-sync-"));
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
const stop = (base: string, extra: Record<string, unknown> = {}) =>
  run(CONSUMER, base, { session_id: SID, hook_event_name: "Stop", stop_hook_active: false, ...extra });
const startTurn = (base: string, sid = SID) =>
  run(TURN_START, base, { session_id: sid, hook_event_name: "UserPromptSubmit", prompt: "hi" });
const edit = (base: string, tool = "Edit", input: Record<string, unknown> = { file_path: "/x/a.ts" }) =>
  run(EDIT_MARK, base, { session_id: SID, hook_event_name: "PostToolUse", tool_name: tool, tool_input: input });

describe("AC1: no-edit turn passes silently", () => {
  it("AC1 turn started, no edit -> exit 0, empty stdout, empty stderr", () => {
    const base = stateBase();
    expect(startTurn(base).code).toBe(0);
    const r = stop(base);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("AC1 an edit in an EARLIER turn does not leak into the next no-edit turn", () => {
    const base = stateBase();
    startTurn(base);
    edit(base);
    startTurn(base);
    const r = stop(base);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("AC2: edited turn blocks once, unchanged", () => {
  it.each(["Edit", "Write", "MultiEdit", "NotebookEdit"])("AC2 %s -> block with changed-file list", (tool) => {
    const base = stateBase();
    startTurn(base);
    edit(base, tool, tool === "NotebookEdit" ? { notebook_path: "/x/n.ipynb" } : { file_path: "/x/a.ts" });
    const r = stop(base);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("<stop-gate>");
    expect(out.reason).toContain(tool === "NotebookEdit" ? "/x/n.ipynb" : "/x/a.ts");
  });

  it("AC2 stop_hook_active=true -> silent (loop prevention)", () => {
    const base = stateBase();
    startTurn(base);
    edit(base);
    const r = stop(base, { stop_hook_active: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC2 2b: last_assistant_message already carries [DOC_SYNC] -> silent", () => {
    const base = stateBase();
    startTurn(base);
    edit(base);
    const r = stop(base, { last_assistant_message: "done\n**[DOC_SYNC]** updated: NONE | reason: x" });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("AC3: every producer of consumer-read state ships and is registered", () => {
  const consumerSrc = readFileSync(join(HOOKS, CONSUMER), "utf8");
  const libSrc = readFileSync(join(HOOKS, "lib", "turn-state.mjs"), "utf8");
  // State files the consumer reads: quoted *.flag / *.jsonl / *.id literals in consumer + its lib.
  const stateFiles = [
    ...new Set([...(consumerSrc + libSrc).matchAll(/['"]([\w-]+\.(?:flag|jsonl|id))['"]/g)].map((m) => m[1]!)),
  ];
  const expectedEvent: Record<string, string> = {
    "current-turn.id": "UserPromptSubmit",
    "edited.flag": "PostToolUse",
    "edited-files.jsonl": "PostToolUse",
  };
  const hookFiles = readdirSync(HOOKS).filter((f) => f.endsWith(".mjs"));

  it("AC3 the consumer reads the state files this test knows how to pair", () => {
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
});

describe("AC4: producer and consumer resolve the same session dir from the payload", () => {
  it("AC4 payload session_id wins over CLAUDE_SESSION_ID env; dir is sessions/<payload id>", () => {
    const base = stateBase();
    startTurn(base, "payload-sid");
    expect(readdirSync(join(base, "sessions"))).toEqual(["payload-sid"]);
  });

  it("AC4 two separate producer processes + consumer agree (no ppid dependence)", () => {
    const base = stateBase();
    startTurn(base);
    edit(base);
    expect(readdirSync(join(base, "sessions"))).toEqual([SID]);
    expect(JSON.parse(stop(base).stdout).decision).toBe("block");
  });
});

describe("AC5: missing or unreadable state is not-measured, not edited", () => {
  it("AC5 no turn state at all -> exit 0, empty stdout, one stderr line saying not measured", () => {
    const base = stateBase();
    const r = stop(base);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("not measured");
  });

  it("AC5 payload without session_id -> exit 0, not measured, no block", () => {
    const base = stateBase();
    const r = run(CONSUMER, base, { hook_event_name: "Stop" });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("not measured");
  });

  it("AC5 malformed stdin -> exit 0, not measured", () => {
    const r = run(CONSUMER, stateBase(), "{nope");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("not measured");
  });

  it("AC5 turn id points at a path that is a file, not a dir -> not measured, no block", () => {
    const base = stateBase();
    const sdir = join(base, "sessions", SID);
    mkdirSync(sdir, { recursive: true });
    writeFileSync(join(sdir, "current-turn.id"), "t1");
    writeFileSync(join(sdir, "t1"), "i am a file");
    const r = stop(base);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC5 edit marker without a started turn writes nothing and says so on stderr", () => {
    const base = stateBase();
    const r = edit(base);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("not measured");
    expect(readdirSync(base)).toEqual([]);
  });
});
