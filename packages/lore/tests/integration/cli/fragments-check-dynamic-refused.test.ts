/**
 * Integration tests for `lore fragments check` refusing a dynamic main-session fragment
 * (spec-one-upgrade-reminder-at-session-start-covers-the-global, AC-UR-4; BR-1066 modified).
 * With the `hook:session-start` outlet retired, a `mode: dynamic` + `audience: main` fragment reaches
 * no outlet; `check` must say so (exit 4, fragment id on stderr and in the JSON report) rather than
 * let it fail silently. Real CLI via subprocess in a throwaway `mkdtemp` project.
 *
 * Coverage:
 *   NEGATIVE:   dynamic + main fragment -> exit 4, id on stderr and in the JSON findings
 *   HAPPY:      control — the same project without the fragment -> exit 0
 *   BOUNDARY:   a dynamic fragment whose audience is a helper (subagent:*) is NOT refused
 *   BOUNDARY:   a static main fragment is NOT refused
 *
 * @spec_ref AC-UR-4
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const BUN_BIN = execSync("command -v bun", { encoding: "utf8" }).trim();

const FRAGMENT_ID = "ur4-dynamic-main";

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

function makeProject(fragment?: { mode: "static" | "dynamic"; audience: string }): string {
  const project = mkdtempSync(join(sandbox, "project-"));
  const dir = join(project, ".lore", "context");
  mkdirSync(dir, { recursive: true });
  if (fragment !== undefined) {
    writeFileSync(
      join(dir, `${FRAGMENT_ID}.md`),
      `---\nid: ${FRAGMENT_ID}\ntitle: ur4 probe\naudience: ["${fragment.audience}"]\nmode: ${fragment.mode}\n---\nProbe body.\n`,
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

describe("fragments check refuses a dynamic main-session fragment (AC-UR-4)", () => {
  it("AC-UR-4.N1: a project fragment with mode: dynamic and audience: main exits 4 naming the id on stderr and in the JSON report", () => {
    const project = makeProject({ mode: "dynamic", audience: "main" });

    const human = runCheck(project);
    expect(human.exitCode).toBe(4);
    expect(human.stderr).toContain(FRAGMENT_ID);

    const json = runCheck(project, ["--json"]);
    expect(json.exitCode).toBe(4);
    const report = JSON.parse(json.stdout) as CheckReport;
    expect(report.ok).toBe(false);
    const hits = report.data.findings.filter((f) => f.message.includes(FRAGMENT_ID));
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.code).toBe("VALIDATION_ERROR");
    expect(hits[0]?.kind).toBe("dynamic_main");
  });

  it("AC-UR-4.H1: control — the same project without the fragment exits 0", () => {
    const project = makeProject();
    const run = runCheck(project);
    expect(run.exitCode).toBe(0);
    expect(run.stderr).not.toContain(FRAGMENT_ID);
  });

  it("AC-UR-4.B1: a dynamic fragment for a helper audience is not refused", () => {
    const project = makeProject({ mode: "dynamic", audience: "subagent:*" });
    const run = runCheck(project);
    expect(run.exitCode).toBe(0);
  });

  it("AC-UR-4.B2: a static main fragment is not refused (it lands in a rules file)", () => {
    const project = makeProject({ mode: "static", audience: "main" });
    const run = runCheck(project, ["--json"]);
    const report = JSON.parse(run.stdout) as CheckReport;
    expect(report.data.findings.filter((f) => f.kind === "dynamic_main")).toEqual([]);
  });
});
