/**
 * Integration tests for the retired `hook:session-start` outlet (spec-one-upgrade-reminder-at-session-
 * start-covers-the-global, AC-UR-3; BR-912 / BR-907 modified). Real CLI via subprocess in a throwaway
 * `mkdtemp` project — never the real `~/.claude`, never this repo's `.lore/`.
 *
 * Coverage:
 *   NEGATIVE:   `render --outlet hook:session-start` -> exit 2, stderr names the target as retired
 *   HAPPY:      `render --outlet hook:subagent-start --agent-type lore-implementer` -> exit 0 + SubagentStart JSON
 *   BOUNDARY:   helper-start text exactly at its limit passes; one char over is reported over limit
 *   REGRESSION: the retired target is refused before any project read (works with no .lore/ at all)
 *
 * @spec_ref AC-UR-3
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SUBAGENT_FRAGMENT_CAP } from "@lore/core";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const BUN_BIN = execSync("command -v bun", { encoding: "utf8" }).trim();

const FRAGMENT_ID = "ur3-boundary-probe";
const AGENT_TYPE = "lore-implementer";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let sandbox: string;
let project: string;

function runFragments(args: string[], cwd: string = project): RunResult {
  const result = spawnSync(BUN_BIN, ["run", INDEX_TS, "fragments", ...args], {
    cwd,
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

/** Write the probe fragment (a helper-audience fragment for AGENT_TYPE) with a body of `chars` characters. */
function writeProbe(chars: number): void {
  const dir = join(project, ".lore", "context");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${FRAGMENT_ID}.md`),
    `---\nid: ${FRAGMENT_ID}\ntitle: ur3 boundary probe\naudience: ["subagent:${AGENT_TYPE}"]\nmode: static\n---\n${"x".repeat(chars)}`,
    "utf8",
  );
}

function additionalContext(run: RunResult): string {
  const parsed = JSON.parse(run.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  return parsed.hookSpecificOutput.additionalContext;
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "lore-ur3-"));
  for (const dir of ["home", "xdg", "lore-config", "claude"]) mkdirSync(join(sandbox, dir), { recursive: true });
  project = join(sandbox, "project");
  mkdirSync(join(project, ".lore"), { recursive: true });
}, 60_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("hook:session-start outlet is retired (AC-UR-3)", () => {
  it("AC-UR-3.N1: render --outlet hook:session-start exits 2 and stderr names it as retired", () => {
    const run = runFragments(["render", "--outlet", "hook:session-start"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("hook:session-start");
    expect(run.stderr).toMatch(/retired/i);
    expect(run.stdout).toBe("");
  });

  it("AC-UR-3.H1: render --outlet hook:subagent-start --agent-type lore-implementer exits 0 with SubagentStart JSON", () => {
    const run = runFragments(["render", "--outlet", "hook:subagent-start", "--agent-type", AGENT_TYPE]);
    expect(run.exitCode).toBe(0);
    const parsed = JSON.parse(run.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SubagentStart");
    expect(parsed.hookSpecificOutput.additionalContext.length).toBeGreaterThan(0);
  });

  it("AC-UR-3.B1: helper-start text exactly at its limit passes; one character over is reported over limit", () => {
    // Calibrate: the rest of the block (shipped fragments + separator) is whatever the render says it is,
    // so measure it with a 1-char probe instead of hard-coding a number.
    writeProbe(1);
    const base = additionalContext(runFragments(["render", "--outlet", "hook:subagent-start", "--agent-type", AGENT_TYPE])).length;
    const atLimit = SUBAGENT_FRAGMENT_CAP - base + 1;
    expect(atLimit).toBeGreaterThan(1);

    writeProbe(atLimit);
    const exact = runFragments(["render", "--outlet", "hook:subagent-start", "--agent-type", AGENT_TYPE]);
    expect(exact.exitCode).toBe(0);
    expect(exact.stderr).not.toContain("BUDGET_EXCEEDED");
    const exactText = additionalContext(exact);
    expect(exactText.length).toBe(SUBAGENT_FRAGMENT_CAP);
    expect(exactText).toContain("x".repeat(atLimit));

    writeProbe(atLimit + 1);
    const over = runFragments(["render", "--outlet", "hook:subagent-start", "--agent-type", AGENT_TYPE]);
    expect(over.exitCode).toBe(0); // D12: a hook never blocks start; the overflow is reported, not thrown
    expect(over.stderr).toContain("BUDGET_EXCEEDED");
    expect(over.stderr).toContain(`${SUBAGENT_FRAGMENT_CAP + 1} chars`);
    expect(additionalContext(over)).toContain("BUDGET_EXCEEDED");
    expect(additionalContext(over)).not.toContain("x".repeat(atLimit));
  }, 60_000);

  it("AC-UR-3.R1: the retired target is refused even outside any lore project (no project read needed)", () => {
    const bare = mkdtempSync(join(sandbox, "bare-"));
    const run = runFragments(["render", "--outlet", "hook:session-start"], bare);
    expect(run.exitCode).toBe(2);
    expect(run.stderr).toMatch(/retired/i);
  });
});
