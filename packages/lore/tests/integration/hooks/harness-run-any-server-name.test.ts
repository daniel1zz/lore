// @spawns assets/hooks/pre-tool-harness-run.mjs
// @spawns dist/lore
/**
 * @spec_ref AC-TE-6
 *
 * `assets/hooks/pre-tool-harness-run.mjs` must trigger on every lore MCP tool call whatever the
 * server's registered name (`mcp__<server>__lore_<verb>`), and leave other servers' tools alone
 * (spec-interception-moves-off-every-tool-call-one-turn-end-review, Scope 6, BR-1093).
 *
 * The hook is a blind pipe (spec D10): "triggered" means it spawned `lore run attest-input` and
 * relayed the verb's `updatedInput` answer. A stub `lore` on PATH plays the verb for a registered
 * run, so no real state (~/.claude, this repo's .lore) is touched.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "pre-tool-harness-run.mjs");
const RUN_ID = "run-test-registered";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(d);
  return d;
}

/** Stub verb: answers every `lore run attest-input` with an updatedInput carrying the run. */
function stubLoreDir(): string {
  const dir = scratch("any-server-stub-");
  const answer = JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { run: RUN_ID } },
  });
  writeFileSync(join(dir, "lore"), `#!/bin/bash\ncat > /dev/null\nprintf '%s' '${answer}'\n`);
  chmodSync(join(dir, "lore"), 0o755);
  return dir;
}

function runHookFor(toolName: string): { status: number | null; stdout: string } {
  expect(existsSync(HOOK_PATH), `hook script missing: ${HOOK_PATH}`).toBe(true);
  const cwd = scratch("any-server-cwd-");
  const r = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: { slug: "x" },
      session_id: "s1",
    }),
    encoding: "utf8",
    cwd,
    timeout: 20000,
    env: { PATH: `${stubLoreDir()}:/usr/bin:/bin`, HOME: cwd },
  });
  return { status: r.status, stdout: r.stdout };
}

const carriesRun = (stdout: string): boolean => stdout.includes(`"updatedInput":{"run":"${RUN_ID}"}`);

describe("AC-TE-6 pre-tool-harness-run rewrites lore tools under any MCP server name", () => {
  it("AC-TE-6 HAPPY: mcp__lore__lore_get is rewritten", () => {
    const r = runHookFor("mcp__lore__lore_get");
    expect(r.status).toBe(0);
    expect(carriesRun(r.stdout)).toBe(true);
  });

  it("AC-TE-6 HAPPY: mcp__lore-dev__lore_get (renamed server) is rewritten", () => {
    const r = runHookFor("mcp__lore-dev__lore_get");
    expect(r.status).toBe(0);
    expect(carriesRun(r.stdout)).toBe(true);
  });

  it("AC-TE-6 NEGATIVE: mcp__github__get_issue is untouched", () => {
    const r = runHookFor("mcp__github__get_issue");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("AC-TE-6 NEGATIVE edge: mcp__mylore__get_issue (lore in server name, no lore_ verb) is untouched", () => {
    const r = runHookFor("mcp__mylore__get_issue");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------
// Real binary, no stub: the AC-TE-6 oracle. `dist/lore` is on PATH, a throwaway git repo carries a
// `lore init` corpus, and the run is registered with `lore run register`. Never touches the repo's
// own `.lore/` nor the real ~/.claude (HOME is scrubbed to the scratch root).
// ---------------------------------------------------------------------------------------------

const REAL_BIN_DIR = join(REPO_ROOT, "dist");
const REAL_SESSION = "any-server-real-session";
const REAL_RUN = `cc:${REAL_SESSION}`;

function realEnv(root: string): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    CLAUDECODE: "1",
    PATH: `${REAL_BIN_DIR}:${process.env["PATH"] ?? ""}`,
  };
  for (const k of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"]) delete e[k];
  return e;
}

describe("AC-TE-6 REAL_BINARY_NO_STUB: built dist/lore attributes the run under any MCP server name", () => {
  let root = "";
  let corpus = "";
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const hookOutput = (toolName: string): { status: number | null; updatedInput: Record<string, unknown> | null; raw: string } => {
    const r = spawnSync(process.execPath, [HOOK_PATH], {
      cwd: corpus,
      env: realEnv(root),
      encoding: "utf8",
      timeout: 60000,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: toolName,
        tool_input: { slug: "x" },
        session_id: REAL_SESSION,
      }),
    });
    const raw = r.stdout;
    if (raw === "") return { status: r.status, updatedInput: null, raw };
    const parsed = JSON.parse(raw) as { hookSpecificOutput?: { updatedInput?: Record<string, unknown> } };
    return { status: r.status, updatedInput: parsed.hookSpecificOutput?.updatedInput ?? null, raw };
  };

  it("fixture: dist/lore exists and registers the run", () => {
    expect(existsSync(join(REAL_BIN_DIR, "lore")), "dist/lore missing: run `bun run build` first").toBe(true);
    root = mkdtempSync(join(tmpdir(), "any-server-real-"));
    // removed by afterAll below: the shared afterEach would delete it between tests
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(join(root, "xdg"), { recursive: true });
    corpus = join(root, "corpus");
    mkdirSync(corpus, { recursive: true });
    const sh = (cmd: string, args: string[]): void => {
      const r = spawnSync(cmd, args, { cwd: corpus, env: realEnv(root), encoding: "utf8" });
      if (r.status !== 0) throw new Error(`fixture \`${cmd} ${args.join(" ")}\` failed: ${r.stderr}${r.stdout}`);
    };
    sh("git", ["init", "-q", "-b", "main"]);
    sh("lore", ["init"]);
    sh("lore", ["run", "register", "--harness", "claude-code", "--session", REAL_SESSION]);
  }, 60_000);

  it.each(["mcp__lore__lore_get", "mcp__lore-dev__lore_get"])("%s gets updatedInput carrying the run", (tool) => {
    const r = hookOutput(tool);
    expect(r.status).toBe(0);
    expect(r.raw).not.toContain("permissionDecision");
    expect(r.updatedInput).toMatchObject({ slug: "x", harness_run: REAL_RUN });
  });

  it.each(["mcp__github__get_issue", "mcp__mylore__get_issue"])("%s gets no updatedInput", (tool) => {
    const r = hookOutput(tool);
    expect(r.status).toBe(0);
    expect(r.updatedInput).toBeNull();
  });
});
