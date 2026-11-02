// @spawns dist/lore
/**
 * @spec_ref spec-defect-reports-carry-their-own-context-a-checked-repro AC-RI-6
 *
 * Production wiring of the context attachment: the compiled `lore report-issue` reads the named test file and the
 * project's git `origin`, and the filed body carries the `**Context:**` section — the header only when the origin
 * is the upstream repository itself, the `@spec_ref` line always, the home folder reduced to `~`.
 *
 * Offline: the spawned binary sees a stub `gh` as the only PATH entry (plus a symlink to the real git, which the
 * origin lookup runs). Throwaway git project + temp HOME (`mkdtemp` + `lore init`), never this repo's `.lore/`.
 *
 * Falsifier (mutation run by the author, see task evidence): skip the context builder in the filing path.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";
import { cleanupPayloadGhStubDir, payloadGhStubDir } from "../integration/helpers/payload-gh-stub";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { templatedFieldsArgs } from "../helpers/templated-create.js";

const WORKTREE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");

const UPSTREAM_REPO = "acme-test/ri6-context";
const STUB_REPO_ID = 706_001_001;
const STUB_ISSUE_NUMBER = 70_601;
const STUB_ISSUE_URL = `https://github.com/${UPSTREAM_REPO}/issues/${STUB_ISSUE_NUMBER}`;
const NONCE = "RI6-HEADER-NONCE-91b7";
const SPEC_REF = "// @spec_ref spec-ri6-fixture AC-RI6-1";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let ghStubDir: string;
let recordedBodyPath: string;
let configHome: string;
let fakeHome: string;
const roots: string[] = [];

function run(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd,
    env: { ...process.env, CLAUDECODE: "1", LORE_CONFIG_HOME: configHome, HOME: fakeHome, PATH: ghStubDir, LORE_ACTOR: "agent:ri6-context" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  if ((proc.exitCode ?? 1) !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
}

/** Wraps the payload stub's `gh` so the issue-create POST's `body=` argument is written verbatim to `recordTo`. */
function wrapStubToRecordBody(dir: string, recordTo: string): void {
  const quote = (value: string): string => ["'", value.split("'").join("'\\''"), "'"].join("");
  renameSync(join(dir, "gh"), join(dir, "gh-payload"));
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    body=*) printf '%s' "\${arg#body=}" > ${quote(recordTo)} ;;
  esac
done
exec /bin/sh ${quote(join(dir, "gh-payload"))} "$@"
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
}

/** A throwaway git project with `origin`, a root PRD, the upstream config and tests/x.test.ts; files one report and returns the body. */
function fileFromProject(origin: string): { result: RunResult; body: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-ri6-project-")));
  roots.push(root);
  git(root, ["init", "-q"]);
  git(root, ["remote", "add", "origin", origin]);
  const initResult = run(["init"], root);
  if (initResult.exitCode !== 0) throw new Error(`'lore init' failed: ${initResult.stderr}`);
  const prd = run(["create", "prd", "--title", "RI-6 throwaway root PRD", ...templatedFieldsArgs("prd")], root);
  if (prd.exitCode !== 0) throw new Error(`root PRD creation failed: ${prd.stderr}`);
  patchLoreConfig(root, ["feedback:", "  upstream:", `    repo: ${UPSTREAM_REPO}`, ""].join("\n"));
  mkdirSync(join(root, "tests"));
  writeFileSync(
    join(root, "tests", "x.test.ts"),
    `${SPEC_REF}\n// ${NONCE} reads ${fakeHome}/data.txt\nimport { it } from "vitest";\nit("x", () => {});\n`,
  );
  rmSync(recordedBodyPath, { force: true });
  const result = run(
    [
      "report-issue", "--title", "RI-6 context wiring", "--description", "RI6 description", "--expected", "RI6 expected",
      "--actual", "RI6 actual", "--severity", "high", "--category", "regression",
      "--repro-command", "lore fragments check tests/x.test.ts", "--json",
    ],
    root,
  );
  return { result, body: existsSync(recordedBodyPath) ? readFileSync(recordedBodyPath, "utf8") : "" };
}

beforeAll(() => {
  assertFreshBinary(DIST_LORE, [join(WORKTREE_ROOT, "packages", "lore", "src"), join(WORKTREE_ROOT, "packages", "core", "src")]);
  ghStubDir = payloadGhStubDir({ repoId: STUB_REPO_ID, createdNumber: STUB_ISSUE_NUMBER, createdUrl: STUB_ISSUE_URL });
  recordedBodyPath = join(ghStubDir, "recorded-body.txt");
  wrapStubToRecordBody(ghStubDir, recordedBodyPath);
  const realGit = Bun.which("git");
  if (realGit === null) throw new Error("git is required on the test machine's PATH");
  // reason: the origin lookup runs git under the invocation's PATH, which is the stub dir alone.
  symlinkSync(realGit, join(ghStubDir, "git"));
  configHome = mkdtempSync(join(tmpdir(), "lore-ri6-config-home-"));
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), "lore-ri6-home-")));
}, 180_000);

afterAll(() => {
  if (ghStubDir !== undefined) cleanupPayloadGhStubDir(ghStubDir);
  for (const path of [configHome, fakeHome, ...roots]) {
    if (path === undefined) continue;
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup only.
    }
  }
});

describe("AC-RI-6", () => {
  it("origin is the upstream repository: the Context part holds the header nonce, with the home folder reduced", () => {
    const { result, body } = fileFromProject(`git@github.com:${UPSTREAM_REPO}.git`);
    expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    const context = body.slice(body.indexOf("**Context:**"));
    expect(body).toContain("**Context:** tests/x.test.ts");
    expect(context).toContain(NONCE);
    expect(context).toContain(SPEC_REF);
    expect(context).toContain("~/data.txt");
    expect(body).not.toContain(fakeHome);
    expect(body.indexOf("**Context:**")).toBeLessThan(body.indexOf("Reported by:"));
  });

  it("origin is another repository: the @spec_ref line is attached, the header nonce is not", () => {
    const { result, body } = fileFromProject("git@github.com:someone-else/other-repo.git");
    expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(body).toContain("**Context:** tests/x.test.ts");
    expect(body).toContain(SPEC_REF);
    expect(body).not.toContain(NONCE);
  });
});
