// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-remove-the-lore-mcp-server AC-RMCP-2, rules BR-814 / BR-815 / BR-816 / BR-826 / BR-844 —
 *   task-skill-implement-lore-setup-registers-no-tool-server-and.
 *
 * `lore setup` neither registers nor de-registers a tool server. Spawns the REAL CLI with a fake `claude`
 * executable first on PATH that logs its argv; every run uses a throwaway HOME and `--claude-dir`.
 *
 * Coverage:
 *   HAPPY:      install exits exactly 0, no claude call, no kind "mcp" manifest entry, no `mcp` key in the --json receipt.
 *   NEGATIVE:   --dry-run writes no file and makes no claude call.
 *   BOUNDARY:   a user's unrelated setting and hook survive the install unchanged.
 *   STATE:      an unchanged re-install writes no file (BR-816).
 *   REGRESSION: an old manifest holding `mcp:lore` installs to exit 0 without the entry; a global uninstall over it
 *               exits 0 without calling claude (BR-844).
 *   ERROR:      an install that fails part-way writes no mcp entry and still makes no claude call.
 */

import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const BUN_BIN = (() => {
  const resolved = Bun.which("bun");
  if (resolved === null) throw new Error("setup-registers-no-tool-server.bun.test.ts: `bun` not found via Bun.which");
  return resolved;
})();
const MANIFEST_FILENAME = ".lore-setup-manifest.json";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly claudeDir: string;
  readonly fakeBin: string;
  readonly claudeLog: string;
}

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
});

function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "lore-setup-no-tool-server-"));
  scratchDirs.push(root);
  const home = join(root, "home");
  const claudeDir = join(root, "claude-dir");
  const fakeBin = join(root, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  const claudeLog = join(root, "claude-argv.log");
  const fakeClaude = join(fakeBin, "claude");
  writeFileSync(fakeClaude, `#!/bin/sh\necho "$@" >> "${claudeLog}"\nexit 0\n`);
  chmodSync(fakeClaude, 0o755);
  return { root, home, claudeDir, fakeBin, claudeLog };
}

function runSetup(sb: Sandbox, args: string[]): RunResult {
  const proc = Bun.spawnSync([BUN_BIN, "run", INDEX_TS, "setup", "--claude-dir", sb.claudeDir, ...args], {
    cwd: sb.root,
    env: { ...process.env, HOME: sb.home, PATH: sb.fakeBin },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function claudeCalls(sb: Sandbox): string {
  return existsSync(sb.claudeLog) ? readFileSync(sb.claudeLog, "utf8") : "";
}

/** path -> `mtimeMs:content` for every file under `dir` (recursive). */
function snapshotTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else out.set(full, `${stat.mtimeMs}:${readFileSync(full, "utf8")}`);
    }
  };
  walk(dir);
  return out;
}

interface ManifestShape {
  entries: { path: string; kind: string; sha256: string; written_at: string; ownership?: string }[];
}

function readManifest(sb: Sandbox): ManifestShape {
  return JSON.parse(readFileSync(join(sb.claudeDir, MANIFEST_FILENAME), "utf8")) as ManifestShape;
}

const USER_HOOK = { matcher: "Bash", hooks: [{ type: "command", command: "/usr/bin/true" }] };

function seedUserSettings(sb: Sandbox): void {
  writeFileSync(
    join(sb.claudeDir, "settings.json"),
    `${JSON.stringify({ theme: "user-owned-theme", hooks: { PostToolUse: [USER_HOOK] } }, null, 2)}\n`,
  );
}

describe("lore setup registers no tool server (AC-RMCP-2)", () => {
  it("AC-RMCP-2: --dry-run writes no file and calls no claude", () => {
    const sb = makeSandbox();
    seedUserSettings(sb);
    const before = snapshotTree(sb.claudeDir);
    const result = runSetup(sb, ["--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(claudeCalls(sb)).toBe("");
    expect(snapshotTree(sb.claudeDir)).toEqual(before);
    expect(existsSync(join(sb.claudeDir, MANIFEST_FILENAME))).toBe(false);
  });

  it("AC-RMCP-2: install exits 0, keeps unrelated settings, no claude call, no mcp entry, no mcp receipt key", () => {
    const sb = makeSandbox();
    seedUserSettings(sb);
    const result = runSetup(sb, ["--yes", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(claudeCalls(sb)).toBe("");
    expect(readManifest(sb).entries.some((e) => e.kind === "mcp" || e.path === "mcp:lore")).toBe(false);
    expect(Object.keys(JSON.parse(result.stdout) as Record<string, unknown>)).not.toContain("mcp");
    const settings = JSON.parse(readFileSync(join(sb.claudeDir, "settings.json"), "utf8")) as {
      theme?: string;
      hooks?: { PostToolUse?: unknown[] };
    };
    expect(settings.theme).toBe("user-owned-theme");
    // lore appends its own matcher groups next to the user's; the user's group stays byte-identical and first.
    expect(JSON.stringify(settings.hooks?.PostToolUse?.[0])).toBe(JSON.stringify(USER_HOOK));
  });

  it("AC-RMCP-2: an unchanged re-install exits 0, writes no file and calls no claude", () => {
    const sb = makeSandbox();
    expect(runSetup(sb, ["--yes"]).exitCode).toBe(0);
    const before = snapshotTree(sb.claudeDir);
    const second = runSetup(sb, ["--yes"]);
    expect(second.exitCode).toBe(0);
    expect(snapshotTree(sb.claudeDir)).toEqual(before);
    expect(claudeCalls(sb)).toBe("");
  });

  it("AC-RMCP-2: an old manifest with mcp:lore installs to exit 0 without the entry and without calling claude", () => {
    const sb = makeSandbox();
    expect(runSetup(sb, ["--yes"]).exitCode).toBe(0);
    const manifest = readManifest(sb);
    manifest.entries.push({ path: "mcp:lore", kind: "mcp", sha256: "abc", written_at: "2026-01-01T00:00:00.000Z", ownership: "managed" });
    writeFileSync(join(sb.claudeDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`);
    const result = runSetup(sb, ["--yes"]);
    expect(result.exitCode).toBe(0);
    expect(claudeCalls(sb)).toBe("");
    expect(readManifest(sb).entries.some((e) => e.kind === "mcp")).toBe(false);
  });

  it("AC-RMCP-2: an install that fails part-way writes no mcp entry and calls no claude", () => {
    const sb = makeSandbox();
    // A regular FILE where the installer needs the `agents` directory makes the write phase fail.
    writeFileSync(join(sb.claudeDir, "agents"), "not a directory");
    const result = runSetup(sb, ["--yes"]);
    expect(result.exitCode).not.toBe(0);
    expect(claudeCalls(sb)).toBe("");
    const manifestPath = join(sb.claudeDir, MANIFEST_FILENAME);
    if (existsSync(manifestPath)) expect(readManifest(sb).entries.some((e) => e.kind === "mcp")).toBe(false);
  });

  it("AC-RMCP-2: a global uninstall over a manifest holding an mcp entry exits 0 without calling claude", () => {
    const sb = makeSandbox();
    expect(runSetup(sb, ["--yes"]).exitCode).toBe(0);
    const manifest = readManifest(sb);
    manifest.entries.push({ path: "mcp:lore", kind: "mcp", sha256: "abc", written_at: "2026-01-01T00:00:00.000Z", ownership: "managed" });
    writeFileSync(join(sb.claudeDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`);
    const result = runSetup(sb, ["--uninstall", "--yes"]);
    expect(result.exitCode).toBe(0);
    expect(claudeCalls(sb)).toBe("");
    expect(existsSync(join(sb.claudeDir, MANIFEST_FILENAME))).toBe(false);
  });
});
