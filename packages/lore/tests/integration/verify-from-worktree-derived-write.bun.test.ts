// @spawns packages/lore/src/index.ts
/**
 * `lore verify` from a linked worktree is not refused on the baseline write it derives
 * (task-skill-fix-lore-verify-from-a-linked-worktree-is-refused-on, regression from DCL-3b 5f13396f).
 *
 * Verifying from a worktree is the mandated route. After DCL-3b every baseline write rides
 * `CorpusService.writeDoc`, whose foreign-corpus decision (`CorpusWriteAuthority.decide`) demanded a
 * `corpus_scope` lease, so a baseline write verify derives from the attested run was refused with
 * `gate:corpus-write:foreign-provenance`. That write is derived state of the SAME declared intent that authorizes the
 * verify run's evidence row (a fresh task lease naming this worktree); it is not authoring.
 *
 * Fixtures are mkdtemp git repos with their own `lore init` corpus, driven through the real CLI from a real linked
 * worktree, so the corpus the write resolves is the main checkout's (provenance `git_common_dir`).
 *
 * Coverage:
 *   HAPPY:      verify of a script AC citing a rule, from the worktree, exits 0 and records an attested row
 *   NEGATIVE:   an UNRELATED baseline write (`baseline map --command`) from the same unscoped worktree is still
 *               refused (exit 4, gate:corpus-write:foreign-provenance) and lands nothing
 *   REGRESSION: verify from the main checkout is untouched
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSessionIdentity } from "../helpers/session-actor";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const FOREIGN_TOKEN = "gate:corpus-write:foreign-provenance";
const AC_ID = "AC-VWT-1";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string, actor?: string): RunResult {
  const env = withSessionIdentity({ ...process.env, HOME: cwd, CLAUDECODE: "1" }, actor ?? null) as Record<string, string>;
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string, actor?: string): RunResult {
  const r = runLore(args, cwd, actor);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

const scratch: string[] = [];
let repo = "";
let worktrees = "";
let leaf = "";
let plan = "";
let sitesFile = "";
let counter = 0;

function leafVersion(): number {
  return (JSON.parse(mustRun(["get", leaf, "--json"], repo).stdout) as { data: { doc: { version: number } } }).data.doc.version;
}

function createTask(label: string): string {
  counter += 1;
  return slugOf(
    mustRun(
      ["create", "task", "--kind", "code", "--title", `VWT Task ${label} ${counter}`, "--parent", plan, "--plan-id", plan, "--content", "x", "--ac-scope", AC_ID, "--no-ai"],
      repo,
    ).stdout,
  );
}

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "vwt-repo-")));
  worktrees = realpathSync(mkdtempSync(join(tmpdir(), "vwt-wt-")));
  scratch.push(repo, worktrees);
  if (repo.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");

  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "vwt@example.invalid"]);
  git(repo, ["config", "user.name", "vwt test"]);
  writeFileSync(join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "init"]);

  mustRun(["init"], repo);
  patchLoreConfig(
    repo,
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      '    "task-create":',
      "      enabled: false",
      "",
    ].join("\n"),
  );

  const prd = slugOf(mustRun(["create", "prd", "--title", "VWT PRD", "--content", "root", "--no-ai"], repo).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "VWT Root"], repo).stdout);
  const branch = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "bx", "--title", "VWT Branch"], repo).stdout);
  leaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "lx", "--title", "VWT Leaf"], repo).stdout);
  const ruleOut = mustRun(
    ["rule", "add", leaf, "--statement", "A verified criterion keeps its rule state.", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "verify records pass"],
    repo,
  );
  const ruleId = ruleOut.stdout.match(/BR-\d+/)?.[0];
  if (ruleId === undefined) throw new Error(`no rule id in: ${ruleOut.stdout}`);

  const spec = slugOf(mustRun(["create", "spec", "--title", "VWT Spec", "--content", "body", "--no-ai"], repo).stdout);
  mustRun(
    ["ac", "add", spec, AC_ID, "--statement", "A script AC that passes.", "--mode", "script", "--oracle", "other", "--command", `echo '${AC_ID} PASS: ok'`],
    repo,
  );
  mustRun(["ac", "cite", spec, AC_ID, ruleId], repo);
  plan = slugOf(mustRun(["create", "plan", "--title", "VWT Plan", "--parent", spec, "--content", "x", "--no-ai"], repo).stdout);

  sitesFile = join(worktrees, "rows.json");
  writeFileSync(sitesFile, JSON.stringify([{ site: "x.ts#fn#CODE", rules: [ruleId] }]));
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe("lore verify from a linked worktree (derived baseline write)", () => {
  it("HAPPY + NEGATIVE: verify from an unscoped worktree exits 0 with an attested row; an unrelated baseline write there stays refused", () => {
    const actor = "agent:vwt-verify";
    const task = createTask("wt");
    const wt = join(worktrees, "verify");
    git(repo, ["worktree", "add", "-q", "-b", "vwt-verify", wt]);
    const claim = runLore(["claim", task, "--worktree", wt], wt, actor);
    expect(claim.exitCode, claim.stderr + claim.stdout).toBe(0);

    const verify = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], wt, actor);
    expect(verify.stderr + verify.stdout).not.toContain(FOREIGN_TOKEN);
    expect(verify.exitCode, verify.stderr + verify.stdout).toBe(0);

    const taskDoc = JSON.parse(mustRun(["get", task, "--json"], repo).stdout) as {
      data: { doc: { extra: { verification_evidence?: Array<{ attestation?: unknown; result: string }> } } };
    };
    const rows = taskDoc.data.doc.extra.verification_evidence ?? [];
    expect(rows.some((r) => r.result === "pass" && r.attestation !== undefined)).toBe(true);

    const before = leafVersion();
    const write = runLore(["baseline", "map", leaf, "--command", "sample-write"], wt, actor);
    expect(write.exitCode).toBe(4);
    expect(write.stderr + write.stdout).toContain(FOREIGN_TOKEN);
    expect(leafVersion()).toBe(before);
  }, 120_000);

  it("HAPPY: verify from a detached worktree of a task this worktree never claimed exits 0 with an attested row", () => {
    const task = createTask("detached");
    const wt = join(worktrees, "detached");
    git(repo, ["worktree", "add", "-q", "--detach", wt]);

    const verify = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], wt, "agent:vwt-detached");
    expect(verify.stderr + verify.stdout).not.toContain(FOREIGN_TOKEN);
    expect(verify.exitCode, verify.stderr + verify.stdout).toBe(0);

    const taskDoc = JSON.parse(mustRun(["get", task, "--json"], repo).stdout) as {
      data: { doc: { extra: { verification_evidence?: Array<{ attestation?: unknown; result: string }> } } };
    };
    const rows = taskDoc.data.doc.extra.verification_evidence ?? [];
    expect(rows.some((r) => r.result === "pass" && r.attestation !== undefined)).toBe(true);

    // NEGATIVE: the intent is the verify run's, not a general licence — a SELF-REPORTED evidence row on the same
    // task from the same lease-less worktree is still refused.
    const selfReported = runLore(
      ["evidence", task, "--oracle", "other", "--command", "echo hi", "--result", "pass", "--ac", AC_ID],
      wt,
      "agent:vwt-detached",
    );
    expect(selfReported.exitCode, selfReported.stderr + selfReported.stdout).toBe(4);
    expect(selfReported.stderr + selfReported.stdout).toContain(FOREIGN_TOKEN);
  }, 120_000);

  it("REGRESSION: verify from the main checkout is untouched", () => {
    const task = createTask("main");
    const verify = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], repo, "agent:vwt-main");
    expect(verify.exitCode, verify.stderr + verify.stdout).toBe(0);
  });
});
