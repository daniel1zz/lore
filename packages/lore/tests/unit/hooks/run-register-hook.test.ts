/**
 * @spec_ref AC-RID-3
 *
 * RED (TDD role) for `assets/hooks/run-register.mjs` — spec
 * spec-run-identity-slice-1-harness-attested-runs-attested, D7 (fail-open
 * registration, one additionalContext line on failure), BR-1030, BR-1027, BR-1029.
 * The hook does not exist yet, so every test here fails on the missing script.
 *
 * ## HOOK CONTRACT THIS FILE PINS (the implementer MUST match it)
 *
 *   stdin  SessionStart  : {"hook_event_name":"SessionStart","session_id":S,"cwd":D,...}
 *   stdin  SubagentStart : {"hook_event_name":"SubagentStart","session_id":S,"agent_id":A,
 *                           "agent_type":T,"cwd":D,...}
 *   spawn  SessionStart  : lore run register --harness claude-code --session S
 *   spawn  SubagentStart : the same, followed by --agent-id A --agent-type T
 *                          (flag set fixed by run-register.bun.test.ts, AC-RID-1)
 *   Success: exit 0, NO additionalContext on stdout (nothing to tell the session).
 *   Failure: exit 0 ALWAYS, and stdout is exactly ONE line: a hook JSON envelope
 *            {"hookSpecificOutput":{"hookEventName":<string>,"additionalContext":<one-line string>}}
 *            whose text names the failure with a case-specific substring.
 *
 * ## CASE-SPECIFIC FAILURE SUBSTRINGS (S4 open item: AC-RID-3 names them)
 *
 *   lore absent from PATH      -> "not found on PATH"
 *   lore exits with status N   -> "exit N"   (asserted for N=3 and N=1: the number is
 *                                             the real status, not a baked-in constant)
 *   malformed stdin (not JSON, or JSON without a string session_id)
 *                              -> "malformed"
 *
 * Every case also asserts: exit code 0, exactly one stdout line, that line parses as hook
 * JSON, additionalContext is a single line (no newline inside), and additionalContext
 * contains the substring above.
 *
 * Isolation: a stub `lore` (bash script) on a throwaway PATH records argv and stdin into a
 * mkdtemp dir. Never touches the repo's own `.lore/`.
 *
 * Six dimensions: HAPPY (main + subagent argv, two different sessions), NEGATIVE
 * (absent / exit 3 / exit 1 / malformed / missing session_id), BOUNDARY (empty stdin,
 * non-object JSON), ERROR (fail-open under every failure), STATE (stub not spawned when the
 * payload cannot yield a session), REGRESSION (success emits no context line).
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// packages/lore/tests/unit/hooks/<file> -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "run-register.mjs");

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(d);
  return d;
}

interface Stub {
  dir: string; // on PATH
  calls(): { argv: string[]; stdin: string }[];
}

/** Stub `lore`: records argv + stdin, optionally prints to stderr, exits with `exit`. */
function makeStub(opts: { exit?: number; stderr?: string } = {}): Stub {
  const dir = scratch("rr-stub-");
  const logDir = scratch("rr-log-");
  writeFileSync(
    join(dir, "lore"),
    `#!/bin/bash
f=$(mktemp "${logDir}/call.XXXXXX")
printf '%s\\n' "$@" > "$f"
cat > "$f.stdin"
${opts.stderr ? `printf '%s' ${JSON.stringify(opts.stderr)} >&2` : ":"}
exit ${opts.exit ?? 0}
`,
  );
  chmodSync(join(dir, "lore"), 0o755);
  return {
    dir,
    calls() {
      return readdirSync(logDir)
        .filter((n) => !n.endsWith(".stdin"))
        .sort()
        .map((n) => ({
          argv: readFileSync(join(logDir, n), "utf8").split("\n").slice(0, -1),
          stdin: readFileSync(join(logDir, `${n}.stdin`), "utf8"),
        }));
    },
  };
}

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runHook(stdin: string, pathDir: string): HookRun {
  // RED guard: a missing script must fail every test, including "was not spawned" ones.
  expect(existsSync(HOOK_PATH), `hook script missing: ${HOOK_PATH}`).toBe(true);
  const cwd = scratch("rr-cwd-");
  const r = spawnSync(process.execPath, [HOOK_PATH], {
    input: stdin,
    encoding: "utf8",
    cwd,
    timeout: 20000,
    // PATH carries the stub dir plus system dirs the stub itself needs (mktemp, cat).
    env: { PATH: `${pathDir}:/usr/bin:/bin`, HOME: cwd },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** PATH with no `lore` anywhere (an empty dir; /usr/bin:/bin are appended by runHook). */
function runHookWithoutLore(stdin: string): HookRun {
  return runHook(stdin, scratch("rr-empty-"));
}

const sessionStart = (sid: string) =>
  JSON.stringify({ hook_event_name: "SessionStart", session_id: sid, cwd: "/tmp/x", source: "startup" });
const subagentStart = (sid: string, aid: string, type: string) =>
  JSON.stringify({ hook_event_name: "SubagentStart", session_id: sid, agent_id: aid, agent_type: type, cwd: "/tmp/x" });

/** Asserts the single-line fail-open contract and returns the additionalContext text. */
function expectOneContextLine(run: HookRun): string {
  expect(run.status).toBe(0);
  const lines = run.stdout.split("\n").filter((l) => l !== "");
  expect(lines).toHaveLength(1);
  const parsed = JSON.parse(lines[0]);
  const text = parsed.hookSpecificOutput?.additionalContext;
  expect(typeof text).toBe("string");
  expect(text).not.toContain("\n");
  expect(text.length).toBeGreaterThan(0);
  return text;
}

describe("run-register.mjs — happy path spawns lore run register", () => {
  it("SessionStart spawns `lore run register --harness claude-code --session <id>` exactly once", () => {
    const stub = makeStub();
    const run = runHook(sessionStart("sess-aaa"), stub.dir);
    expect(run.status).toBe(0);
    expect(stub.calls().map((c) => c.argv)).toEqual([
      ["run", "register", "--harness", "claude-code", "--session", "sess-aaa"],
    ]);
  });

  it("a different session id yields a different --session value (not hardcoded)", () => {
    const stub = makeStub();
    runHook(sessionStart("sess-bbb-2"), stub.dir);
    expect(stub.calls()[0].argv.slice(-2)).toEqual(["--session", "sess-bbb-2"]);
  });

  it("SessionStart does not pass --agent-id or --agent-type (main run)", () => {
    const stub = makeStub();
    runHook(sessionStart("sess-ccc"), stub.dir);
    const argv = stub.calls()[0].argv;
    expect(argv).not.toContain("--agent-id");
    expect(argv).not.toContain("--agent-type");
  });

  it("SubagentStart adds --agent-id <id> --agent-type <type> after the main-run flags", () => {
    const stub = makeStub();
    const run = runHook(subagentStart("sess-ddd", "agent-77", "lore-implementer"), stub.dir);
    expect(run.status).toBe(0);
    expect(stub.calls().map((c) => c.argv)).toEqual([
      [
        "run", "register", "--harness", "claude-code", "--session", "sess-ddd",
        "--agent-id", "agent-77", "--agent-type", "lore-implementer",
      ],
    ]);
  });

  it("two subagents of one session produce two calls with their own agent ids", () => {
    const stub = makeStub();
    runHook(subagentStart("sess-eee", "a-1", "explore"), stub.dir);
    runHook(subagentStart("sess-eee", "a-2", "plan"), stub.dir);
    const ids = stub.calls().map((c) => c.argv[c.argv.indexOf("--agent-id") + 1]);
    expect(ids.sort()).toEqual(["a-1", "a-2"]);
  });

  it("a successful registration prints no additionalContext line", () => {
    const stub = makeStub();
    const run = runHook(sessionStart("sess-fff"), stub.dir);
    expect(run.stdout).not.toContain("additionalContext");
  });
});

describe("run-register.mjs — fail-open and loud (D7, BR-1030)", () => {
  it("lore absent from PATH: exit 0, one context line containing 'not found on PATH'", () => {
    const text = expectOneContextLine(runHookWithoutLore(sessionStart("sess-1")));
    expect(text).toContain("not found on PATH");
  });

  it("lore absent from PATH on SubagentStart: same fail-open line", () => {
    const text = expectOneContextLine(runHookWithoutLore(subagentStart("sess-1", "a-1", "explore")));
    expect(text).toContain("not found on PATH");
  });

  it("lore exits 3: exit 0, one context line containing 'exit 3'", () => {
    const stub = makeStub({ exit: 3, stderr: "run not found" });
    const text = expectOneContextLine(runHook(sessionStart("sess-2"), stub.dir));
    expect(text).toContain("exit 3");
  });

  it("lore exits 1: the line names 'exit 1' (status is read, not a constant)", () => {
    const stub = makeStub({ exit: 1, stderr: "boom" });
    const text = expectOneContextLine(runHook(sessionStart("sess-3"), stub.dir));
    expect(text).toContain("exit 1");
    expect(text).not.toContain("exit 3");
  });

  it("lore exits 3 on SubagentStart: fail-open too", () => {
    const stub = makeStub({ exit: 3 });
    const text = expectOneContextLine(runHook(subagentStart("sess-4", "a-9", "plan"), stub.dir));
    expect(text).toContain("exit 3");
  });

  it("the failure line does not claim 'not found on PATH' when lore ran and failed", () => {
    const stub = makeStub({ exit: 3 });
    const text = expectOneContextLine(runHook(sessionStart("sess-5"), stub.dir));
    expect(text).not.toContain("not found on PATH");
  });

  it("malformed stdin (not JSON): exit 0, one context line containing 'malformed'", () => {
    const stub = makeStub();
    const text = expectOneContextLine(runHook("{not json", stub.dir));
    expect(text).toContain("malformed");
  });

  it("malformed stdin does not spawn lore (no session to register)", () => {
    const stub = makeStub();
    runHook("{not json", stub.dir);
    expect(stub.calls()).toHaveLength(0);
  });

  it("empty stdin: exit 0, one context line containing 'malformed'", () => {
    const stub = makeStub();
    const text = expectOneContextLine(runHook("", stub.dir));
    expect(text).toContain("malformed");
  });

  it("valid JSON without a string session_id: 'malformed', lore not spawned", () => {
    const stub = makeStub();
    const text = expectOneContextLine(
      runHook(JSON.stringify({ hook_event_name: "SessionStart", cwd: "/tmp/x" }), stub.dir),
    );
    expect(text).toContain("malformed");
    expect(stub.calls()).toHaveLength(0);
  });

  it("valid JSON that is not an object (an array): 'malformed'", () => {
    const stub = makeStub();
    const text = expectOneContextLine(runHook("[1,2,3]", stub.dir));
    expect(text).toContain("malformed");
  });

  it("malformed stdin with lore absent: still exactly one line, names the payload problem", () => {
    const text = expectOneContextLine(runHookWithoutLore("{not json"));
    expect(text).toContain("malformed");
  });
});
