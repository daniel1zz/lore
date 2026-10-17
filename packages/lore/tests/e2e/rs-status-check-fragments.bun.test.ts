// @spawns dist/lore
/**
 * Compiled-binary e2e for `lore status --check-fragments`
 * (spec-rule-store-git-tracked-fragment-selection-on-demand-skill, Scope 7 status bullet,
 * AC-RS-9, BR-1066; task task-rs-t11-lore-status-check-fragments).
 *
 * Contract: `lore status --check-fragments` runs the SAME fragments check as `lore fragments check`
 * and exits 4 when any finding is present, 0 on a clean fixture.
 *
 * The fixture is built here (a mkdtemp HOME + XDG + `lore init` corpus) and does not depend on any
 * other e2e file. A cross-layer duplicate line = one fragment in the user layer and one in the
 * project layer carrying the same line, both read by the `main` session.
 *
 * Isolation: never touches the repo's own `.lore/` or the real HOME.
 *
 * @spec_ref spec-rule-store-git-tracked-fragment-selection-on-demand-skill AC-RS-9
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const CHECK_FAILED_EXIT = 4;

interface Sandbox {
  readonly root: string;
  readonly corpus: string;
  readonly userContextDir: string;
  readonly projectContextDir: string;
  readonly env: Record<string, string>;
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const sandboxRoots: string[] = [];
afterAll(() => {
  for (const root of sandboxRoots) rmSync(root, { recursive: true, force: true });
});

function lore(sb: Sandbox, ...args: string[]): Run {
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd: sb.corpus, env: sb.env });
  return { code: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function makeSandbox(): Sandbox {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-rs-status-frag-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  sandboxRoots.push(root);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  const corpus = join(root, "corpus");
  for (const d of [home, xdg, corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME", "LORE_AI_DEFAULT", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
    delete env[k];
  }
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = xdg;
  env["CLAUDECODE"] = "1";
  const sb: Sandbox = {
    root,
    corpus,
    userContextDir: join(xdg, "lore", "context"),
    projectContextDir: join(corpus, ".lore", "context"),
    env,
  };
  const init = lore(sb, "init");
  if (init.code !== 0) throw new Error(`harness: lore init failed in fixture setup: ${init.stderr}`);
  return sb;
}

function writeDynamicHelperFragment(dir: string, id: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  const front = ["---", `id: ${id}`, `title: fixture ${id}`, 'audience: ["subagent:*"]', "mode: dynamic", "---", ""].join("\n");
  writeFileSync(join(dir, `${id}.md`), `${front}${body}\n`, "utf8");
}

const DUPLICATED_LINE = "Always run the fixture linter before committing.";

describe("AC-RS-9 lore status --check-fragments", () => {
  it("cross-layer duplicate line: exits 4 and reports the same duplicate_line finding as `lore fragments check`", () => {
    const sb = makeSandbox();
    writeDynamicHelperFragment(sb.userContextDir, "fixture-user-rule", DUPLICATED_LINE);
    writeDynamicHelperFragment(sb.projectContextDir, "fixture-project-rule", DUPLICATED_LINE);

    const direct = lore(sb, "fragments", "check");
    // Liveness control: the fixture really is a finding for the reference command, so the status
    // assertions below cannot pass vacuously.
    expect(direct.code).toBe(CHECK_FAILED_EXIT);
    const directLine = direct.stderr.split("\n").find((l) => l.startsWith("[duplicate_line]"));
    expect(directLine).toBeDefined();
    expect(directLine).toContain(DUPLICATED_LINE);

    const status = lore(sb, "status", "--check-fragments");
    expect(status.code).toBe(CHECK_FAILED_EXIT);
    const statusLine = status.stderr.split("\n").find((l) => l.startsWith("[duplicate_line]"));
    expect(statusLine).toBe(directLine);
  });

  it("--json carries the duplicate_line finding in the same report shape as `lore fragments check --json`", () => {
    const sb = makeSandbox();
    writeDynamicHelperFragment(sb.userContextDir, "fixture-user-rule", DUPLICATED_LINE);
    writeDynamicHelperFragment(sb.projectContextDir, "fixture-project-rule", DUPLICATED_LINE);

    const direct = lore(sb, "fragments", "check", "--json");
    const status = lore(sb, "status", "--check-fragments", "--json");
    expect(status.code).toBe(CHECK_FAILED_EXIT);
    const directReport = JSON.parse(direct.stdout) as { ok: boolean; data: { findings: { kind: string }[] } };
    const statusReport = JSON.parse(status.stdout) as { ok: boolean; data: { findings: { kind: string }[] } };
    expect(statusReport.ok).toBe(false);
    expect(statusReport.data.findings.map((f) => f.kind)).toContain("duplicate_line");
    expect(statusReport.data.findings).toEqual(directReport.data.findings);
  });

  it("clean fixture: exits 0 (and `lore fragments check` agrees)", () => {
    const sb = makeSandbox();
    writeDynamicHelperFragment(sb.userContextDir, "fixture-user-rule", "Fixture user line one.");
    writeDynamicHelperFragment(sb.projectContextDir, "fixture-project-rule", "Fixture project line two.");

    const direct = lore(sb, "fragments", "check");
    expect(direct.code).toBe(0);
    const status = lore(sb, "status", "--check-fragments");
    expect(status.code).toBe(0);
    expect(status.stderr).not.toContain("[duplicate_line]");
  });
});
