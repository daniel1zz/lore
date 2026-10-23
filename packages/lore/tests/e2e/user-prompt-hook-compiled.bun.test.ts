// @spawns dist/lore
// @spawns assets/hooks/user-prompt-fragments.mjs
/**
 * Compiled-binary e2e oracle for the UserPromptSubmit per-turn fragment hook
 * (spec-fragment-injection-timing-one-inject-enum-a-per-turn, task-i2-user-prompt-fragments-mjs-userpromptsubmit-hook).
 *
 * Isolation: every sandbox is a mkdtemp tree holding HOME, LORE_CONFIG_HOME and a throwaway `lore init`
 * corpus (cwd); PATH resolves `lore` to THIS worktree's dist/lore. Never touches the repo's `.lore/` or the real HOME.
 *
 * @spec_ref spec-fragment-injection-timing-one-inject-enum-a-per-turn AC-IT-4
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const HOOK = join(REPO_ROOT, "assets", "hooks", "user-prompt-fragments.mjs");

let BIN_DIR = "";
let NODE_DIR = "";

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  const node = Bun.which("node");
  if (node === null) throw new Error("harness: `node` not found on PATH; the shipped hooks are node scripts");
  NODE_DIR = dirname(node);
  BIN_DIR = realpathSync(mkdtempSync(join(tmpdir(), "lore-up-bin-")));
  symlinkSync(LORE_BIN, join(BIN_DIR, "lore"));
  const claudeStub = join(BIN_DIR, "claude");
  writeFileSync(claudeStub, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(claudeStub, 0o755);
});

afterAll(() => {
  if (BIN_DIR !== "") rmSync(BIN_DIR, { recursive: true, force: true });
});

interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly loreHome: string;
  readonly corpus: string;
  readonly env: Record<string, string>;
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
}

const sandboxes: string[] = [];
afterAll(() => {
  for (const root of sandboxes) rmSync(root, { recursive: true, force: true });
});

function run(cmd: string[], sb: Sandbox, opts: { input?: string; env?: Record<string, string> } = {}): Run {
  const started = performance.now();
  const proc = Bun.spawnSync(cmd, {
    cwd: sb.corpus,
    env: opts.env ?? sb.env,
    ...(opts.input !== undefined ? { stdin: Buffer.from(opts.input, "utf8") } : {}),
  });
  return { code: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), ms: performance.now() - started };
}

function lore(sb: Sandbox, ...args: string[]): Run {
  return run([LORE_BIN, ...args], sb);
}

function makeSandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-up-e2e-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  sandboxes.push(root);
  const home = join(root, "home");
  const loreHome = join(root, "lore-home");
  const corpus = join(root, "corpus");
  for (const d of [home, loreHome, corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LORE_SETUP_NO_CHECK"]) {
    delete env[k];
  }
  env["HOME"] = home;
  env["LORE_CONFIG_HOME"] = loreHome;
  env["CLAUDECODE"] = "1";
  env["PATH"] = [BIN_DIR, NODE_DIR, "/usr/bin", "/bin"].join(":");
  const sb: Sandbox = { root, home, loreHome, corpus, env };
  const init = lore(sb, "init");
  if (init.code !== 0) throw new Error(`harness: lore init failed in fixture setup: ${init.stderr}`);
  return sb;
}

function nonce(tag: string): string {
  return `NONCE-${tag}-${randomUUID().slice(0, 8)}`;
}

/** Fragment file; `injectLines` is the raw frontmatter text for the inject key (flow or block style). */
function writeFragment(dir: string, id: string, injectLines: string, body: string, extraFrontmatter = ""): void {
  mkdirSync(dir, { recursive: true });
  const text = ["---", `id: ${id}`, `title: fixture ${id}`, injectLines, ...(extraFrontmatter === "" ? [] : [extraFrontmatter]), "---", "", body, ""].join("\n");
  writeFileSync(join(dir, `${id}.md`), text, "utf8");
}

const projectCtxDir = (sb: Sandbox): string => join(sb.corpus, ".lore", "context");
const userCtxDir = (sb: Sandbox): string => join(sb.loreHome, "context");

function hook(sb: Sandbox, opts: { env?: Record<string, string> } = {}): Run {
  return run(["node", HOOK], sb, {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "up-e2e", cwd: sb.corpus, prompt: "hello" }),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  });
}

function additionalContext(r: Run): string {
  const parsed = JSON.parse(r.stdout) as { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string } };
  expect(parsed.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
  return parsed.hookSpecificOutput?.additionalContext ?? "";
}

describe("AC-IT-4", () => {
  it("registers a UserPromptSubmit entry running user-prompt-fragments.mjs after lore setup", () => {
    const sb = makeSandbox();
    const r = lore(sb, "setup", "--yes");
    expect(r.code, r.stderr).toBe(0);
    const settingsPath = join(sb.home, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const commands = (settings.hooks?.["UserPromptSubmit"] ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command ?? ""));
    expect(commands.some((c) => c.includes("user-prompt-fragments.mjs"))).toBe(true);
    expect(commands.some((c) => c.includes("user-prompt-turn-start.mjs"))).toBe(true);
  });

  it("injects the project-layer user-prompt fixture and not a launch fixture", () => {
    const sb = makeSandbox();
    const perTurn = nonce("proj-turn");
    const launch = nonce("proj-launch");
    writeFragment(projectCtxDir(sb), "up-proj-turn", "inject: [user-prompt]", `- ${perTurn}`);
    writeFragment(projectCtxDir(sb), "up-proj-launch", "inject: [launch]", `- ${launch}`);
    const r = hook(sb);
    expect(r.code, r.stderr).toBe(0);
    const ctx = additionalContext(r);
    expect(ctx).toContain(perTurn);
    expect(ctx).not.toContain(launch);
  });

  it("injects a user-layer block-style list under LORE_CONFIG_HOME and ignores a decoy under HOME/.config/lore", () => {
    const sb = makeSandbox();
    const real = nonce("user-block");
    const decoy = nonce("decoy");
    writeFragment(userCtxDir(sb), "up-user-block", "inject:\n  - user-prompt", `- ${real}`);
    writeFragment(join(sb.home, ".config", "lore", "context"), "up-decoy", "inject: [user-prompt]", `- ${decoy}`);
    const r = hook(sb);
    expect(r.code, r.stderr).toBe(0);
    const ctx = additionalContext(r);
    expect(ctx).toContain(real);
    expect(ctx).not.toContain(decoy);
  });

  it("prints {} with PATH lacking lore when no fragment names user-prompt (fast path, no spawn)", () => {
    const sb = makeSandbox();
    writeFragment(projectCtxDir(sb), "up-launch-only", "inject: [launch]", `- ${nonce("l")}`);
    const r = hook(sb, { env: { ...sb.env, PATH: NODE_DIR } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe("{}");
  });

  it("exits 0 with the error code in additionalContext for an invalid user-prompt fragment", () => {
    const sb = makeSandbox();
    // reason: unknown frontmatter key makes the fragment schema-invalid while still naming user-prompt.
    writeFragment(projectCtxDir(sb), "up-invalid", "inject: [user-prompt]", `- ${nonce("bad")}`, "bogus_key: 1");
    const r = hook(sb);
    expect(r.code, r.stderr).toBe(0);
    expect(additionalContext(r)).toMatch(/VALIDATION_ERROR|[A-Z]+_[A-Z_]+/);
  });

  it("exits 0 within 5 s with a render-failed banner when the lore on PATH sleeps 10 s", () => {
    const sb = makeSandbox();
    writeFragment(projectCtxDir(sb), "up-slow", "inject: [user-prompt]", `- ${nonce("slow")}`);
    const stubDir = realpathSync(mkdtempSync(join(tmpdir(), "lore-up-stub-")));
    sandboxes.push(stubDir);
    const stub = join(stubDir, "lore");
    // reason: no `exec` on purpose; a sleeping grandchild holding the pipe must not delay the hook past its own timeout.
    writeFileSync(stub, "#!/bin/sh\nsleep 10\n", "utf8");
    chmodSync(stub, 0o755);
    const r = hook(sb, { env: { ...sb.env, PATH: [stubDir, NODE_DIR, "/usr/bin", "/bin"].join(":") } });
    expect(r.code, r.stderr).toBe(0);
    expect(r.ms).toBeLessThan(5000);
    expect(additionalContext(r)).toContain("render failed");
  });

  it("exits exactly 2 for an unknown outlet and lists hook:user-prompt", () => {
    const sb = makeSandbox();
    const r = lore(sb, "fragments", "render", "--outlet", "hook:bogus", "--cwd", sb.corpus);
    expect(r.code).toBe(2);
    expect(r.stderr + r.stdout).toContain("hook:user-prompt");
  });

  it("median wall time of 10 spawning renders is under 2000 ms", () => {
    const sb = makeSandbox();
    writeFragment(projectCtxDir(sb), "up-latency", "inject: [user-prompt]", `- ${nonce("lat")}`);
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = hook(sb);
      expect(r.code, r.stderr).toBe(0);
      expect(additionalContext(r)).toContain("NONCE-lat-");
      times.push(r.ms);
    }
    times.sort((a, b) => a - b);
    const median = ((times[4] ?? Infinity) + (times[5] ?? Infinity)) / 2;
    expect(median).toBeLessThan(2000);
  });
});
