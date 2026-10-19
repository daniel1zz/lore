// @spawns packages/lore/src/index.ts
// @reads assets/context/**
/**
 * task-integrate-adr-and-dispatch-rule-name-the-configured-floor
 *
 * The shipped worktree-dispatch rule names the floor `lore integrate` runs by READING
 * `workflow.integrate.floor_command` from the project config, never a script name typed into the asset.
 * Spawned CLI = the SOURCE entry with HOME=<mkdtemp>; the repo's own `.lore/` is never written.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const LORE_SRC_ENTRY = join(HERE, "../../../src/index.ts");
const SHIPPED_FRAGMENT = join(HERE, "../../../../../assets/context/worktree-dispatch.md");
const SPAWN_TIMEOUT_MS = 60_000;
const NOT_CONFIGURED = "no floor is configured";

const ROOT_CLAUDE_MD =
  "# P\n\n" +
  ["What This Is", "Commands", "Architecture", "Module Index", "Finding Live Project State"]
    .map((heading) => `## ${heading}\n\nshort\n`)
    .join("\n");

const sandboxes: string[] = [];
afterAll(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

interface Sandbox {
  repo: string;
  home: string;
}

function run(sb: Sandbox, ...args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env, HOME: sb.home };
  for (const key of ["XDG_CONFIG_HOME", "LORE_CONFIG_HOME", "CLAUDE_CONFIG_DIR"]) delete env[key];
  return spawnSync("bun", [LORE_SRC_ENTRY, ...args], { cwd: sb.repo, env, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS });
}

function makeSandbox(floorCommand: string | null): Sandbox {
  const sb: Sandbox = {
    repo: mkdtempSync(join(tmpdir(), "lore-floor-repo-")),
    home: mkdtempSync(join(tmpdir(), "lore-floor-home-")),
  };
  sandboxes.push(sb.repo, sb.home);
  const init = run(sb, "init");
  if (init.status !== 0) throw new Error(`lore init failed (${String(init.status)}): ${init.stderr}`);
  writeFileSync(join(sb.repo, "CLAUDE.md"), ROOT_CLAUDE_MD);
  if (floorCommand !== null) {
    appendFileSync(
      join(sb.repo, ".lore", "config.yaml"),
      `\nworkflow:\n  integrate:\n    floor_command: ${JSON.stringify(floorCommand)}\n`,
    );
  }
  const refresh = run(sb, "context", "refresh");
  if (refresh.status !== 0) throw new Error(`context refresh failed (${String(refresh.status)}): ${refresh.stderr}`);
  return sb;
}

function dispatchRule(sb: Sandbox): string {
  return readFileSync(join(sb.repo, ".claude", "rules", "lore-worktree-dispatch.md"), "utf8");
}

describe("the dispatch rule names the configured integrate floor", () => {
  it("HAPPY: a project whose floor_command is X gets X in the rendered rule, and no hard-coded script name", () => {
    const floor = "make verify-everything && ./ci/extra-gate.sh";
    const rule = dispatchRule(makeSandbox(floor));
    expect(rule).toContain(`\`${floor}\``);
    expect(rule).not.toContain("check:static");
    expect(rule).not.toContain("{{lore:");
    expect(rule).not.toContain(NOT_CONFIGURED);
  });

  it("NEGATIVE: a project with no floor configured is told so, never given a made-up default", () => {
    const rule = dispatchRule(makeSandbox(null));
    expect(rule).toContain(NOT_CONFIGURED);
    expect(rule).not.toContain("check:static");
    expect(rule).not.toContain("check:floor");
  });

  it("REGRESSION: the shipped fragment source types no script name of this repository", () => {
    const source = readFileSync(SHIPPED_FRAGMENT, "utf8");
    expect(source).not.toContain("check:static");
    expect(source).toContain("{{lore:integrate_floor}}");
  });
});
