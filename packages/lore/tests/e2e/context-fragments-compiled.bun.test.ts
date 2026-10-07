/**
 * RED (TDD role) — compiled-binary e2e oracles for the context-fragments
 * feature (spec-context-fragments-config-driven-layered-rule-injection):
 * AC-CF-4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 17, 18.
 *
 * Nothing of the feature exists yet: `lore fragments` is an unregistered
 * command, `assets/context/` and `assets/hooks/session-start-fragments.mjs`
 * are absent, `subagent-context.mjs` still carries hard-coded per-type text,
 * `session-start-resume.mjs` still injects Phase C (the 10,370-char
 * corpus-workflow prose), `lore setup` does not project `context.language`,
 * the shipped agents lack `omitClaudeMd`, and `lore governance
 * corpus-workflow` still prints the prose. Every describe below therefore
 * fails today FOR THAT MISSING BEHAVIOUR (unknown command / missing file /
 * assertion mismatch), never for a harness reason. Each negative-path test
 * carries a liveness CONTROL (a passing baseline of the same command in the
 * same sandbox) so that "exit non-zero" cannot be satisfied vacuously by
 * citty's flat exit 1 for an unknown command.
 *
 * Contract assumptions this file pins that the spec leaves open (the
 * implementer must conform, or re-baseline this file explicitly):
 *   - `lore fragments check --json` carries the agent types it checked under
 *     a key matching /agent.?types?/i (array of names, or object keyed by
 *     name), found by recursive search so an `{ok,data}` envelope is fine.
 *   - Project fragments live in `<corpus>/.lore/context/*.md`, the user layer
 *     in `$XDG_CONFIG_HOME/lore/context/*.md`, global config in
 *     `$XDG_CONFIG_HOME/lore/config.yaml`, project config in
 *     `<corpus>/.lore/config.yaml` (key `context.language`).
 *   - A schema-invalid fragment surfaces as `VALIDATION_ERROR`; an over-cap
 *     fragment as `BUDGET_EXCEEDED` (spec D6) in the hook's additionalContext.
 *   - `lore setup` leaves every top-level settings.json key except `hooks`
 *     and `language` untouched (setup's own hook registration is out of the
 *     "only `language` may change" clause).
 *   - Sentinels are HARD-CODED copies (taken 2026-10-07 from the pre-change
 *     assets) so the oracle survives the asset being moved or deleted.
 *
 * Isolation: every sandbox is a mkdtemp tree holding HOME, XDG_CONFIG_HOME
 * and a throwaway `lore init` corpus (cwd); a `claude` stub on PATH keeps
 * `lore setup` MCP registration from touching the real CLI; PATH resolves
 * `lore` to THIS worktree's dist/lore. Never touches the repo's `.lore/` or
 * the real `~/.claude`.
 *
 * @spec_ref spec-context-fragments-config-driven-layered-rule-injection
 *   AC-CF-4 AC-CF-5 AC-CF-6 AC-CF-7 AC-CF-8 AC-CF-9 AC-CF-10 AC-CF-11
 *   AC-CF-12 AC-CF-15 AC-CF-17 AC-CF-18;
 *   task task-skill-test-compiled-e2e-red-fragments-cli-hooks-setup.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { parse as parseYaml } from "yaml";
import { BOOTSTRAP_FRAMING_LINE, CLAUDE_MD_MARKER_END, CLAUDE_MD_MARKER_START } from "@lore/core";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const ASSETS_DIR = join(REPO_ROOT, "assets");
const HOOKS_DIR = join(ASSETS_DIR, "hooks");

const HOOK_STRING_CAP = 10_000;
/** Hard-coded pre-change executor text from assets/hooks/subagent-context.mjs (AC-CF-7 must-be-absent sentinel). */
const OLD_EXECUTOR_SENTINEL = "类型→Skill：refactor→lore-refactor / bug|perf→lore-diagnose / tests→lore-test";
/** One sentence from assets/governance/corpus-workflow.md (AC-CF-8 sentinel). */
const CORPUS_WORKFLOW_SENTINEL = "a released-but-uncommitted worktree is what routine cleanup destroys";
const STALE_MARKER = "lore:stale-managed-context";

let BIN_DIR = "";
let NODE_DIR = "";

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  const node = Bun.which("node");
  if (node === null) throw new Error("harness: `node` not found on PATH; the shipped hooks are node scripts");
  NODE_DIR = dirname(node);
  BIN_DIR = realpathSync(mkdtempSync(join(tmpdir(), "lore-cf-bin-")));
  symlinkSync(LORE_BIN, join(BIN_DIR, "lore"));
  const claudeStub = join(BIN_DIR, "claude");
  writeFileSync(claudeStub, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(claudeStub, 0o755);
});

afterAll(() => {
  if (BIN_DIR !== "") rmSync(BIN_DIR, { recursive: true, force: true });
});

// ─── harness ────────────────────────────────────────────────────────────────

interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly xdg: string;
  readonly corpus: string;
  readonly env: Record<string, string>;
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const sandboxes: string[] = [];
afterAll(() => {
  for (const root of sandboxes) rmSync(root, { recursive: true, force: true });
});

function run(cmd: string[], sb: Sandbox, input?: string): Run {
  const proc = Bun.spawnSync(cmd, {
    cwd: sb.corpus,
    env: sb.env,
    ...(input !== undefined ? { stdin: Buffer.from(input, "utf8") } : {}),
  });
  return { code: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function lore(sb: Sandbox, ...args: string[]): Run {
  return run([LORE_BIN, ...args], sb);
}

function makeSandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-cf-e2e-")));
  // Never the repo's own corpus or the real HOME.
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  sandboxes.push(root);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  const corpus = join(root, "corpus");
  for (const d of [home, xdg, corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LORE_SETUP_NO_CHECK"]) {
    delete env[k];
  }
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = xdg;
  env["CLAUDECODE"] = "1";
  env["PATH"] = [BIN_DIR, NODE_DIR, "/usr/bin", "/bin"].join(":");
  const sb: Sandbox = { root, home, xdg, corpus, env };
  const init = lore(sb, "init");
  if (init.code !== 0) throw new Error(`harness: lore init failed in fixture setup: ${init.stderr}`);
  return sb;
}

function nonce(tag: string): string {
  return `NONCE-${tag}-${randomUUID().slice(0, 8)}`;
}

interface FragmentSpec {
  readonly audience: readonly string[];
  readonly mode: "static" | "dynamic";
  readonly body: string;
  readonly when?: Record<string, readonly string[]>;
}

function writeFragment(dir: string, id: string, spec: FragmentSpec): string {
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `audience: [${spec.audience.map((a) => JSON.stringify(a)).join(", ")}]`,
    `mode: ${spec.mode}`,
    ...(spec.when !== undefined ? [`when: ${JSON.stringify(spec.when)}`] : []),
    "---",
    "",
  ].join("\n");
  const path = join(dir, `${id}.md`);
  writeFileSync(path, `${fm}${spec.body}\n`, "utf8");
  return path;
}

const projectCtxDir = (sb: Sandbox): string => join(sb.corpus, ".lore", "context");
const userCtxDir = (sb: Sandbox): string => join(sb.xdg, "lore", "context");
const projectClaudeMd = (sb: Sandbox): string => join(sb.corpus, "CLAUDE.md");

function writeGlobalConfig(sb: Sandbox, yaml: string): void {
  mkdirSync(join(sb.xdg, "lore"), { recursive: true });
  writeFileSync(join(sb.xdg, "lore", "config.yaml"), yaml, "utf8");
}

function appendProjectConfig(sb: Sandbox, yaml: string): void {
  const path = join(sb.corpus, ".lore", "config.yaml");
  writeFileSync(path, `${readFileSync(path, "utf8")}${yaml}`, "utf8");
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** `lore context init` (exit 0 required) — fresh two-zone project CLAUDE.md. */
function contextInit(sb: Sandbox): void {
  const r = lore(sb, "context", "init");
  expect(r.code).toBe(0);
}

function setupGlobal(sb: Sandbox): Run {
  return lore(sb, "setup", "--yes");
}

interface HookOut {
  readonly hookEventName: string;
  readonly additionalContext: string;
}

function parseHookOutput(stdout: string): HookOut | null {
  try {
    const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { hookEventName?: unknown; additionalContext?: unknown } };
    const o = parsed.hookSpecificOutput;
    if (o === undefined || typeof o.hookEventName !== "string" || typeof o.additionalContext !== "string") return null;
    return { hookEventName: o.hookEventName, additionalContext: o.additionalContext };
  } catch {
    return null;
  }
}

function runHook(sb: Sandbox, hookPath: string, payload: Record<string, unknown>): Run {
  return run(["node", hookPath], sb, JSON.stringify({ cwd: sb.corpus, ...payload }));
}

function subagentHook(sb: Sandbox, agentType: string): { run: Run; out: HookOut | null } {
  const r = runHook(sb, join(HOOKS_DIR, "subagent-context.mjs"), { hook_event_name: "SubagentStart", agent_type: agentType });
  return { run: r, out: parseHookOutput(r.stdout) };
}

function sessionStartPayload(source: string): Record<string, unknown> {
  return { hook_event_name: "SessionStart", source, session_id: "cf-e2e" };
}

/** Text strictly inside the lore-managed zone markers of a CLAUDE.md. */
function managedZone(content: string): string {
  const start = content.indexOf(CLAUDE_MD_MARKER_START);
  const end = content.indexOf(CLAUDE_MD_MARKER_END);
  if (start < 0 || end < 0 || end < start) return "";
  return content.slice(start + CLAUDE_MD_MARKER_START.length, end);
}

const FINGERPRINT = /^<!-- lore:managed section=(\S+) hash=[0-9a-f]{8} -->$/;

/** Body lines of one managed section (between its fingerprint line and the next fingerprint / end marker). */
function sectionRange(lines: string[], id: string): { from: number; to: number } | null {
  const idx = lines.findIndex((l) => FINGERPRINT.exec(l)?.[1] === id);
  if (idx < 0) return null;
  let to = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (FINGERPRINT.test(line) || line.startsWith(CLAUDE_MD_MARKER_END)) {
      to = i;
      break;
    }
  }
  return { from: idx + 1, to };
}

function listSessionStartCommands(settings: Record<string, unknown>): { matcher: string | undefined; command: string }[] {
  const hooks = settings["hooks"] as Record<string, unknown> | undefined;
  const entries = (hooks?.["SessionStart"] ?? []) as { matcher?: string; hooks?: { command?: string }[] }[];
  const flat: { matcher: string | undefined; command: string }[] = [];
  for (const e of entries) for (const h of e.hooks ?? []) flat.push({ matcher: e.matcher, command: h.command ?? "" });
  return flat;
}

function shippedAgentFiles(): string[] {
  return readdirSync(join(ASSETS_DIR, "agents")).filter((f) => f.endsWith(".md"));
}

/** Shipped static `main` fragments with no `when` clause, parsed from assets/context (empty when the dir is absent). */
function shippedStaticMainFragments(): { id: string; body: string }[] {
  const dir = join(ASSETS_DIR, "context");
  if (!existsSync(dir)) return [];
  const out: { id: string; body: string }[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const raw = readFileSync(join(dir, f), "utf8");
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
    if (m === null) continue;
    const fm = parseYaml(m[1] as string) as { id?: string; audience?: string[]; mode?: string; when?: unknown };
    if (fm.mode === "static" && Array.isArray(fm.audience) && fm.audience.includes("main") && fm.when === undefined) {
      out.push({ id: String(fm.id), body: (m[2] as string).trim() });
    }
  }
  return out;
}

function findAgentTypes(node: unknown): string[] | undefined {
  if (node === null || typeof node !== "object") return undefined;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (/agent.?types?/i.test(k)) {
      if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
      if (v !== null && typeof v === "object") return Object.keys(v as Record<string, unknown>);
    }
    const nested = findAgentTypes(v);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

const combined = (r: Run): string => `${r.stdout}\n${r.stderr}`;

// ─── AC-CF-4 ────────────────────────────────────────────────────────────────

describe("AC-CF-4 lore fragments check enumerates every agent type and refuses oversize and Z1 drift", () => {
  it("exits 0 on the shipped assets and its JSON lists at least (agent files + 1) agent types", () => {
    const sb = makeSandbox();
    const agentFiles = shippedAgentFiles().length;
    expect(agentFiles).toBeGreaterThanOrEqual(3);

    const r = lore(sb, "fragments", "check", "--json");
    expect(r.code).toBe(0);
    const types = findAgentTypes(JSON.parse(r.stdout));
    expect(types).toBeDefined();
    expect((types as string[]).length).toBeGreaterThanOrEqual(agentFiles + 1);
  });

  it("exits non-zero naming BUDGET_EXCEEDED and the fragment id for an oversized project fixture (control: clean baseline exits 0)", () => {
    const sb = makeSandbox();
    expect(lore(sb, "fragments", "check").code).toBe(0);

    writeFragment(projectCtxDir(sb), "cf4-oversized", {
      audience: ["subagent:*"],
      mode: "dynamic",
      body: "padding ".repeat(1_400),
    });
    const r = lore(sb, "fragments", "check");
    expect(r.code).not.toBe(0);
    expect(combined(r)).toContain("BUDGET_EXCEEDED");
    expect(combined(r)).toContain("cf4-oversized");
  });

  it("exits non-zero when the project CLAUDE.md fragments zone differs from a fresh render, and 0 again after refresh", () => {
    const sb = makeSandbox();
    contextInit(sb);
    expect(lore(sb, "context", "refresh").code).toBe(0);
    expect(lore(sb, "fragments", "check").code).toBe(0); // control: fresh zone is clean

    writeFragment(projectCtxDir(sb), "cf4-drift", { audience: ["main"], mode: "static", body: `Drift body ${nonce("cf4")}` });
    const drifted = lore(sb, "fragments", "check");
    expect(drifted.code).not.toBe(0);

    expect(lore(sb, "context", "refresh").code).toBe(0);
    expect(lore(sb, "fragments", "check").code).toBe(0); // drift was the only cause
  });
});

// ─── AC-CF-5 ────────────────────────────────────────────────────────────────

describe("AC-CF-5 language projection to Claude Code settings, user and project scope", () => {
  const SEED = { theme: "dark", env: { FOO: "bar" }, permissions: { allow: ["Bash(ls:*)"] } };

  it("global context.language zh writes language Chinese into HOME/.claude/settings.json and changes no other key", () => {
    const sb = makeSandbox();
    writeGlobalConfig(sb, "context:\n  language: zh\n");
    mkdirSync(join(sb.home, ".claude"), { recursive: true });
    writeFileSync(join(sb.home, ".claude", "settings.json"), `${JSON.stringify(SEED, null, 2)}\n`, "utf8");

    const r = setupGlobal(sb);
    expect(r.code).toBe(0);

    const after = readJson(join(sb.home, ".claude", "settings.json"));
    expect(after["language"]).toBe("Chinese");
    for (const [k, v] of Object.entries(SEED)) {
      expect(JSON.stringify(after[k])).toBe(JSON.stringify(v));
    }
    const stray = Object.keys(after).filter((k) => !(k in SEED) && k !== "language" && k !== "hooks");
    expect(stray).toEqual([]);
    expect(existsSync(join(sb.corpus, ".claude", "settings.local.json"))).toBe(false);
  });

  it("project context.language en writes English into .claude/settings.local.json and leaves the user settings file byte-identical", () => {
    const sb = makeSandbox();
    writeGlobalConfig(sb, "context:\n  language: zh\n");
    expect(setupGlobal(sb).code).toBe(0);
    const userPath = join(sb.home, ".claude", "settings.json");
    const userBefore = readFileSync(userPath, "utf8");
    expect(readJson(userPath)["language"]).toBe("Chinese");

    appendProjectConfig(sb, "context:\n  language: en\n");
    const localPath = join(sb.corpus, ".claude", "settings.local.json");
    mkdirSync(dirname(localPath), { recursive: true });
    const localSeed = { permissions: { allow: ["Bash(pwd)"] } };
    writeFileSync(localPath, `${JSON.stringify(localSeed, null, 2)}\n`, "utf8");

    expect(setupGlobal(sb).code).toBe(0);

    const local = readJson(localPath);
    expect(local["language"]).toBe("English");
    expect(JSON.stringify(local["permissions"])).toBe(JSON.stringify(localSeed.permissions));
    expect(readFileSync(userPath, "utf8")).toBe(userBefore);
  });
});

// ─── AC-CF-6 ────────────────────────────────────────────────────────────────

describe("AC-CF-6 project Z1 fragments section render and diverged_skip", () => {
  it("lore context refresh writes section=fragments holding the project fixture body and every shipped static main fragment body", () => {
    const sb = makeSandbox();
    contextInit(sb);
    const n = nonce("cf6");
    writeFragment(projectCtxDir(sb), "cf6-project", { audience: ["main"], mode: "static", body: `Project rule ${n}` });

    expect(lore(sb, "context", "refresh").code).toBe(0);

    const lines = readFileSync(projectClaudeMd(sb), "utf8").split("\n");
    const range = sectionRange(lines, "fragments");
    expect(range).not.toBeNull();
    const body = lines.slice((range as { from: number }).from, (range as { to: number }).to).join("\n");
    expect(body).toContain(n);

    const shipped = shippedStaticMainFragments();
    expect(shipped.length).toBeGreaterThan(0); // vacuous-pass guard: shipped layer must exist
    for (const frag of shipped) {
      expect(body).toContain(frag.body);
    }
  });

  it("a hand edit inside the fragments section makes the next refresh report diverged_skip and leaves the file bytes unchanged", () => {
    const sb = makeSandbox();
    contextInit(sb);
    writeFragment(projectCtxDir(sb), "cf6-project", { audience: ["main"], mode: "static", body: `Project rule ${nonce("cf6b")}` });
    expect(lore(sb, "context", "refresh").code).toBe(0);

    const path = projectClaudeMd(sb);
    const lines = readFileSync(path, "utf8").split("\n");
    const range = sectionRange(lines, "fragments");
    expect(range).not.toBeNull();
    const { from, to } = range as { from: number; to: number };
    let target = from;
    while (target < to && (lines[target] as string).trim() === "") target++;
    expect(target).toBeLessThan(to);
    lines[target] = `${lines[target]} <<< HAND-EDITED BY TEST >>>`;
    writeFileSync(path, lines.join("\n"), "utf8");
    const snapshot = readFileSync(path, "utf8");

    const r = lore(sb, "context", "refresh", "--json");
    const report = JSON.parse(r.stdout) as { data?: { sections?: { id: string; state: string }[] } };
    const fragmentsState = report.data?.sections?.find((s) => s.id === "fragments")?.state;
    expect(fragmentsState).toBe("diverged_skip");
    expect(readFileSync(path, "utf8")).toBe(snapshot);
  });
});

// ─── AC-CF-7 ────────────────────────────────────────────────────────────────

describe("AC-CF-7 subagent hook delivers project fragment via lore fragments render", () => {
  it("SubagentStart for lore-implementer carries a project-only nonce and not the old hard-coded executor text", () => {
    const sb = makeSandbox();
    const n = nonce("cf7");
    writeFragment(projectCtxDir(sb), "cf7-project", { audience: ["subagent:*"], mode: "static", body: `Subagent rule ${n}` });

    const { run: r, out } = subagentHook(sb, "lore-implementer");
    expect(r.code).toBe(0);
    expect(out).not.toBeNull();
    expect((out as HookOut).hookEventName).toBe("SubagentStart");
    expect((out as HookOut).additionalContext).toContain(n);
    expect((out as HookOut).additionalContext).not.toContain(OLD_EXECUTOR_SENTINEL);
  });

  it("a nonce addressed only to subagent:lore-reviewer does not reach lore-implementer (audience is not widened to *)", () => {
    const sb = makeSandbox();
    const reviewerOnly = nonce("cf7r");
    const everyone = nonce("cf7e");
    writeFragment(projectCtxDir(sb), "cf7-reviewer-only", { audience: ["subagent:lore-reviewer"], mode: "static", body: `Reviewer ${reviewerOnly}` });
    writeFragment(projectCtxDir(sb), "cf7-everyone", { audience: ["subagent:*"], mode: "static", body: `Everyone ${everyone}` });

    const { out } = subagentHook(sb, "lore-implementer");
    expect(out).not.toBeNull();
    expect((out as HookOut).additionalContext).toContain(everyone);
    expect((out as HookOut).additionalContext).not.toContain(reviewerOnly);
  });
});

// ─── AC-CF-8 ────────────────────────────────────────────────────────────────

describe("AC-CF-8 session start output under cap and governance prose moved to Z1", () => {
  it("setup registers resume and fragments SessionStart hooks, neither emits over 10,000 chars, and the corpus-workflow sentinel lives in Z1 not in hook output", () => {
    const sb = makeSandbox();
    expect(setupGlobal(sb).code).toBe(0);

    const commands = listSessionStartCommands(readJson(join(sb.home, ".claude", "settings.json"))).map((c) => c.command);
    expect(commands.some((c) => c.includes("session-start-resume.mjs"))).toBe(true);
    expect(commands.some((c) => c.includes("session-start-fragments.mjs"))).toBe(true);

    if (!existsSync(projectClaudeMd(sb))) contextInit(sb);
    lore(sb, "context", "refresh"); // exit code deliberately not asserted: the Z1 content below is the oracle

    let emitted = "";
    for (const name of ["session-start-resume.mjs", "session-start-fragments.mjs"]) {
      const hookPath = join(sb.home, ".claude", "hooks", name);
      expect(existsSync(hookPath)).toBe(true);
      const r = runHook(sb, hookPath, sessionStartPayload("startup"));
      expect(r.code).toBe(0);
      const out = parseHookOutput(r.stdout);
      const text = out !== null ? out.additionalContext : r.stdout;
      expect(text.length).toBeLessThanOrEqual(HOOK_STRING_CAP);
      emitted += `\n${text}`;
    }
    expect(emitted).not.toContain(CORPUS_WORKFLOW_SENTINEL);
    expect(managedZone(readFileSync(projectClaudeMd(sb), "utf8"))).toContain(CORPUS_WORKFLOW_SENTINEL);
  });
});

// ─── AC-CF-9 ────────────────────────────────────────────────────────────────

describe("AC-CF-9 installed shipped agents set omitClaudeMd true", () => {
  it("every agent file installed by lore setup parses with frontmatter omitClaudeMd === true (boolean)", () => {
    const sb = makeSandbox();
    expect(setupGlobal(sb).code).toBe(0);

    const agentsDir = join(sb.home, ".claude", "agents");
    const files = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")) : [];
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const raw = readFileSync(join(agentsDir, f), "utf8");
      const m = /^---\n([\s\S]*?)\n---/.exec(raw);
      expect(m).not.toBeNull();
      const fm = parseYaml((m as RegExpExecArray)[1] as string) as Record<string, unknown>;
      expect([f, fm["omitClaudeMd"]]).toEqual([f, true]);
    }
  });
});

// ─── AC-CF-10 ───────────────────────────────────────────────────────────────

describe("AC-CF-10 hook failure is loud and non-blocking", () => {
  it("a schema-invalid project fragment makes the subagent hook exit 0 with VALIDATION_ERROR in additionalContext", () => {
    const sb = makeSandbox();
    mkdirSync(projectCtxDir(sb), { recursive: true });
    writeFileSync(
      join(projectCtxDir(sb), "cf10-broken.md"),
      "---\nid: cf10-broken\ntitle: broken\naudience: [nobody-at-all]\nmode: sometimes\n---\nbody\n",
      "utf8",
    );

    const { run: r, out } = subagentHook(sb, "lore-implementer");
    expect(r.code).toBe(0);
    expect(out).not.toBeNull();
    expect((out as HookOut).additionalContext).toContain("VALIDATION_ERROR");
  });

  it("an over-budget project fragment makes the hook exit 0 with BUDGET_EXCEEDED in additionalContext", () => {
    const sb = makeSandbox();
    writeFragment(projectCtxDir(sb), "cf10-huge", { audience: ["subagent:*"], mode: "dynamic", body: "overflow ".repeat(1_300) });

    const { run: r, out } = subagentHook(sb, "lore-implementer");
    expect(r.code).toBe(0);
    expect(out).not.toBeNull();
    expect((out as HookOut).additionalContext).toContain("BUDGET_EXCEEDED");
  });
});

// ─── AC-CF-11 ───────────────────────────────────────────────────────────────

describe("AC-CF-11 compact matcher registered and re-injects dynamic main fragments", () => {
  it("lore setup registers a SessionStart entry with matcher compact for session-start-fragments.mjs", () => {
    const sb = makeSandbox();
    expect(setupGlobal(sb).code).toBe(0);
    const compact = listSessionStartCommands(readJson(join(sb.home, ".claude", "settings.json"))).filter((c) => c.matcher === "compact");
    expect(compact.some((c) => c.command.includes("session-start-fragments.mjs"))).toBe(true);
  });

  it("a compact-source payload makes the installed fragments hook re-emit a dynamic main fixture nonce", () => {
    const sb = makeSandbox();
    expect(setupGlobal(sb).code).toBe(0);
    const n = nonce("cf11");
    writeFragment(projectCtxDir(sb), "cf11-dynamic", { audience: ["main"], mode: "dynamic", body: `Dynamic rule ${n}` });

    const hookPath = join(sb.home, ".claude", "hooks", "session-start-fragments.mjs");
    expect(existsSync(hookPath)).toBe(true);
    const r = runHook(sb, hookPath, sessionStartPayload("compact"));
    expect(r.code).toBe(0);
    const out = parseHookOutput(r.stdout);
    expect(out).not.toBeNull();
    expect((out as HookOut).hookEventName).toBe("SessionStart");
    expect((out as HookOut).additionalContext).toContain(n);
  });
});

// ─── AC-CF-12 ───────────────────────────────────────────────────────────────

describe("AC-CF-12 stale Z1 backstop notice", () => {
  const FRAGMENTS_HOOK = join(HOOKS_DIR, "session-start-fragments.mjs");
  const STATIC_ID = "cf12-static";

  /** A corpus whose project CLAUDE.md Z1 was refreshed with one static main fixture. */
  function freshZ1(): Sandbox {
    const sb = makeSandbox();
    contextInit(sb);
    writeFragment(projectCtxDir(sb), STATIC_ID, { audience: ["main"], mode: "static", body: `Original static ${nonce("cf12-orig")}` });
    expect(lore(sb, "context", "refresh").code).toBe(0);
    return sb;
  }

  function startHook(sb: Sandbox): string {
    const r = runHook(sb, FRAGMENTS_HOOK, sessionStartPayload("startup"));
    expect(r.code).toBe(0);
    const out = parseHookOutput(r.stdout);
    expect(out).not.toBeNull();
    return (out as HookOut).additionalContext;
  }

  it("fresh Z1 produces neither the stale marker nor the fixture body", () => {
    const sb = freshZ1();
    const text = startHook(sb);
    expect(text).not.toContain(STALE_MARKER);
    expect(text).not.toContain("Original static");
  });

  it("stale Z1 emits the stale marker and the changed fragment nonce", () => {
    const sb = freshZ1();
    const changed = nonce("cf12-changed");
    writeFragment(projectCtxDir(sb), STATIC_ID, { audience: ["main"], mode: "static", body: `Changed static ${changed}` });

    const text = startHook(sb);
    expect(text).toContain(STALE_MARKER);
    expect(text).toContain(changed);
  });

  it("when changed bodies exceed the remaining budget the output lists the changed ids instead, within 10,000 chars", () => {
    const sb = freshZ1();
    const dynamicHead = nonce("cf12-dyn");
    const changedHead = nonce("cf12-big");
    writeFragment(projectCtxDir(sb), "cf12-dynamic-block", {
      audience: ["main"],
      mode: "dynamic",
      body: `${dynamicHead} ${"block ".repeat(1_550)}`, // ~9,300 chars: under the 9,600 block cap, leaves < 700 for the notice
    });
    writeFragment(projectCtxDir(sb), STATIC_ID, {
      audience: ["main"],
      mode: "static",
      body: `${changedHead} ${"changed ".repeat(375)}`, // ~3,000 chars: cannot fit the remainder
    });

    const text = startHook(sb);
    expect(text.length).toBeLessThanOrEqual(HOOK_STRING_CAP);
    expect(text).toContain(dynamicHead);
    expect(text).toContain(STALE_MARKER);
    expect(text).toContain(STATIC_ID);
    expect(text).not.toContain(changedHead);
  });
});

// ─── AC-CF-15 ───────────────────────────────────────────────────────────────

describe("AC-CF-15 user scope refresh writes only inside markers", () => {
  it("lore context refresh --scope user changes only the bytes between the lore markers of HOME/.claude/CLAUDE.md", () => {
    const sb = makeSandbox();
    const n = nonce("cf15");
    writeFragment(userCtxDir(sb), "cf15-user", { audience: ["main"], mode: "static", body: `User rule ${n}` });

    const claudeDir = join(sb.home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const path = join(claudeDir, "CLAUDE.md");
    const original = `# My hand notes\n\nhand text BEFORE the markers\n\n${CLAUDE_MD_MARKER_START}\n${CLAUDE_MD_MARKER_END}\n\nhand text AFTER the markers\n`;
    writeFileSync(path, original, "utf8");

    const r = lore(sb, "context", "refresh", "--scope", "user");
    expect(r.code).toBe(0);

    const after = readFileSync(path, "utf8");
    const prefix = original.slice(0, original.indexOf(CLAUDE_MD_MARKER_START) + CLAUDE_MD_MARKER_START.length);
    const suffix = original.slice(original.indexOf(CLAUDE_MD_MARKER_END));
    expect(after.startsWith(prefix)).toBe(true);
    expect(after.endsWith(suffix)).toBe(true);
    expect(after.slice(prefix.length, after.length - suffix.length)).toContain(n); // liveness: something was written between
  });
});

// ─── AC-CF-17 ───────────────────────────────────────────────────────────────

describe("AC-CF-17 governance corpus-workflow retired, other topics unchanged", () => {
  it("lore governance corpus-workflow exits non-zero, names lore fragments on stderr, and prints no workflow prose", () => {
    const sb = makeSandbox();
    const r = lore(sb, "governance", "corpus-workflow");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("lore fragments");
    expect(r.stdout).not.toContain(CORPUS_WORKFLOW_SENTINEL);
  });

  it("lore governance seat-briefing stdout stays byte-equal to assets/governance/seat-briefing.md", () => {
    const sb = makeSandbox();
    const r = lore(sb, "governance", "seat-briefing");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(readFileSync(join(ASSETS_DIR, "governance", "seat-briefing.md"), "utf8"));
  });

  it("lore governance bootstrap-framing stdout stays equal to BOOTSTRAP_FRAMING_LINE", () => {
    const sb = makeSandbox();
    const r = lore(sb, "governance", "bootstrap-framing");
    expect(r.code).toBe(0);
    expect(r.stdout.replace(/\n$/, "")).toBe(BOOTSTRAP_FRAMING_LINE);
  });
});

// ─── AC-CF-18 ───────────────────────────────────────────────────────────────

describe("AC-CF-18 language drift refused and unknown code refused", () => {
  it("fragments check exits 0 when Claude Code language equals the projection and non-zero naming both values when it differs", () => {
    const sb = makeSandbox();
    writeGlobalConfig(sb, "context:\n  language: zh\n");
    expect(setupGlobal(sb).code).toBe(0);
    const settingsPath = join(sb.home, ".claude", "settings.json");
    const settings = readJson(settingsPath);
    expect(settings["language"]).toBe("Chinese");
    expect(lore(sb, "fragments", "check").code).toBe(0); // equal -> clean

    writeFileSync(settingsPath, `${JSON.stringify({ ...settings, language: "French" }, null, 2)}\n`, "utf8");
    const drifted = lore(sb, "fragments", "check");
    expect(drifted.code).not.toBe(0);
    expect(combined(drifted)).toContain("French");
    expect(combined(drifted)).toContain("Chinese");

    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    expect(lore(sb, "fragments", "check").code).toBe(0); // restoring equality clears it
  });

  it("an unknown context.language code makes lore setup exit non-zero naming the code, and writes no language", () => {
    const sb = makeSandbox();
    writeGlobalConfig(sb, "context:\n  language: zz9\n");

    const r = setupGlobal(sb);
    expect(r.code).not.toBe(0);
    expect(combined(r)).toContain("zz9");
    const settingsPath = join(sb.home, ".claude", "settings.json");
    const language = existsSync(settingsPath) ? readJson(settingsPath)["language"] : undefined;
    expect(language).toBeUndefined();
  });
});
