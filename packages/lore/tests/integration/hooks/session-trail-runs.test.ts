/**
 * @spec_ref AC-ST-1
 *
 * Session trail writers and the two readers (spec-session-trail-a-session-local-record-of-what-each-run-4):
 *   - post-edit-mark.mjs (unchanged, BR-1088) records helper edits that the readers attribute to cc:S:A;
 *   - session-trail-start.mjs creates helpers/A.json on SubagentStart and leaves an existing trail
 *     untouched on a second SessionStart;
 *   - a payload without session_id writes nothing and prints nothing;
 *   - the hook-lib reader and the @lore/core reader agree on a fixture trail, on state-base
 *     resolution and on run-id parsing (renaming one schema field in either turns this red).
 *
 * Isolation (I1): mkdtemp state bases + CLAUDE_STATE_BASE_OVERRIDE; never ~/.claude or this repo's .lore/.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseRunId, readSessionTrail, sessionOfRun, stateBase } from "@lore/core/node";
import { currentTurnDir, makeGitRepo, makeTmpDir, readJsonl, runHook } from "./hook-harness";

const HOOKS_DIR = resolve(__dirname, "../../../../../assets/hooks");
const LIB = join(HOOKS_DIR, "lib", "session-trail.mjs");

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});
function scratch(prefix: string): string {
  const d = makeTmpDir(prefix);
  cleanup.push(d);
  return d;
}

/** Run an expression against the hook lib in a child node process; returns its JSON result. */
function hookLib(expression: string, env: Record<string, string | undefined> = {}): unknown {
  const script = `import * as lib from ${JSON.stringify("file://" + LIB)};
let out; try { out = { value: await (async () => (${expression}))() }; } catch (e) { out = { error: e.name }; }
process.stdout.write(JSON.stringify(out ?? null));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_STATE_BASE_OVERRIDE: undefined, ...env } as NodeJS.ProcessEnv,
  });
  if (r.status !== 0) throw new Error(`hook lib child failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function coreResult<T>(fn: () => T): { value: T } | { error: string } {
  try {
    return { value: fn() };
  } catch (e) {
    return { error: (e as Error).name };
  }
}

function listFiles(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(dir, join(rel, e.name)) : [join(rel, e.name)],
  );
}

function startTurn(base: string, sid: string, cwd: string) {
  runHook("user-prompt-turn-start.mjs", { session_id: sid, cwd, hook_event_name: "UserPromptSubmit", prompt: "x" }, base);
}

const sessionStart = (sid: string, source = "startup") => ({ session_id: sid, hook_event_name: "SessionStart", source });
const subagentStart = (sid: string, agent: string) => ({
  session_id: sid, hook_event_name: "SubagentStart", agent_id: agent, agent_type: "lore-implementer",
});

describe("AC-ST-1 writers", () => {
  it("AC-ST-1 an Edit payload with agent_id reads as helper run cc:S:A in the session trail and its turn", () => {
    const base = scratch("st-runs-"); const repo = makeGitRepo(); cleanup.push(repo);
    startTurn(base, "S", repo);
    runHook("post-edit-mark.mjs", { session_id: "S", cwd: repo, tool_input: { file_path: "/r/a.ts" }, agent_id: "A", agent_type: "lore-implementer" }, base);
    runHook("post-edit-mark.mjs", { session_id: "S", cwd: repo, tool_input: { file_path: "/r/m.ts" } }, base);

    // the record stays where BR-1088 puts it, unchanged ...
    const raw = readJsonl(join(currentTurnDir(base, "S"), "edited-files.jsonl"));
    expect(raw.map((e) => e.file)).toEqual(["/r/a.ts", "/r/m.ts"]);

    // ... and the trail reads it under the right runs, in that session and turn
    const trail = readSessionTrail("S", base)!;
    expect(trail.turns).toHaveLength(1);
    const edits = trail.turns[0]!.edits;
    expect(edits.measured).toBe(true);
    if (edits.measured) {
      expect(edits.value.map((e) => [e.file, e.run])).toEqual([["/r/a.ts", "cc:S:A"], ["/r/m.ts", "cc:S"]]);
    }
  });

  it("AC-ST-1 SubagentStart creates helpers/A.json in session S and never resets a later record", () => {
    const base = scratch("st-runs-");
    const r = runHook("session-trail-start.mjs", subagentStart("S", "A"), base);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
    const file = join(base, "sessions", "S", "helpers", "A.json");
    const first = JSON.parse(readFileSync(file, "utf8"));
    expect(first).toMatchObject({ run: "cc:S:A", end_count: 0 });
    expect(typeof first.started_at).toBe("string");
    expect(Object.keys(listFiles(join(base, "sessions", "S")))).toHaveLength(1); // no temp file left behind

    // SubagentStop (a later task) raised end_count; a repeated SubagentStart must not clobber it
    writeFileSync(file, JSON.stringify({ ...first, end_count: 2 }));
    runHook("session-trail-start.mjs", subagentStart("S", "A"), base);
    expect(JSON.parse(readFileSync(file, "utf8")).end_count).toBe(2);
  });

  it.each(["compact", "resume"])("AC-ST-1 a second SessionStart (%s) leaves existing trail files untouched", (source) => {
    const base = scratch("st-runs-");
    runHook("session-trail-start.mjs", sessionStart("S"), base);
    const sessionDir = join(base, "sessions", "S");
    const old = new Date(Date.now() - 3 * 86_400_000);
    writeFileSync(join(sessionDir, "current-turn.id"), "t1");
    mkdirSync(join(sessionDir, "t1"));
    writeFileSync(join(sessionDir, "t1", "edited-files.jsonl"), '{"file":"/x","ts":1}\n');
    utimesSync(join(sessionDir, "session.json"), old, old);
    const before = listFiles(sessionDir).sort().map((f) => [f, readFileSync(join(sessionDir, f), "utf8"), statSync(join(sessionDir, f)).mtimeMs]);

    const r = runHook("session-trail-start.mjs", sessionStart("S", source), base);
    expect([r.status, r.stdout, r.stderr]).toEqual([0, "", ""]);
    const after = listFiles(sessionDir).sort().map((f) => [f, readFileSync(join(sessionDir, f), "utf8"), statSync(join(sessionDir, f)).mtimeMs]);
    expect(after).toEqual(before);
  });

  it("AC-ST-1 a payload with no usable session_id writes nothing and prints nothing", () => {
    const base = scratch("st-runs-");
    const payloads: unknown[] = [
      { hook_event_name: "SessionStart", source: "startup" },
      { hook_event_name: "SubagentStart", agent_id: "A" },
      { session_id: "", hook_event_name: "SessionStart" },
      { session_id: "../evil", hook_event_name: "SessionStart" },
      { session_id: "S", hook_event_name: "SubagentStart", agent_id: "../x" },
    ];
    for (const p of payloads) {
      const r = runHook("session-trail-start.mjs", p as Record<string, unknown>, base);
      expect([r.status, r.stdout, r.stderr]).toEqual([0, "", ""]);
    }
    const malformed = spawnSync(process.execPath, [join(HOOKS_DIR, "session-trail-start.mjs")], {
      input: "{not json", encoding: "utf8", env: { ...process.env, CLAUDE_STATE_BASE_OVERRIDE: base },
    });
    expect([malformed.status, malformed.stdout, malformed.stderr]).toEqual([0, "", ""]);
    expect(readdirSync(base)).toEqual([]);
  });
});

/** A fixture trail exercising every record kind, including degraded per-turn files. */
function buildFixtureTrail(base: string): void {
  const dir = join(base, "sessions", "S");
  const write = (rel: string, text: string, mtimeMs?: number) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
    if (mtimeMs !== undefined) utimesSync(join(dir, rel), mtimeMs / 1000, mtimeMs / 1000);
  };
  const t0 = Date.UTC(2026, 9, 1);
  write("session.json", JSON.stringify({ started_at: "2026-10-01T00:00:00.000Z" }));
  write("removed.json", JSON.stringify({ removed_at: "2026-09-01T00:00:00.000Z", started_at: null }));
  // turn order is by snapshot mtime, deliberately opposite to id order
  write("t-b/turn-start-snapshot.json", '{"tree":"abc","head":null}', t0);
  write("t-a/turn-start-snapshot.json", '{"tree":null,"reason":"x"}', t0 + 1000);
  write("t-c/turn-start-snapshot.json", "{}", t0 + 2000);
  write("t-d/turn-start-snapshot.json", "{}", t0 + 3000);
  write("t-e/edited-files.jsonl", '{"file":"/only/edits","ts":5}\n'); // no snapshot: opened_at null, sorts last
  write("t-b/edited-files.jsonl",
    '{"file":"/r/a.ts","ts":1,"agent_id":"A","agent_type":"lore-implementer"}\n\n{"file":"/r/m.ts","ts":2}\n');
  write("t-b/changes.json", JSON.stringify({
    turn: "t-b", at: "2026-10-01T00:05:00.000Z", shared_working_copy: true,
    changes: { measured: true, value: [
      { path: "src/a.ts", status: "M", lines: 3, source: { kind: "run", run: "cc:S:A" } },
      { path: "src/b.ts", status: "A", lines: 9, source: { kind: "vcs" } },
      { path: "src/c.ts", status: "D", lines: 0, source: { kind: "unknown" } },
    ] },
  }));
  write("t-a/changes.json", JSON.stringify({
    turn: "t-a", at: "2026-10-01T00:06:00.000Z", shared_working_copy: false,
    changes: { measured: false, reason: "not a git work tree" },
  }));
  write("t-c/edited-files.jsonl", '{"file":"/ok","ts":1}\nnot json\n'); // bad line: edits unmeasured
  write("t-c/changes.json", "{broken");                                // not JSON: changes unmeasured
  write("t-d/changes.json", JSON.stringify({ turn: "t-d", at: "x", shared_working_copy: false, changes: { measured: true, value: [], extra: 1 } }));
  write("helpers/A.json", JSON.stringify({
    run: "cc:S:A", started_at: "2026-10-01T00:01:00.000Z", ended_at: "2026-10-01T00:04:00.000Z", end_count: 2,
    working_copy: "/wt/a", isolated: true,
    changes: { measured: true, value: { base: "deadbeef", files: [{ path: "src/a.ts", status: "M", lines: 3, source: { kind: "run", run: "cc:S:A" } }] } },
  }));
  write("helpers/A.judged.json", JSON.stringify({ judged_end_count: 1 }));
  write("helpers/B.json", JSON.stringify({ run: "cc:S:B", started_at: "2026-10-01T00:02:00.000Z", end_count: 0 }));
  write("helpers/B.judged.json.tmp", "ignored temp-looking file");
  write("current-turn.id", "t-b");
}

describe("AC-ST-1 reader parity: @lore/core and the hook lib", () => {
  it("AC-ST-1 both readers return the same trail for a fixture (schema parity)", () => {
    const base = scratch("st-parity-");
    buildFixtureTrail(base);
    const core = readSessionTrail("S", base)!;
    const hook = hookLib(`lib.readSessionTrail("S", ${JSON.stringify(base)})`) as { value: unknown };

    // sanity: the fixture really exercises the degraded branches, so equality is not vacuous
    expect(core.turns.map((t) => t.turn)).toEqual(["t-b", "t-a", "t-c", "t-d", "t-e"]);
    expect(core.turns[0]!.changes.measured).toBe(true);
    expect(core.turns[2]!.edits).toEqual({ measured: false, reason: "edited-files.jsonl line 2 is not a valid edit record" });
    expect(core.turns[2]!.changes).toEqual({ measured: false, reason: "changes.json is not valid JSON" });
    expect(core.turns[3]!.changes).toEqual({ measured: false, reason: "changes.json does not match the trail schema" });
    expect(core.turns[4]!.opened_at).toBeNull();
    expect(core.helpers.map((h) => [h.agent_id, h.judged_end_count])).toEqual([["A", 1], ["B", 0]]);
    expect(core.removed).toEqual({ removed_at: "2026-09-01T00:00:00.000Z", started_at: null });

    expect(hook.value).toEqual(JSON.parse(JSON.stringify(core)));
  });

  it("AC-ST-1 both readers read an absent session as null and an empty one as an empty trail", () => {
    const base = scratch("st-parity-");
    mkdirSync(join(base, "sessions", "E"), { recursive: true });
    expect(readSessionTrail("nope", base)).toBeNull();
    expect((hookLib(`lib.readSessionTrail("nope", ${JSON.stringify(base)})`) as { value: unknown }).value).toBeNull();
    const core = readSessionTrail("E", base)!;
    expect(core).toEqual({ session: "E", started_at: null, removed: null, turns: [], helpers: [] });
    expect((hookLib(`lib.readSessionTrail("E", ${JSON.stringify(base)})`) as { value: unknown }).value).toEqual(core);
  });

  it.each([
    ["helpers/A.json", { run: "cc:S:A", started_at: "t", end_count: 0, endcount: 1 }],      // unknown key
    ["helpers/A.json", { run: "cc:S:A", started_at: "t" }],                                   // missing end_count
    ["helpers/A.json", { run: "cc:S:OTHER", started_at: "t", end_count: 0 }],                 // run does not name agent
    ["session.json", { startedAt: "t" }],                                                     // renamed field
    ["removed.json", { removed_at: "t" }],                                                    // started_at missing
  ])("AC-ST-1 both readers refuse a malformed %s", (rel, content) => {
    const base = scratch("st-parity-");
    const file = join(base, "sessions", "S", rel);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify(content));
    expect(coreResult(() => readSessionTrail("S", base))).toEqual({ error: "TrailFileInvalidError" });
    expect(hookLib(`lib.readSessionTrail("S", ${JSON.stringify(base)})`)).toEqual({ error: "TrailFileInvalidError" });
  });

  it("AC-ST-1 state-base resolution agrees for the override and the default", () => {
    const override = "/tmp/some-override";
    expect(stateBase({ CLAUDE_STATE_BASE_OVERRIDE: override }, "/h")).toBe(override);
    expect((hookLib("lib.getStateBase()", { CLAUDE_STATE_BASE_OVERRIDE: override }) as { value: string }).value).toBe(override);

    const home = scratch("st-home-");
    const expected = join(home, ".claude", "session-state");
    expect(stateBase({}, home)).toBe(expected);
    expect(stateBase({ CLAUDE_STATE_BASE_OVERRIDE: "" }, home)).toBe(expected); // empty override = unset, as the hook
    expect((hookLib("lib.getStateBase()", { HOME: home }) as { value: string }).value).toBe(expected);
  });

  it("AC-ST-1 run-id parsing agrees on valid, malformed and path-unsafe ids", () => {
    const cases: unknown[] = [
      "cc:S", "cc:S:A", "cc:a.b_c-1:agent-2", "cc:", "cc::A", "cc:S:", "cc:S:A:B", "xx:S", "S", "cc:..", "cc:.",
      "cc:S/x", "cc:S:a b", "", "cc:S:..", 42, null,
    ];
    for (const run of cases) {
      const core = coreResult(() => parseRunId(run));
      const hook = hookLib(`lib.parseRunId(${JSON.stringify(run)})`);
      expect(hook, `parseRunId(${JSON.stringify(run)})`).toEqual(JSON.parse(JSON.stringify(core)));
      const coreSession = coreResult(() => sessionOfRun(run));
      expect(hookLib(`lib.sessionOfRun(${JSON.stringify(run)})`)).toEqual(JSON.parse(JSON.stringify(coreSession)));
    }
    expect(parseRunId("cc:S:A")).toEqual({ session: "S", agent: "A" });
    expect(parseRunId("cc:S")).toEqual({ session: "S", agent: null });
    expect(sessionOfRun("cc:S:A")).toBe("S");
  });
});
