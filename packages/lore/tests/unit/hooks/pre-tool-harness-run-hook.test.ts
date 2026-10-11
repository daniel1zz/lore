/**
 * @spec_ref AC-RID-3
 *
 * RED (TDD role) for `assets/hooks/pre-tool-harness-run.mjs` — spec
 * spec-run-identity-slice-1-harness-attested-runs-attested, D10 (the hook owns NO grammar:
 * it only checks whether a Bash command contains the word `lore`, or the tool is
 * `mcp__lore__*`, then pipes the payload to `lore run attest-input` and relays its hook JSON
 * verbatim), D7 (fail-open), BR-1030. The hook does not exist yet, so every test here fails
 * on the missing script.
 *
 * ## HOOK CONTRACT THIS FILE PINS (the implementer MUST match it)
 *
 *   stdin : PreToolUse payload {"hook_event_name":"PreToolUse","tool_name":...,"tool_input":{...},...}
 *   Trigger (decided from the payload alone, no grammar):
 *     - tool_name "Bash" AND tool_input.command contains the WORD `lore` (word boundary:
 *       `explore`, `folklore` do not count; only tool_input.command is inspected, so a
 *       `description` mentioning lore does not count)
 *     - tool_name starts with `mcp__lore__`
 *   Not triggered: exit 0, EMPTY stdout, `lore` never spawned.
 *   Triggered: spawn `lore run attest-input` with the raw stdin payload piped in
 *     (byte-identical), relay the child's stdout byte-for-byte, exit 0.
 *   Child fails (non-zero exit, or lore absent from PATH) -> exit 0 and the output carries NO
 *     `updatedInput` (the call passes through un-rewritten; never relay a failed child's stdout).
 *   Malformed stdin -> exit 0, nothing spawned, no updatedInput.
 *
 * The stub `lore` is a bash script that records argv + stdin and prints a fixed stdout file
 * (so the relay can be checked byte-for-byte, including a missing trailing newline).
 * Isolation: mkdtemp dirs only; never touches the repo's own `.lore/`.
 *
 * Six dimensions: HAPPY (lore Bash + mcp relay, different stub outputs), NEGATIVE
 * (non-lore Bash, other mcp server, non-Bash tool, description-only mention), BOUNDARY (word
 * boundary `explore`, lore inside a pipeline), ERROR (stub exit 1 / 3 with updatedInput on
 * stdout, lore absent, malformed stdin), STATE (stub invocation count), REGRESSION (no
 * re-serialisation of the relayed JSON).
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "pre-tool-harness-run.mjs");

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
  dir: string;
  calls(): { argv: string[]; stdin: string }[];
  first(): { argv: string[]; stdin: string };
}

/** Stub `lore`: records argv + stdin, prints `stdout` byte-exact, exits with `exit`. */
function makeStub(opts: { stdout?: string; exit?: number } = {}): Stub {
  const dir = scratch("pt-stub-");
  const logDir = scratch("pt-log-");
  writeFileSync(join(dir, "stdout.bin"), opts.stdout ?? "");
  writeFileSync(
    join(dir, "lore"),
    `#!/bin/bash
f=$(mktemp "${logDir}/call.XXXXXX")
printf '%s\\n' "$@" > "$f"
cat > "$f.stdin"
cat "${join(dir, "stdout.bin")}"
exit ${opts.exit ?? 0}
`,
  );
  chmodSync(join(dir, "lore"), 0o755);
  const calls = (): { argv: string[]; stdin: string }[] =>
    readdirSync(logDir)
      .filter((n) => !n.endsWith(".stdin"))
      .sort()
      .map((n) => ({
        argv: readFileSync(join(logDir, n), "utf8").split("\n").slice(0, -1),
        stdin: readFileSync(join(logDir, `${n}.stdin`), "utf8"),
      }));
  return {
    dir,
    calls,
    first() {
      const all = calls();
      if (all[0] === undefined) throw new Error("expected lore stub to have been invoked, but it was not");
      return all[0];
    },
  };
}

interface HookRun {
  status: number | null;
  stdout: string;
}

function runHook(stdin: string, pathDir: string): HookRun {
  // RED guard: a missing script must fail every test, including "was not spawned" ones.
  expect(existsSync(HOOK_PATH), `hook script missing: ${HOOK_PATH}`).toBe(true);
  const cwd = scratch("pt-cwd-");
  const r = spawnSync(process.execPath, [HOOK_PATH], {
    input: stdin,
    encoding: "utf8",
    cwd,
    timeout: 20000,
    env: { PATH: `${pathDir}:/usr/bin:/bin`, HOME: cwd },
  });
  return { status: r.status, stdout: r.stdout };
}

const runHookWithoutLore = (stdin: string) => runHook(stdin, scratch("pt-empty-"));

const bashPayload = (command: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: "sess-1",
    tool_name: "Bash",
    tool_input: { command, ...extra },
  });

const REWRITTEN_A = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    updatedInput: { command: "lore claim t --harness-run cc:sess-1" },
  },
});
const REWRITTEN_B = `{"hookSpecificOutput": {"hookEventName":"PreToolUse",  "updatedInput":{"command":"lore evidence x --harness-run cc:sess-2:ag"}}}`;

describe("pre-tool-harness-run.mjs — not a lore call: costs nothing", () => {
  it("Bash command without the word lore: exit 0, empty stdout", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    const run = runHook(bashPayload("ls -la /tmp"), stub.dir);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
  });

  it("Bash command without the word lore: lore is NOT spawned", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    runHook(bashPayload("git status && echo done"), stub.dir);
    expect(stub.calls()).toHaveLength(0);
  });

  it("`explore` contains the letters but not the word lore: not spawned", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    const run = runHook(bashPayload("ls explore folklore"), stub.dir);
    expect(run.stdout).toBe("");
    expect(stub.calls()).toHaveLength(0);
  });

  it("lore only in the description, not in the command: not spawned", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    runHook(bashPayload("ls", { description: "check the lore corpus" }), stub.dir);
    expect(stub.calls()).toHaveLength(0);
  });

  it("an mcp tool of another server: not spawned", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    const run = runHook(
      JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "mcp__github__create_issue", tool_input: { title: "lore" } }),
      stub.dir,
    );
    expect(run.stdout).toBe("");
    expect(stub.calls()).toHaveLength(0);
  });

  it("a non-Bash built-in tool mentioning lore in its input: not spawned", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    runHook(
      JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/x/lore/a.md" } }),
      stub.dir,
    );
    expect(stub.calls()).toHaveLength(0);
  });
});

describe("pre-tool-harness-run.mjs — lore call: blind pipe + verbatim relay (D10)", () => {
  it("`lore claim t` spawns `lore run attest-input`", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    runHook(bashPayload("lore claim t"), stub.dir);
    expect(stub.calls().map((c) => c.argv)).toEqual([["run", "attest-input"]]);
  });

  it("pipes the raw payload to the child byte-identical", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    const payload = bashPayload("lore claim t");
    runHook(payload, stub.dir);
    expect(stub.first().stdin).toBe(payload);
  });

  it("relays the child's stdout byte-identical and exits 0", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    const run = runHook(bashPayload("lore claim t"), stub.dir);
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(REWRITTEN_A);
  });

  it("a different child output is relayed unchanged (no re-serialisation, no trailing newline added)", () => {
    const stub = makeStub({ stdout: REWRITTEN_B });
    const run = runHook(bashPayload("lore evidence x --result pass"), stub.dir);
    expect(run.stdout).toBe(REWRITTEN_B);
  });

  it("a child output that is not hook JSON is still relayed blind (the hook owns no grammar)", () => {
    const stub = makeStub({ stdout: "opaque\n" });
    const run = runHook(bashPayload("lore get x"), stub.dir);
    expect(run.stdout).toBe("opaque\n");
  });

  it("lore inside a pipeline / after && still triggers", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    runHook(bashPayload("cd /tmp && lore ready p | head -3"), stub.dir);
    expect(stub.calls()).toHaveLength(1);
  });

  it("an mcp__lore__lore_create payload is piped and relayed", () => {
    const stub = makeStub({ stdout: REWRITTEN_B });
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "sess-2",
      tool_name: "mcp__lore__lore_create",
      tool_input: { type: "knowledge", title: "t", content: "c" },
    });
    const run = runHook(payload, stub.dir);
    expect(run.stdout).toBe(REWRITTEN_B);
    expect(stub.calls().map((c) => c.argv)).toEqual([["run", "attest-input"]]);
    expect(stub.first().stdin).toBe(payload);
  });
});

describe("pre-tool-harness-run.mjs — fail-open (D7, BR-1030)", () => {
  it("child exits 1: exit 0 and no updatedInput", () => {
    const stub = makeStub({ stdout: "", exit: 1 });
    const run = runHook(bashPayload("lore claim t"), stub.dir);
    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain("updatedInput");
  });

  it("child exits 3 after printing an updatedInput: the failed child's stdout is NOT relayed", () => {
    const stub = makeStub({ stdout: REWRITTEN_A, exit: 3 });
    const run = runHook(bashPayload("lore claim t"), stub.dir);
    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain("updatedInput");
  });

  it("lore absent from PATH on a lore command: exit 0 and no updatedInput", () => {
    const run = runHookWithoutLore(bashPayload("lore claim t"));
    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain("updatedInput");
  });

  it("whatever the hook prints on failure is empty or valid JSON (never a crash trace)", () => {
    const stub = makeStub({ exit: 1 });
    const run = runHook(bashPayload("lore claim t"), stub.dir);
    if (run.stdout.trim() !== "") expect(() => JSON.parse(run.stdout)).not.toThrow();
  });

  it("malformed stdin: exit 0, nothing spawned, no updatedInput", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    const run = runHook("{not json", stub.dir);
    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain("updatedInput");
    expect(stub.calls()).toHaveLength(0);
  });

  it("empty stdin: exit 0, nothing spawned", () => {
    const stub = makeStub({ stdout: REWRITTEN_A });
    const run = runHook("", stub.dir);
    expect(run.status).toBe(0);
    expect(stub.calls()).toHaveLength(0);
  });
});
