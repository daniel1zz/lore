// @spawns packages/lore/src/index.ts
/**
 * task-memory-file-limits-are-always-enforced-the-warn-adoption: memory-file limits are always enforced, the
 * `context.memory_files.adoption` setting is retired, and `lore migrate memory-limits` is the one-time upgrade.
 *
 * Every scenario spawns the real CLI against a `mkdtemp` fixture (the repo's own `.lore/` is never touched):
 *   (a) NEGATIVE/REGRESSION: a root memory file over its line ceiling with NO adoption setting fails
 *       `lore context refresh` with exit 4 (the falsifier: the retired default `warn` wrote it and exited 0);
 *       `lore status --check-claude-md` reports the finding as enforced (exit 3, never `downgraded`).
 *   (b) HAPPY/STATE/BOUNDARY: `lore migrate memory-limits` previews (writes nothing), `--apply` removes only the
 *       retired line (every other byte kept) and lists what a person must fix, and a second `--apply` changes nothing.
 *   (c) NEGATIVE: a config still naming the setting is refused by every command with exit 4 and the exact text
 *       naming the migrate action; nothing is written by the refusal.
 *
 * @spec_ref spec-claude-md-root-section-structure-check-and-adoption-mode
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

const REFUSAL =
  "context.memory_files.adoption was retired: memory-file limits are always enforced. " +
  "Run `lore migrate memory-limits --apply` to remove it from .lore/config.yaml and list the memory-file findings a person must fix.";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1", LORE_ACTOR: "agent:memory-limits-test" },
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

let dir = "";
/** The config `lore init` wrote, trailing whitespace trimmed: every scenario appends to it. */
let base = "";
const configPath = (): string => join(dir, ".lore", "config.yaml");
const claudePath = (): string => join(dir, "CLAUDE.md");

/** A root memory file well over the 300-line shipped ceiling. */
const OVERSIZED = `${Array.from({ length: 500 }, (_, i) => `line ${String(i)}`).join("\n")}\n`;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "memlimits-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, stdio: "ignore" });
  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}${init.stdout}`);
  base = readFileSync(configPath(), "utf8").trimEnd();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("limits are always enforced (AC a)", () => {
  it("NEGATIVE: an over-ceiling root file with no adoption setting fails `context refresh` with exit 4 and is left unchanged", () => {
    const init = runLore(["context", "init"], dir);
    expect(init.exitCode, init.stderr).toBe(0);
    const grown = `${readFileSync(claudePath(), "utf8")}\n${OVERSIZED}`;
    writeFileSync(claudePath(), grown);

    const refresh = runLore(["context", "refresh"], dir);

    expect(refresh.exitCode).toBe(4);
    expect(refresh.stderr).toContain("breaches its ceiling");
    expect(readFileSync(claudePath(), "utf8")).toBe(grown);
  });

  it("REGRESSION: `status --check-claude-md` reports the breach as an enforced finding (exit 3), never downgraded", () => {
    writeFileSync(claudePath(), OVERSIZED);

    const check = runLore(["status", "--check-claude-md", "--json"], dir);

    expect(check.exitCode).toBe(3);
    expect(check.stdout).toContain('"max_lines"');
    expect(check.stdout).not.toContain("downgraded");
    expect(check.stdout).not.toContain("adoption");
  });

  it("BOUNDARY: a conforming root file passes `status --check-claude-md` with exit 0 and no setting", () => {
    const init = runLore(["context", "init"], dir);
    expect(init.exitCode, init.stderr).toBe(0);

    expect(runLore(["status", "--check-claude-md"], dir).exitCode).toBe(0);
  });
});

describe("a config still naming the retired setting is refused by every command (AC c)", () => {
  const oldText = (value: string): string => `${base}\ncontext:\n  memory_files:\n    adoption: ${value}\n`;

  it("NEGATIVE: status, list, bootstrap and context refresh each exit 4 with the exact text and write nothing, for either value", () => {
    for (const value of ["warn", "enforce"]) {
      const text = oldText(value);
      writeFileSync(configPath(), text);
      for (const args of [["status"], ["list"], ["bootstrap"], ["context", "refresh", "--check"]]) {
        const r = runLore(args, dir);
        expect(r.exitCode, `${args.join(" ")} with adoption: ${value}`).toBe(4);
        expect(r.stderr).toContain(REFUSAL);
      }
      expect(readFileSync(configPath(), "utf8")).toBe(text);
    }
  });
});

describe("lore migrate memory-limits (AC b)", () => {
  const TAIL = 'audit:\n  verify_since: "2026-07-06T12:02:00Z"\n';
  const head = (): string => `# keep me\n${base}\ncontext:\n  memory_files:\n    root:\n      max_lines: 400\n`;
  const oldText = (): string => `${head()}    adoption: warn # old\n${TAIL}`;
  const newText = (): string => `${head()}${TAIL}`;

  it("HAPPY+STATE: preview writes nothing; --apply removes only the retired line; a second --apply changes nothing", () => {
    writeFileSync(configPath(), oldText());

    const preview = runLore(["migrate", "memory-limits"], dir);
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain("Memory limits migration (preview)");
    expect(preview.stdout).toContain(`${configPath()}: context.memory_files.adoption: warn would be removed`);
    expect(preview.stdout).toContain("Re-run with --apply to execute.");
    expect(readFileSync(configPath(), "utf8")).toBe(oldText());

    const applied = runLore(["migrate", "memory-limits", "--apply"], dir);
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain("Memory limits migration complete");
    expect(applied.stdout).toContain(`${configPath()}: context.memory_files.adoption: warn removed`);
    expect(readFileSync(configPath(), "utf8")).toBe(newText());

    const again = runLore(["migrate", "memory-limits", "--apply"], dir);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain(`${configPath()}: no adoption setting`);
    expect(readFileSync(configPath(), "utf8")).toBe(newText());

    expect(runLore(["status"], dir).exitCode).toBe(0);
  });

  it("STATE: a setting that is the only key under context.memory_files removes the emptied parents too", () => {
    writeFileSync(configPath(), `${base}\ncontext:\n  memory_files:\n    adoption: enforce\n`);

    expect(runLore(["migrate", "memory-limits", "--apply"], dir).exitCode).toBe(0);

    expect(readFileSync(configPath(), "utf8")).toBe(`${base}\n`);
    expect(runLore(["status"], dir).exitCode).toBe(0);
  });

  it("ERROR: a flow-style mapping that cannot be edited line-wise is refused with exit 4 and nothing written", () => {
    const flow = `${base}\ncontext:\n  memory_files: { adoption: warn, enabled: true }\n`;
    writeFileSync(configPath(), flow);

    const r = runLore(["migrate", "memory-limits", "--apply"], dir);

    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("delete it by hand");
    expect(readFileSync(configPath(), "utf8")).toBe(flow);
  });

  it("HAPPY: lists the memory-file findings a person must fix and leaves the memory file untouched", () => {
    writeFileSync(configPath(), oldText());
    writeFileSync(claudePath(), OVERSIZED);

    const preview = runLore(["migrate", "memory-limits"], dir);

    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain("CLAUDE.md: a person must fix");
    expect(preview.stdout).toContain("[max_lines]");
    expect(readFileSync(claudePath(), "utf8")).toBe(OVERSIZED);
  });

  it("BOUNDARY: a config without the setting reports nothing to do and writes nothing", () => {
    writeFileSync(configPath(), newText());

    const r = runLore(["migrate", "memory-limits", "--apply"], dir);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("no adoption setting");
    expect(readFileSync(configPath(), "utf8")).toBe(newText());
  });
});
