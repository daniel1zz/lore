// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-a-task-is-archived-only-on-a-landing-lore-recorded-one  AC-LRD-3;
 *   business rule BR-1337 (one working copy carries one unlanded task), BR-134 (the same-name check no longer has to
 *   excuse one actor holding several tasks from one working copy).
 *
 * Throwaway git repo + throwaway corpus (mkdtemp + `git init` + `lore init`), real `lore` subprocesses; never the
 * repo's own `.lore/`.
 *
 * Coverage: (1) a second task naming a working copy whose earlier claimant is unlanded exits 4 naming the first task
 * and writes nothing, for the same actor under a different session (NEGATIVE + STATE); (2) the same holds for the
 * same session id (NEGATIVE); (3) once the first task's landing is recorded on a commit on main the same claim succeeds (HAPPY);
 * (4) a claim naming another working copy is unaffected (BOUNDARY); (5) an archived earlier claimant never blocks
 * (BOUNDARY).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { planFieldsArgs, templatedFieldsArgs } from "../helpers/templated-create.js";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { installShippedGuard } from "./support/main-guard-repo.js";

interface RunResult {
  readonly stdout: string;
  readonly exitCode: number;
  readonly text: string;
}

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");
const SESSION = "11111111-2222-3333-4444-555555555555";
// two session ids with the same first 8 chars: one actor (`agent:session-abcd1234`), two sessions
const ACTOR_SESSION_A = "abcd1234-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACTOR_SESSION_B = "abcd1234-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DEFAULT_SESSION = "99999999-8888-7777-6666-555555555555";

let dir: string;
let planSlug: string;
let taskCounter = 0;

function runLore(args: string[], env: NodeJS.ProcessEnv = {}): RunResult {
  const proc = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd: dir,
    encoding: "utf8",
    // The actor resolver never reads a name from the environment (BR-1055): the claimant identity is the session tier
    // (`CLAUDE_CODE_SESSION_ID` -> `agent:session-<id8>`). Pin it, and clear the alias the resolver also reads, so the
    // outcome never depends on the runner's own identity (without it a bare runner fell to the OS username and case (4)
    // hit ACTOR_IDENTITY_COLLISION).
    env: {
      ...process.env,
      HOME: FIXTURE_HOME_OUTSIDE_REPO,
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: DEFAULT_SESSION,
      CLAUDE_SESSION_ID: undefined,
      ...env,
    },
  });
  return { stdout: proc.stdout, exitCode: proc.status ?? 1, text: `${proc.stdout}\n${proc.stderr}` };
}

function mustRun(args: string[], env: NodeJS.ProcessEnv = {}): string {
  const result = runLore(args, env);
  if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${result.exitCode}: ${result.text}`);
  return result.stdout;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from create output: ${stdout}`);
  return slug;
}

function claimOf(slug: string): unknown {
  const payload = JSON.parse(mustRun(["get", slug, "--json"])) as { data: { doc: { extra: { claim?: unknown } } } };
  return payload.data.doc.extra.claim;
}

function makeBranch(name: string): void {
  git(["checkout", "-q", "-b", name, "main"]);
  writeFileSync(join(dir, `${name}.txt`), `${name}\n`);
  git(["add", `${name}.txt`]);
  git(["commit", "-q", "-m", `work on ${name}`]);
  git(["checkout", "-q", "--detach", "main"]);
}

function createTask(title: string): string {
  taskCounter += 1;
  const slug = parseSlug(
    mustRun(["create", "task", "--kind", "code", "--title", `${title} ${taskCounter}`, "--parent", planSlug, "--plan-id", planSlug, ...templatedFieldsArgs("task"), "--no-ai"]),
  );
  // reason: `lore integrate` records a landing only on a task whose oracles it can run, i.e. one approved with its contract (AC-DCS2-1);
  // the red run is not this file's subject (AC-DCS1-5).
  mustRun(["approve", slug, "--red-waiver", "the red run is not the subject of this test"]);
  return slug;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-claim-one-unlanded-"));
  makeCleanTreeRepo(dir);
  appendFileSync(join(dir, ".git", "info", "exclude"), ".claude/\n");
  mustRun(["init"]);
  patchLoreConfig(
    dir,
    [
      "workflow:", "  review:", "    judgment_required_types: []", "  integrate:", '    floor_command: "true"',
      "  done_contract:", '    install: "echo install-ok"', '    typecheck: "echo typecheck-ok"', '    test_file: "echo Ran 1 tests in {file}"', "",
    ].join("\n"),
  );
  const prd = parseSlug(mustRun(["create", "prd", "--title", "Claim PRD", ...templatedFieldsArgs("prd", { refTarget: "problem" }), "--no-ai"]));
  planSlug = parseSlug(mustRun(["create", "plan", "--title", "Claim Plan", "--parent", prd, ...planFieldsArgs(prd), "--no-ai"]));
  git(["checkout", "-q", "--detach", "main"]);
  installShippedGuard(dir, join(dir, ".git", "guard-hooks")); // integrate refuses to run without the guard (BR-1273)
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("AC-LRD-3 — one working copy carries one unlanded task", () => {
  it("(1) the same actor under a DIFFERENT session claiming a second task on the same working copy exits 4 naming the first task and writes nothing", () => {
    makeBranch("feat-shared");
    const first = createTask("First");
    const second = createTask("Second");
    // reason: the actor is `agent:session-<first 8 chars of the session id>`, so two session ids sharing their first
    // 8 chars are ONE actor in TWO sessions — the only way "same actor" and "same session" come apart.
    mustRun(["claim", first, "--worktree", "feat-shared"], { CLAUDE_CODE_SESSION_ID: ACTOR_SESSION_A });

    const refused = runLore(["claim", second, "--worktree", "feat-shared"], { CLAUDE_CODE_SESSION_ID: ACTOR_SESSION_B });

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain(first);
    expect(refused.text).toContain("feat-shared");
    expect(claimOf(second)).toBeUndefined();
  }, 300_000);

  it("(2) the SAME session (same id, so the same actor too) is refused alike", () => {
    makeBranch("feat-session");
    const first = createTask("First");
    const second = createTask("Second");
    mustRun(["claim", first, "--worktree", "feat-session"], { CLAUDE_CODE_SESSION_ID: SESSION });

    const refused = runLore(["claim", second, "--worktree", "feat-session"], { CLAUDE_CODE_SESSION_ID: SESSION });

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain(first);
    expect(claimOf(second)).toBeUndefined();
  }, 300_000);

  it("(3) after the first task's landing is recorded on a commit on main, the same claim succeeds", () => {
    makeBranch("feat-landed");
    const first = createTask("First");
    const second = createTask("Second");
    mustRun(["claim", first, "--worktree", "feat-landed"]);
    expect(runLore(["claim", second, "--worktree", "feat-landed"]).exitCode).toBe(4);
    const landed = runLore(["integrate", "feat-landed", "--session", "claim-one-session"]);
    expect(landed.exitCode, landed.text).toBe(0);

    const claimed = runLore(["claim", second, "--worktree", "feat-landed"]);

    expect(claimed.exitCode, claimed.text).toBe(0);
    expect(claimOf(second)).toBeDefined();
  }, 300_000);

  it("(4) a claim naming another working copy is unaffected", () => {
    makeBranch("feat-a");
    makeBranch("feat-b");
    const first = createTask("First");
    const second = createTask("Second");
    mustRun(["claim", first, "--worktree", "feat-a"]);

    const claimed = runLore(["claim", second, "--worktree", "feat-b"]);

    expect(claimed.exitCode, claimed.text).toBe(0);
  }, 300_000);

  it("(5) an archived earlier claimant never blocks", () => {
    makeBranch("feat-archived");
    const first = createTask("First");
    const second = createTask("Second");
    mustRun(["claim", first, "--worktree", "feat-archived"]);
    mustRun(["set", first, "--status", "approved"]);
    mustRun(["set", first, "--status", "deprecated", "--reason", "superseded by the second task"]);

    const claimed = runLore(["claim", second, "--worktree", "feat-archived"]);

    expect(claimed.exitCode, claimed.text).toBe(0);
  }, 300_000);
});
