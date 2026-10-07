/**
 * RED integration tests for the adoption mode on `lore status --check-claude-md`
 * (spec-claude-md-root-section-structure-check-and-adoption-mode, AC-STR-2;
 * task-skill-test-structure-check-cli-adoption-surface-red).
 *
 * Every fixture is a throwaway mkdtemp repo with a config-only `.lore/` (no DB,
 * never this repo's corpus). The CLI is the real `src/index.ts`, no mocks.
 * Enforce-side cases write `adoption: enforce` EXPLICITLY (absent key = warn)
 * and assert `adoption.mode === "enforce"` in the JSON so a fixture that lost
 * its config cannot pass vacuously.
 *
 * At the authoring base there is no structure check and no `adoption` block, so
 * every scenario fails on an assertion (exit 0 instead of 3, missing
 * `adoption` JSON, no WARN line).
 *
 * @spec_ref AC-STR-2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

const ALL_SECTIONS = [
  "What This Is",
  "Commands",
  "Architecture",
  "Module Index",
  "Finding Live Project State",
] as const;

function rootFile(sections: readonly string[], extraLines = 0): string {
  const body = sections.map((s) => `## ${s}\n\nbody of ${s}\n`).join("\n");
  const filler: string[] = [];
  for (let i = 1; i <= extraLines; i++) {
    filler.push(`Filler line ${i}: standing discipline entry.`);
  }
  return `# Project\n\n${body}\n${filler.join("\n")}\n`;
}

interface AdvisoryJson {
  kind: string;
  downgraded_kind?: string;
  path?: string;
  reference?: string;
}
interface CheckJson {
  data?: {
    claude_md?: {
      findings?: Array<{ kind: string; reference?: string; path: string; message: string }>;
      advisory?: AdvisoryJson[];
      adoption?: {
        mode?: string;
        mode_source?: string;
        downgraded_count?: number;
        promotable?: boolean;
      };
    };
  };
}

function writeFixture(dir: string, claudeMd: string, adoption: "enforce" | "warn" | null): void {
  mkdirSync(join(dir, ".lore"), { recursive: true });
  const yaml =
    adoption === null
      ? "context:\n  memory_files:\n    enabled: true\n"
      : `context:\n  memory_files:\n    enabled: true\n    adoption: ${adoption}\n`;
  writeFileSync(join(dir, ".lore", "config.yaml"), yaml);
  writeFileSync(join(dir, "CLAUDE.md"), claudeMd);
}

function check(dir: string): { run: RunResult; json: CheckJson } {
  const run = runLore(["status", "--check-claude-md", "--json"], dir);
  let json: CheckJson = {};
  try {
    json = JSON.parse(run.stdout) as CheckJson;
  } catch {
    // leave empty: assertions on the parsed shape then fail loudly
  }
  return { run, json };
}

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-status-adoption-"));
});
afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

const MISSING_COMMANDS = ALL_SECTIONS.filter((s) => s !== "Commands");

describe("status --check-claude-md under adoption: enforce", () => {
  it("missing '## Commands' exits EXACTLY 3", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), "enforce");
    const { run } = check(tmpDir);
    expect(run.exitCode).toBe(3);
  });

  it("missing '## Commands' reports a deterministic section_missing finding for 'Commands'", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), "enforce");
    const { json } = check(tmpDir);
    const f = (json.data?.claude_md?.findings ?? []).find((x) => x.kind === "section_missing");
    expect(f?.reference).toBe("Commands");
  });

  it("JSON reports adoption.mode === 'enforce' (fixture is not vacuous)", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), "enforce");
    const { json } = check(tmpDir);
    expect(json.data?.claude_md?.adoption?.mode).toBe("enforce");
  });

  it("JSON reports mode_source 'config' when the key is written", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), "enforce");
    const { json } = check(tmpDir);
    expect(json.data?.claude_md?.adoption?.mode_source).toBe("config");
  });

  it("HUMAN output names section_missing and Commands", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), "enforce");
    const run = runLore(["status", "--check-claude-md"], tmpDir);
    const out = run.stdout + run.stderr;
    expect(out).toContain("section_missing");
    expect(out).toContain("Commands");
  });

  it("a different missing section ('Architecture') is named, not Commands (defeats hardcoded output)", () => {
    writeFixture(tmpDir, rootFile(ALL_SECTIONS.filter((s) => s !== "Architecture")), "enforce");
    const { run, json } = check(tmpDir);
    expect(run.exitCode).toBe(3);
    const refs = (json.data?.claude_md?.findings ?? [])
      .filter((x) => x.kind === "section_missing")
      .map((x) => x.reference);
    expect(refs).toEqual(["Architecture"]);
  });

  it("a conforming root file exits 0 with mode enforce and zero downgraded", () => {
    writeFixture(tmpDir, rootFile(ALL_SECTIONS), "enforce");
    const { run, json } = check(tmpDir);
    expect(run.exitCode).toBe(0);
    expect(json.data?.claude_md?.adoption?.mode).toBe("enforce");
    expect(json.data?.claude_md?.adoption?.downgraded_count).toBe(0);
  });
});

describe("status --check-claude-md under adoption: warn", () => {
  it("same missing-Commands fixture exits 0", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), "warn");
    const { run } = check(tmpDir);
    expect(run.exitCode).toBe(0);
  });

  it("HUMAN output has a line starting 'WARN adoption=warn'", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), "warn");
    const run = runLore(["status", "--check-claude-md"], tmpDir);
    const lines = (run.stdout + "\n" + run.stderr).split("\n");
    expect(lines.some((l) => l.startsWith("WARN adoption=warn"))).toBe(true);
  });

  it("JSON adoption.mode is 'warn' and downgraded_count is exactly 1", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), "warn");
    const { json } = check(tmpDir);
    expect(json.data?.claude_md?.adoption?.mode).toBe("warn");
    expect(json.data?.claude_md?.adoption?.downgraded_count).toBe(1);
  });

  it("advisory carries a 'downgraded' finding with downgraded_kind 'section_missing'", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), "warn");
    const { json } = check(tmpDir);
    const d = (json.data?.claude_md?.advisory ?? []).find((a) => a.kind === "downgraded");
    expect(d?.downgraded_kind).toBe("section_missing");
  });

  it("section_missing moves from deterministic findings to advisory (present there, absent here)", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), "warn");
    const { json } = check(tmpDir);
    const detKinds = (json.data?.claude_md?.findings ?? []).map((f) => f.kind);
    const advKinds = (json.data?.claude_md?.advisory ?? []).map((a) => a.downgraded_kind);
    expect(detKinds).not.toContain("section_missing");
    expect(advKinds).toContain("section_missing");
  });

  it("two missing sections -> downgraded_count 2 (count tracks reality)", () => {
    writeFixture(
      tmpDir,
      rootFile(ALL_SECTIONS.filter((s) => s !== "Commands" && s !== "Architecture")),
      "warn",
    );
    const { json } = check(tmpDir);
    expect(json.data?.claude_md?.adoption?.downgraded_count).toBe(2);
  });

  it("over-ceiling root file (400 lines, all sections present) exits 0 and downgrades max_lines", () => {
    writeFixture(tmpDir, rootFile(ALL_SECTIONS, 400), "warn");
    const { run, json } = check(tmpDir);
    expect(run.exitCode).toBe(0);
    const kinds = (json.data?.claude_md?.advisory ?? [])
      .filter((a) => a.kind === "downgraded")
      .map((a) => a.downgraded_kind);
    expect(kinds).toContain("max_lines");
  });

  it("the same over-ceiling file under enforce still exits 3 (warn is the only difference)", () => {
    writeFixture(tmpDir, rootFile(ALL_SECTIONS, 400), "enforce");
    const { run, json } = check(tmpDir);
    expect(run.exitCode).toBe(3);
    expect(json.data?.claude_md?.adoption?.mode).toBe("enforce");
  });

  it("warn + conforming file -> promotable true, downgraded_count 0", () => {
    writeFixture(tmpDir, rootFile(ALL_SECTIONS), "warn");
    const { json } = check(tmpDir);
    expect(json.data?.claude_md?.adoption?.promotable).toBe(true);
    expect(json.data?.claude_md?.adoption?.downgraded_count).toBe(0);
  });

  it("warn + failing file -> promotable false", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), "warn");
    const { json } = check(tmpDir);
    expect(json.data?.claude_md?.adoption?.promotable).toBe(false);
  });

  it("warn + conforming file still prints the WARN adoption line (visibility until promoted)", () => {
    writeFixture(tmpDir, rootFile(ALL_SECTIONS), "warn");
    const run = runLore(["status", "--check-claude-md"], tmpDir);
    const lines = (run.stdout + "\n" + run.stderr).split("\n");
    expect(lines.some((l) => l.startsWith("WARN adoption=warn"))).toBe(true);
  });
});

describe("status --check-claude-md with NO adoption key", () => {
  it("resolves to mode 'warn' with mode_source 'default'", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), null);
    const { json } = check(tmpDir);
    expect(json.data?.claude_md?.adoption?.mode).toBe("warn");
    expect(json.data?.claude_md?.adoption?.mode_source).toBe("default");
  });

  it("missing section under the default exits 0 (never red on day one)", () => {
    writeFixture(tmpDir, rootFile(MISSING_COMMANDS), null);
    const { run } = check(tmpDir);
    expect(run.exitCode).toBe(0);
  });
});
