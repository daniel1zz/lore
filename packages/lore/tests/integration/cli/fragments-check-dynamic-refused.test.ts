// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore fragments check` and old-format (audience / mode / delivery) fragments.
 * Superseded: AC-UR-4 (a dynamic main-session fragment is refused with finding `dynamic_main`) - the `mode` field
 * no longer exists (spec-fragment-injection-timing-one-inject-enum-a-per-turn). The kept property: `check`
 * refuses a fragment that cannot reach a session, exit 4 with the fragment named on stderr and in the JSON
 * report, instead of letting it fail silently. Now that is an old-format file, refused naming the migration command.
 * Real CLI via subprocess in a throwaway `mkdtemp` project.
 *
 * Coverage:
 *   NEGATIVE:   old-format (audience/mode) fragment -> exit 4, path and `lore migrate fragments` on stderr and in the JSON findings
 *   HAPPY:      control - the same project without the fragment -> exit 0
 *   BOUNDARY:   a helper-only inject fragment is NOT refused; a launch fragment is NOT refused
 *
 * @spec_ref AC-IT-1
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const BUN_BIN = execSync("command -v bun", { encoding: "utf8" }).trim();

const FRAGMENT_ID = "ur4-old-format";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface CheckReport {
  ok: boolean;
  data: { ok: boolean; findings: { kind: string; code: string; message: string }[] };
}

let sandbox: string;

function runCheck(project: string, extra: string[] = []): RunResult {
  const result = spawnSync(BUN_BIN, ["run", INDEX_TS, "fragments", "check", ...extra], {
    cwd: project,
    env: {
      ...process.env,
      HOME: join(sandbox, "home"),
      XDG_CONFIG_HOME: join(sandbox, "xdg"),
      LORE_CONFIG_HOME: join(sandbox, "lore-config"),
      CLAUDE_CONFIG_DIR: join(sandbox, "claude"),
    },
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function makeProject(fragmentFrontmatter?: string): string {
  const project = mkdtempSync(join(sandbox, "project-"));
  const dir = join(project, ".lore", "context");
  mkdirSync(dir, { recursive: true });
  if (fragmentFrontmatter !== undefined) {
    writeFileSync(
      join(dir, `${FRAGMENT_ID}.md`),
      `---\nid: ${FRAGMENT_ID}\ntitle: ur4 probe\n${fragmentFrontmatter}\n---\nProbe body.\n`,
      "utf8",
    );
  }
  return project;
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "lore-ur4-"));
  for (const dir of ["home", "xdg", "lore-config", "claude"]) mkdirSync(join(sandbox, dir), { recursive: true });
}, 60_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("fragments check refuses an old-format fragment naming the migration command", () => {
  it("N1: a project fragment with audience and mode exits 4 naming the file and `lore migrate fragments` on stderr and in the JSON report", () => {
    const project = makeProject("audience: [main]\nmode: dynamic");

    const human = runCheck(project);
    expect(human.exitCode).toBe(4);
    expect(human.stderr).toContain(`${FRAGMENT_ID}.md`);
    expect(human.stderr).toContain("lore migrate fragments");

    const json = runCheck(project, ["--json"]);
    expect(json.exitCode).toBe(4);
    const report = JSON.parse(json.stdout) as CheckReport;
    expect(report.ok).toBe(false);
    const hits = report.data.findings.filter((f) => f.message.includes(`${FRAGMENT_ID}.md`));
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.code).toBe("VALIDATION_ERROR");
    expect(hits[0]?.kind).toBe("discovery");
    expect(hits[0]?.message).toContain("lore migrate fragments");
  });

  it("H1: control — the same project without the fragment exits 0", () => {
    const project = makeProject();
    const run = runCheck(project);
    expect(run.exitCode).toBe(0);
    expect(run.stderr).not.toContain(FRAGMENT_ID);
  });

  it("B1: a helper-only inject fragment is not refused", () => {
    const project = makeProject("inject: [subagent-start]");
    const run = runCheck(project);
    expect(run.exitCode).toBe(0);
  });

  it("B2: a launch fragment is not a retired-field finding (it lands in a rules file)", () => {
    const project = makeProject("inject: [launch]");
    const run = runCheck(project, ["--json"]);
    const report = JSON.parse(run.stdout) as CheckReport;
    expect(report.data.findings.filter((f) => f.kind === "discovery")).toEqual([]);
  });
});
