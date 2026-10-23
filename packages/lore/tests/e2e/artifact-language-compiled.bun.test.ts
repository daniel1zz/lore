// @spawns dist/lore
/**
 * AC-IT-6 (compiled half): with a temp HOME whose global config sets `context.artifact_language: en` and a user
 * launch fragment naming `{{lore:artifact_language}}`, `lore context refresh --scope user` writes a rules file
 * containing "English" - proving `toContextLayer` carries the key from config to the expander.
 * Spec: spec-fragment-injection-timing-one-inject-enum-a-per-turn (context.artifact_language, D10).
 *
 * Isolation: mkdtemp HOME + LORE_CONFIG_HOME + throwaway `lore init` corpus; never the repo's `.lore/`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

let BIN_DIR = "";
let NODE_DIR = "";
const roots: string[] = [];

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  const node = Bun.which("node");
  if (node === null) throw new Error("harness: `node` not found on PATH");
  NODE_DIR = dirname(node);
  BIN_DIR = realpathSync(mkdtempSync(join(tmpdir(), "lore-al-bin-")));
  symlinkSync(LORE_BIN, join(BIN_DIR, "lore"));
  const claudeStub = join(BIN_DIR, "claude");
  writeFileSync(claudeStub, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(claudeStub, 0o755);
});

afterAll(() => {
  if (BIN_DIR !== "") rmSync(BIN_DIR, { recursive: true, force: true });
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface Sandbox {
  readonly home: string;
  readonly cfg: string;
  readonly corpus: string;
  readonly env: Record<string, string>;
}

function lore(sb: Sandbox, ...args: string[]): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd: sb.corpus, env: sb.env });
  return { code: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function makeSandbox(globalConfigYaml: string | null): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-al-e2e-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  roots.push(root);
  const home = join(root, "home");
  const cfg = join(root, "cfg");
  const corpus = join(root, "corpus");
  for (const d of [home, cfg, corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LORE_SETUP_NO_CHECK"]) {
    delete env[k];
  }
  env["HOME"] = home;
  env["LORE_CONFIG_HOME"] = cfg;
  env["CLAUDECODE"] = "1";
  env["PATH"] = [BIN_DIR, NODE_DIR, "/usr/bin", "/bin"].join(":");
  const sb: Sandbox = { home, cfg, corpus, env };
  if (globalConfigYaml !== null) writeFileSync(join(cfg, "config.yaml"), globalConfigYaml, "utf8");
  const init = lore(sb, "init");
  if (init.code !== 0) throw new Error(`harness: lore init failed: ${init.stderr}`);
  return sb;
}

function writeUserFragment(sb: Sandbox, body: string): void {
  const dir = join(sb.cfg, "context");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "al-user.md"), `---\nid: al-user\ntitle: artifact language fixture\ninject: [launch]\n---\n\n${body}\n`, "utf8");
}

const rulesFile = (sb: Sandbox): string => join(sb.home, ".claude", "rules", "lore-al-user.md");

describe("AC-IT-6", () => {
  it("HAPPY: global artifact_language en reaches the user-scope rules file as 'English'", () => {
    const sb = makeSandbox("context:\n  artifact_language: en\n");
    writeUserFragment(sb, "Write every document in {{lore:artifact_language}}.");
    const r = lore(sb, "context", "refresh", "--scope", "user");
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(rulesFile(sb))).toBe(true);
    const content = readFileSync(rulesFile(sb), "utf8");
    expect(content).toContain("Write every document in English.");
    expect(content).not.toContain("{{lore:");
  });

  it("ERROR: unset artifact_language refuses the refresh naming artifact_language and writes no rules file", () => {
    const sb = makeSandbox(null);
    writeUserFragment(sb, "Write every document in {{lore:artifact_language}}.");
    const r = lore(sb, "context", "refresh", "--scope", "user");
    expect(r.code).not.toBe(0);
    expect(r.stderr + r.stdout).toContain("artifact_language");
    expect(existsSync(rulesFile(sb))).toBe(false);
  });

  it("NEGATIVE: an unknown code refuses the refresh naming context.artifact_language", () => {
    const sb = makeSandbox("context:\n  artifact_language: xx\n");
    writeUserFragment(sb, "Write every document in {{lore:artifact_language}}.");
    const r = lore(sb, "context", "refresh", "--scope", "user");
    expect(r.code).not.toBe(0);
    expect(r.stderr + r.stdout).toContain("context.artifact_language");
    expect(existsSync(rulesFile(sb))).toBe(false);
  });
});
