/**
 * git-safety-gate.test.ts — the state-aware (Design B) destructive-git guard.
 *
 * `assets/hooks/pre-bash-git-safety-gate.mjs` is a PreToolUse (matcher "Bash")
 * hook that BLOCKS commands which could destroy uncommitted/unmerged work
 * (git reset --hard, clean -f, branch -D, worktree remove --force, …). It is a
 * vendored lore asset (shipped by `lore setup` to `~/.claude/hooks/`), so its
 * behaviour is pinned here.
 *
 * Design B property under test — the gate ALWAYS blocks a matched op (exit 2,
 * fail-safe), and for the state-determinable rules it runs READ-ONLY git probes
 * and puts the ACTUAL risk in the block message ("WOULD DESTROY 2 uncommitted
 * change(s): …" vs "working tree is CLEAN — nothing would be lost"). It never
 * auto-allows on a "looks safe" probe: a probe bug must degrade to a false
 * BLOCK (friction), never a false ALLOW (data loss).
 *
 * Every scenario spawns the REAL vendored hook as a `node` subprocess, feeding
 * it a PreToolUse-shaped `{cwd, tool_input:{command}}` payload on stdin and
 * reading the exit code directly (2 = block, 0 = allow) plus stderr (the
 * evidence-bearing block message). The W4-incident cases (worktree remove
 * --force / branch -D) run against a real throwaway git repo with purpose-built
 * dirty / clean / merged / unmerged state so the probe's evidence is observed,
 * not inferred.
 *
 * Coverage dimensions: BLOCK-classification / ALLOW-classification (no
 * regression) / PROBE-evidence (state-accurate) / bypass (bash -c) /
 * print-like false-positive.
 *
 * @spec_ref audit V1+V2 mechanization (W4 near-data-loss, 2026-07-20) + Design B
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// packages/lore/tests/unit/hooks/git-safety-gate.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK = join(REPO_ROOT, "assets", "hooks", "pre-bash-git-safety-gate.mjs");

// Read the ACTUAL runtime constant out of the hook's source, rather than
// hardcoding a second "30" here that could silently drift from it.
const WINDOW_MATCH = readFileSync(HOOK, "utf8").match(/const WORKTREE_LIVENESS_WINDOW_MINUTES = (\d+);/);
if (!WINDOW_MATCH) throw new Error("could not read WORKTREE_LIVENESS_WINDOW_MINUTES out of the hook source");
const WORKTREE_LIVENESS_WINDOW_MINUTES_UNDER_TEST = Number(WINDOW_MATCH[1]);

/** Run the hook with a PreToolUse payload; exit code read directly (never piped). */
function run(command: string, cwd?: string): { code: number; stderr: string } {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ cwd, tool_input: { command } }),
    encoding: "utf8",
  });
  return { code: r.status ?? -1, stderr: r.stderr ?? "" };
}

function git(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

describe("git-safety-gate — BLOCK classification (exit 2, fail-safe)", () => {
  const cases: Array<[string, string]> = [
    ["reset --hard", "git reset --hard HEAD"],
    ["branch -D", "git branch -D some-branch"],
    ["clean -fd", "git clean -fd"],
    ["stash drop", "git stash drop"],
    ["restore path", "git restore src/a.ts"],
    ["checkout -- path", "git checkout -- src/a.ts"],
    ["worktree remove --force (flag after path)", "git worktree remove /wt/x --force"],
    ["worktree remove -f (flag before path)", "git worktree remove -f /wt/x"],
    ["chained W4 sequence", "git merge b --no-ff; git worktree remove --force /wt/x"],
    ["bash -c bypass", 'bash -c "git worktree remove --force /wt/x"'],
    // 2026-08-02 fix: non-force is now MATCHED too. "/wt/x" does not exist, so
    // the probe cannot read its status/branch — undecidable, and D4 widens an
    // undecidable case toward BLOCK, never toward pass-through.
    ["worktree remove without --force, unresolvable path (task-the-git-safety-gate-s-worktree-rule-matches-only-force-and)", "git worktree remove /wt/x"],
    ["push --force (unconditional)", "git push --force origin main"],
    ["rm -rf .git (unconditional)", "rm -rf .git"],
    ["reflog expire (unconditional)", "git reflog expire --expire=now --all"],
  ];
  for (const [name, cmd] of cases) {
    it(`blocks: ${name}`, () => {
      expect(run(cmd).code).toBe(2);
    });
  }
});

describe("git-safety-gate — ALLOW classification (exit 0, no regression)", () => {
  // NOTE: "worktree remove without --force" moved OUT of this list (2026-08-02
  // fix) — it is no longer an unconditional allow. It now depends on repo
  // state; see the BLOCK-classification case above (unresolvable path) and the
  // dedicated "non-force git worktree remove" describe block below (real repo
  // state: unmerged / recent-reflog / clean+merged+quiet).
  const cases: Array<[string, string]> = [
    ["worktree list", "git worktree list"],
    ["branch -d (merged-only)", "git branch -d some-branch"],
    ["reset --soft", "git reset --soft HEAD~1"],
    ["restore --staged", "git restore --staged src/a.ts"],
    ["clean -n (dry-run)", "git clean -n"],
    ["stash push", "git stash push -m wip"],
    ["echo mentioning a blocked phrase", 'echo "git reset --hard is dangerous"'],
    ["grep for the phrase", 'grep -r "worktree remove --force" hooks/'],
  ];
  for (const [name, cmd] of cases) {
    it(`allows: ${name}`, () => {
      expect(run(cmd).code).toBe(0);
    });
  }
});

describe("git-safety-gate — PROBE evidence (state-accurate, against a real repo)", () => {
  let repo: string;
  let wtDirty: string;
  let wtClean: string;

  beforeAll(() => {
    const base = mkdtempSync(join(tmpdir(), "gsg-"));
    repo = join(base, "repo");
    mkdirSync(repo);
    git(["init", "-q"], repo);
    git(["config", "user.email", "t@t"], repo);
    git(["config", "user.name", "t"], repo);
    writeFileSync(join(repo, "f.txt"), "v1\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);
    // a merged branch (ancestor of main) + an unmerged branch with a real commit
    git(["branch", "merged-branch"], repo);
    git(["checkout", "-q", "-b", "unmerged-branch"], repo);
    writeFileSync(join(repo, "g.txt"), "x\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "work"], repo);
    git(["checkout", "-q", "main"], repo);
    // a dirty worktree on its own branch, and a clean worktree on the merged branch
    wtDirty = join(base, "wt-dirty");
    wtClean = join(base, "wt-clean");
    git(["worktree", "add", "-q", wtDirty, "-b", "wt-branch"], repo);
    writeFileSync(join(wtDirty, "uncommitted.txt"), "dirty\n");
    git(["worktree", "add", "-q", wtClean, "merged-branch"], repo);
  });

  afterAll(() => {
    if (repo) rmSync(join(repo, ".."), { recursive: true, force: true });
  });

  it("reset --hard on a CLEAN tree reports it as safe (still blocks)", () => {
    const { code, stderr } = run("git reset --hard HEAD", repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/working tree is CLEAN/);
  });

  it("reset --hard on a DIRTY tree names the at-risk file (still blocks)", () => {
    writeFileSync(join(repo, "scratch.txt"), "wip\n");
    try {
      const { code, stderr } = run("git reset --hard HEAD", repo);
      expect(code).toBe(2);
      expect(stderr).toMatch(/WOULD DESTROY \d+ uncommitted/);
      expect(stderr).toContain("scratch.txt");
    } finally {
      rmSync(join(repo, "scratch.txt"));
    }
  });

  it("branch -D on a MERGED branch reports it already-merged (still blocks)", () => {
    const { code, stderr } = run("git branch -D merged-branch", repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/already merged/);
  });

  it("branch -D on an UNMERGED branch names the commits that would be lost", () => {
    const { code, stderr } = run("git branch -D unmerged-branch", repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/WOULD LOSE \d+ unmerged commit/);
  });

  it("worktree remove --force on a DIRTY worktree names the uncommitted file", () => {
    const { code, stderr } = run(`git worktree remove --force ${wtDirty}`, repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/UNCOMMITTED change/);
    expect(stderr).toContain("uncommitted.txt");
  });

  it("worktree remove --force on a CLEAN+MERGED worktree reports likely-safe (still blocks)", () => {
    const { code, stderr } = run(`git worktree remove --force ${wtClean}`, repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/Likely SAFE|merged into/);
  });
});

// ── SPEC-066: heredoc/string-literal awareness + command-position discipline ──
//
// Verified dogfood failure P1-4 (guyin 2026-07-22, reproduced on HEAD e9e5188):
// `preprocessForInspection` only stripped quoted strings, not heredoc bodies —
// so writing a runbook/knowledge doc whose BODY quotes a dangerous command
// (`cat <<'EOF' ... git branch -D old-feature ... EOF`) was blocked as if the
// command were executing, and the branch-probe helper went on to parse a prose
// word as a branch name. D1 strips heredoc bodies before segmentation; D2 adds
// command-position trigger matching (SPEC-050 D4 semantics) so a dangerous
// token in ARGUMENT position never fires; D3 keeps the fail-closed posture.
describe("git-safety-gate — SPEC-066 heredoc stripping (D1, AC-066-1)", () => {
  const cases: Array<[string, string]> = [
    ["unquoted delimiter", "cat <<EOF\nSome runbook example: git branch -D old-feature\nEOF"],
    ["single-quoted delimiter", "cat <<'EOF'\nSome runbook example: git branch -D old-feature\nEOF"],
    ["double-quoted delimiter", 'cat <<"EOF"\nSome runbook example: git branch -D old-feature\nEOF'],
    ["dash-trimmed <<- delimiter (indented terminator)", "cat <<-EOF\n\tSome runbook example: git branch -D old-feature\n\tEOF"],
  ];
  for (const [name, cmd] of cases) {
    it(`AC-066-1: allows a heredoc body containing a dangerous command — ${name}`, () => {
      const { code, stderr } = run(cmd);
      expect(code).toBe(0);
      expect(stderr).toBe("");
    });
  }
});

describe("git-safety-gate — SPEC-066 directly-executing danger still blocks (D2, AC-066-2)", () => {
  it("AC-066-2: a directly-executing git branch -D remains BLOCKED", () => {
    expect(run("git branch -D some-branch").code).toBe(2);
  });

  it("AC-066-2: a directly-executing git branch -D as a &&-chained later segment remains BLOCKED", () => {
    expect(run("echo hi && git branch -D some-branch").code).toBe(2);
  });

  it("AC-066-2: a directly-executing git branch -D as a ;-chained later segment remains BLOCKED", () => {
    expect(run("echo hi; git branch -D some-branch").code).toBe(2);
  });
});

describe("git-safety-gate — SPEC-066 heredoc body does not swallow a trailing real danger (AC-066-3)", () => {
  it("AC-066-3: a dangerous command inside a heredoc body followed by a REAL dangerous command outside it is still BLOCKED", () => {
    const { code, stderr } = run(
      "cat <<EOF\ngit branch -D fake-branch-from-heredoc\nEOF\ngit push --force origin main",
    );
    expect(code).toBe(2);
    expect(stderr).toMatch(/force-push overwrites remote history/);
  });
});

describe("git-safety-gate — SPEC-066 command-position discipline (D2, AC-066-4)", () => {
  it("AC-066-4: a dangerous trigger token in ARGUMENT position (not command position) does not fire the rule", () => {
    const { code, stderr } = run("notify-send git branch -D backup");
    expect(code).toBe(0);
    expect(stderr).toBe("");
  });
});

describe("git-safety-gate — SPEC-066 unterminated heredoc (D1, AC-066-5)", () => {
  it("AC-066-5: an unterminated heredoc neither crashes the gate nor blocks on body content", () => {
    const { code, stderr } = run(
      "cat <<EOF\ngit branch -D unterminated-body\nno closing delimiter anywhere in this text",
    );
    expect(code).toBe(0);
    expect(stderr).toBe("");
  });
});

// ── argument-aware probes (AC-GS-1..5) ────────────────────────────────────────
//
// spec-git-safety-gate-probes-report-the-wrong-blast-radius. Measured on main
// 2026-07-31: `git stash drop 'stash@{0}'` rendered `Segment : git stash drop ''`
// and an assessment listing ALL 8 live stash entries; the unquoted form listed
// all 8 too (the control that isolates argument-blindness from quoting).
// `probeStash` was declared `probeStash(_inner, …)` and `probePathArg` declared
// `inner` without reading it, so a one-entry drop and a one-file restore were
// both reported with the blast radius of their whole-repository variants.
//
// The NEGATIVE half of each assertion is the load-bearing one: "names bravo"
// passes against the defective all-entries output, "does not name alpha or
// charlie" does not.
//
// Every stash assertion runs against a purpose-built mkdtemp repo whose stashes
// this fixture creates. The repo's own stash list is shared mutable state that
// holds other sessions' work and is never read or written here.

/** The `Assessment:` block of a block message, without the Segment/Why/Safer lines. */
function assessmentOf(stderr: string): string {
  const m = stderr.match(/^Assessment:[\s\S]*?(?=\nSafer {3}: )/m);
  return m ? m[0] : "";
}

describe("git-safety-gate — argument-aware probes (D1-D5)", () => {
  let base: string;
  let repo: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "gsg-args-"));
    repo = join(base, "repo");
    mkdirSync(repo);
    git(["init", "-q", "-b", "main"], repo);
    git(["config", "user.email", "t@t"], repo);
    git(["config", "user.name", "t"], repo);
    writeFileSync(join(repo, "a.txt"), "v1\n");
    writeFileSync(join(repo, "b.txt"), "v1\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);
    // Three distinct stash entries pushed oldest-first. The stash is LIFO, so
    // stash@{0}=charlie, stash@{1}=bravo, stash@{2}=alpha — the message word is
    // what each assertion keys on, so "the targeted entry" and "the others" are
    // distinguishable by content rather than by position.
    for (const message of ["alpha", "bravo", "charlie"]) {
      writeFileSync(join(repo, "a.txt"), `${message}\n`);
      git(["stash", "push", "-q", "-m", message], repo);
    }
    // Two distinct dirty tracked files: makes the path-scoped negative half
    // (AC-GS-4) and the D2 whole-tree half (AC-GS-5) both non-vacuous.
    writeFileSync(join(repo, "a.txt"), "dirty-a\n");
    writeFileSync(join(repo, "b.txt"), "dirty-b\n");
  });

  afterAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  // ── AC-GS-1 ────────────────────────────────────────────────────────────────
  it("AC-GS-1: a targeted `git stash drop stash@{1}` names only the targeted stash entry, not the other two", () => {
    const { code, stderr } = run("git stash drop stash@{1}", repo);
    expect(code).toBe(2);
    expect(stderr).toContain("bravo");
    // Load-bearing: the pre-fix all-entries output satisfies the line above.
    expect(stderr).not.toContain("alpha");
    expect(stderr).not.toContain("charlie");
  });

  it("AC-GS-1 control: the fixture really carries three entries, so `names only the targeted stash entry` is not vacuous", () => {
    const r = spawnSync("git", ["stash", "list"], { cwd: repo, encoding: "utf8" });
    expect(r.status).toBe(0);
    const lines = (r.stdout ?? "").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    for (const message of ["alpha", "bravo", "charlie"]) expect(r.stdout).toContain(message);
  });

  // ── AC-GS-2 ────────────────────────────────────────────────────────────────
  it("AC-GS-2: a quoted revision reaches the probe — same single-entry assessment as the unquoted form, and Segment prints raw (D5)", () => {
    const quoted = run("git stash drop 'stash@{1}'", repo);
    const unquoted = run("git stash drop stash@{1}", repo);
    expect(quoted.code).toBe(2);
    expect(quoted.stderr).toContain("bravo");
    expect(quoted.stderr).not.toContain("alpha");
    expect(quoted.stderr).not.toContain("charlie");
    // D5: the block message reproduces what the user typed, not `git stash drop ''`.
    expect(quoted.stderr).toContain("Segment : git stash drop 'stash@{1}'");
    expect(quoted.stderr).not.toContain("git stash drop ''");
    // Quoting must make no difference to the evidence. Compared on the
    // Assessment block only — the Segment lines differ by construction.
    const quotedAssessment = assessmentOf(quoted.stderr);
    expect(quotedAssessment).not.toBe(""); // the comparison below cannot go vacuous
    expect(quotedAssessment).toBe(assessmentOf(unquoted.stderr));
  });

  it("AC-GS-2 paired control: the rule still fires when a quoted trigger is what got blanked — matching keeps consuming the sanitized text while the probe reads the raw revision (quoted revision reaches the probe without weakening SPEC-066)", () => {
    // The quoted env value carries a COMPLETE `git reset --hard` trigger. If
    // matching were switched to raw text to obtain the probe's argument, the
    // reset rule would fire here. It must not: the stash rule fires, on the
    // sanitized `MSG='' git stash drop stash@{1}`, and the probe still reads
    // the raw revision.
    const { code, stderr } = run("MSG='git reset --hard' git stash drop stash@{1}", repo);
    expect(code).toBe(2);
    expect(stderr).toContain("git stash drop/clear destroys stashed work");
    expect(stderr).not.toContain("discards working-tree changes");
    expect(stderr).toContain("bravo");
    expect(stderr).not.toContain("alpha");
    expect(stderr).not.toContain("charlie");
  });

  it("AC-GS-2 paired control: a trigger reachable only inside a quoted literal never reaches command position (SPEC-066 preserved while a quoted revision reaches the probe)", () => {
    // Argument position — SPEC-066 D2.
    const argPosition = run("notify-send 'git stash drop stash@{0}'", repo);
    expect(argPosition.code).toBe(0);
    expect(argPosition.stderr).toBe("");
    // A separator inside a quoted literal must not manufacture a new segment:
    // raw-text segmentation would split this into `echo 'x` + `git stash drop
    // stash@{0}'` and block.
    const quotedSeparator = run("echo 'x && git stash drop stash@{0}'", repo);
    expect(quotedSeparator.code).toBe(0);
    expect(quotedSeparator.stderr).toBe("");
  });

  // ── AC-GS-3 ────────────────────────────────────────────────────────────────
  it("AC-GS-3: verb dispatch — `git stash clear` reports every entry", () => {
    const { code, stderr } = run("git stash clear", repo);
    expect(code).toBe(2);
    for (const message of ["alpha", "bravo", "charlie"]) expect(stderr).toContain(message);
  });

  it("AC-GS-3: verb dispatch — a bare `git stash drop` reports the stash@{0} entry alone, matching what git itself would drop", () => {
    const { code, stderr } = run("git stash drop", repo);
    expect(code).toBe(2);
    expect(stderr).toContain("charlie"); // stash@{0}
    expect(stderr).not.toContain("bravo");
    expect(stderr).not.toContain("alpha");
  });

  it("AC-GS-3: verb dispatch — the closed verb set is pinned by an observable: `git stash pop` exits 0 with neither BLOCKED nor WOULD DESTROY", () => {
    const { code, stderr } = run("git stash pop", repo);
    expect(code).toBe(0);
    expect(stderr).not.toContain("BLOCKED");
    expect(stderr).not.toContain("WOULD DESTROY");
  });

  // ── AC-GS-4 ────────────────────────────────────────────────────────────────
  it("AC-GS-4: `git restore <one-file>` reports only the named path", () => {
    const { code, stderr } = run("git restore a.txt", repo);
    expect(code).toBe(2);
    expect(stderr).toContain("a.txt");
    expect(stderr).not.toContain("b.txt"); // load-bearing
  });

  it("AC-GS-4: `git checkout -- <one-file>` reports only the named path", () => {
    const { code, stderr } = run("git checkout -- b.txt", repo);
    expect(code).toBe(2);
    expect(stderr).toContain("b.txt");
    expect(stderr).not.toContain("a.txt"); // load-bearing
  });

  it("AC-GS-4 control: both fixture files are dirty, so `reports only the named path` is not vacuous", () => {
    const r = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("a.txt");
    expect(r.stdout).toContain("b.txt");
  });

  // ── AC-GS-5 ────────────────────────────────────────────────────────────────
  it("AC-GS-5 control: `git rev-parse --verify --quiet stash@{99}` rejects the token — a future git that resolves it turns THIS red instead of leaving `fallback widens` vacuous", () => {
    const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", "stash@{99}"], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
  });

  it("AC-GS-5: an unresolvable revision — the fallback widens to the whole stash and carries the literal [ARG-FALLBACK] marker", () => {
    const { code, stderr } = run("git stash drop stash@{99}", repo);
    expect(code).toBe(2);
    expect(stderr).toContain("Assessment: [ARG-FALLBACK]");
    for (const message of ["alpha", "bravo", "charlie"]) expect(stderr).toContain(message);
  });

  it("AC-GS-5: D2 — `git reset --hard` still reports the ENTIRE dirty tree; the fallback widens, it is never a licence to narrow an already-correct probe", () => {
    const { code, stderr } = run("git reset --hard HEAD", repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/WOULD DESTROY \d+ uncommitted change/);
    expect(stderr).toContain("a.txt");
    expect(stderr).toContain("b.txt");
    expect(stderr).not.toContain("[ARG-FALLBACK]");
  });

  // D1 side effect, measured against the pre-fix hook (exit 0 there, exit 2 here)
  // rather than assumed. The retired two-pass blanking ran the double-quote regex
  // over the WHOLE text first, so an apostrophe inside a double-quoted word let
  // one `"…"` match span a `;` separator AND the trigger behind it: the text
  // collapsed to a single `echo …` segment, which is print-like and never
  // inspected. Recognising a complete quoted literal as one unit in a single
  // left-to-right walk removes that class outright.
  it("D1 REGRESSION: a mis-paired quote can no longer swallow a separator plus the trigger behind it (the pre-fix hook allowed this)", () => {
    const { code, stderr } = run(`echo 'it"s fine' ; git reset --hard HEAD`, repo);
    expect(code).toBe(2);
    expect(stderr).toContain("discards working-tree changes");
  });
});

// ── non-force `git worktree remove` (task
// task-the-git-safety-gate-s-worktree-rule-matches-only-force-and) ────────────
//
// Incident (2026-08-02): an orchestrator ran `git worktree remove <path>` with
// NO --force. The gate's rule matched only --force/-f, so it passed straight
// through. At that instant the branch carried 2 commits not in main and a LIVE
// peer agent was working in that directory (last commit 90s old) — the
// directory was deleted out from under a running agent. The blocking predicate
// ("worktree is clean but its branch … is NOT merged") already existed; it was
// simply unreachable without --force.
//
// AC1 (the incident, NEGATIVE): clean + unmerged + non-force → BLOCK, naming
//     the losing commits. Covered here AND as the "unresolvable path" case
//     added to the BLOCK-classification table above.
// AC2 (NEGATIVE): reflog activity inside the 30-minute liveness window blocks
//     even when the branch IS merged — merged-ness answers "will commits be
//     lost", never "is someone in there".
// AC3 (REGRESSION): --force on a dirty worktree still blocks — already pinned
//     by "worktree remove --force on a DIRTY worktree names the uncommitted
//     file" above; the message text there is unchanged by this task.
// AC4 (REGRESSION, do-not-over-block): clean + merged + QUIET (no reflog
//     activity in the window) + non-force → PASS THROUGH — the mandated
//     post-merge cleanup path (CLAUDE.md). "Quiet" is simulated by backdating
//     the worktree's own per-worktree HEAD reflog file directly (real elapsed
//     time is not available to a test), which is the same file
//     minutesSinceLastReflogActivity reads.
// AC5 (BOUNDARY): a DETACHED-HEAD worktree — must not crash, must not fail
//     open when unmerged or recently-active, and must still pass through when
//     genuinely clean+merged+quiet.
// AC6 (control) and AC7 (consumer probe) are process-level checks recorded as
//     `manual` oracle evidence for this task, not unit tests: AC6 re-runs
//     these same payloads against a reverted copy of this file (git show
//     HEAD:… before this change) and asserts exit 0; AC7 re-runs `lore setup`
//     against a throwaway HOME and asserts the installed copy carries
//     WORKTREE_LIVENESS_WINDOW_MINUTES.
describe("git-safety-gate — non-force `git worktree remove` (AC1/AC2/AC4/AC5)", () => {
  let base: string;
  let repo: string;

  /**
   * Rewrites `cwd`'s own per-worktree `HEAD` reflog so its most recent entry
   * looks `minutesAgo` minutes old — the same file
   * `minutesSinceLastReflogActivity` (pre-bash-git-safety-gate.mjs) reads.
   * Real elapsed time is not obtainable inside a test run, so the fixture
   * rewrites the epoch timestamp field directly rather than sleeping.
   */
  function backdateReflog(cwd: string, minutesAgo: number): void {
    const gd = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd, encoding: "utf8" });
    if (gd.status !== 0) throw new Error(`git rev-parse --absolute-git-dir failed: ${gd.stderr}`);
    const logPath = join(gd.stdout.trim(), "logs", "HEAD");
    const ts = Math.floor(Date.now() / 1000 - minutesAgo * 60);
    const rewritten = readFileSync(logPath, "utf8").replace(/\d{9,11}(?=\s[+-]\d{4})/g, String(ts));
    writeFileSync(logPath, rewritten);
  }

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "gsg-wt-remove-"));
    repo = join(base, "repo");
    mkdirSync(repo);
    git(["init", "-q", "-b", "main"], repo);
    git(["config", "user.email", "t@t"], repo);
    git(["config", "user.name", "t"], repo);
    writeFileSync(join(repo, "f.txt"), "v1\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);
    git(["branch", "merged-branch"], repo);
    git(["checkout", "-q", "-b", "unmerged-branch"], repo);
    writeFileSync(join(repo, "g.txt"), "x\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "unmerged work"], repo);
    git(["checkout", "-q", "main"], repo);
  });

  afterAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it("AC1: clean + UNMERGED + non-force names the losing commit(s) and BLOCKS", () => {
    const wt = join(base, "wt-ac1-unmerged");
    git(["worktree", "add", "-q", wt, "unmerged-branch"], repo);
    const { code, stderr } = run(`git worktree remove ${wt}`, repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/NOT merged into main/);
    expect(stderr).toContain("unmerged work");
    git(["worktree", "remove", "--force", wt], repo); // cleanup via real git, not the hook
  }, 15000);

  it("AC2: clean + MERGED but reflog active inside the window still BLOCKS, non-force", () => {
    const wt = join(base, "wt-ac2-recent");
    git(["worktree", "add", "-q", wt, "merged-branch"], repo);
    // No backdating: the worktree-add checkout itself is the recent activity.
    const { code, stderr } = run(`git worktree remove ${wt}`, repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/liveness window/);
    expect(stderr).toMatch(/merged into main/);
    git(["worktree", "remove", "--force", wt], repo);
  }, 15000);

  it("AC2 control: the same MERGED worktree, once QUIET, is not blocked for the same reason (isolates the liveness signal from merged-ness)", () => {
    const wt = join(base, "wt-ac2-control");
    git(["worktree", "add", "-q", wt, "merged-branch"], repo);
    backdateReflog(wt, 45);
    const { code } = run(`git worktree remove ${wt}`, repo);
    expect(code).toBe(0);
    git(["worktree", "remove", wt], repo);
  }, 15000);

  it("AC4: clean + MERGED + QUIET + non-force PASSES THROUGH (the mandated post-merge cleanup path)", () => {
    const wt = join(base, "wt-ac4-quiet");
    git(["worktree", "add", "-q", wt, "merged-branch"], repo);
    backdateReflog(wt, WORKTREE_LIVENESS_WINDOW_MINUTES_UNDER_TEST + 15);
    const { code, stderr } = run(`git worktree remove ${wt}`, repo);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    git(["worktree", "remove", wt], repo); // real git accepts it too — proves it was genuinely safe
  }, 15000);

  it("AC4 boundary: exactly at the window edge is NOT yet quiet (>= means the edge itself still passes, one second under still blocks)", () => {
    const atEdge = join(base, "wt-ac4-edge-at");
    git(["worktree", "add", "-q", atEdge, "merged-branch"], repo);
    backdateReflog(atEdge, WORKTREE_LIVENESS_WINDOW_MINUTES_UNDER_TEST);
    expect(run(`git worktree remove ${atEdge}`, repo).code).toBe(0);
    git(["worktree", "remove", atEdge], repo);

    const underEdge = join(base, "wt-ac4-edge-under");
    git(["worktree", "add", "-q", underEdge, "merged-branch"], repo);
    backdateReflog(underEdge, WORKTREE_LIVENESS_WINDOW_MINUTES_UNDER_TEST - 1);
    const { code, stderr } = run(`git worktree remove ${underEdge}`, repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/liveness window/);
    git(["worktree", "remove", "--force", underEdge], repo);
  }, 20000);

  it("AC5 boundary: a DETACHED-HEAD worktree, UNMERGED, does not crash and does not fail open", () => {
    const headSha = spawnSync("git", ["rev-parse", "unmerged-branch"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    const wt = join(base, "wt-ac5-detached-unmerged");
    git(["worktree", "add", "-q", "--detach", wt, headSha], repo);
    const { code, stderr } = run(`git worktree remove ${wt}`, repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/NOT merged into main/);
    expect(stderr).toContain("detached HEAD");
    git(["worktree", "remove", "--force", wt], repo);
  }, 15000);

  it("AC5 boundary: a DETACHED-HEAD worktree, clean + merged + quiet, PASSES THROUGH (no crash, no false block)", () => {
    const headSha = spawnSync("git", ["rev-parse", "main"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    const wt = join(base, "wt-ac5-detached-quiet");
    git(["worktree", "add", "-q", "--detach", wt, headSha], repo);
    backdateReflog(wt, WORKTREE_LIVENESS_WINDOW_MINUTES_UNDER_TEST + 15);
    const { code, stderr } = run(`git worktree remove ${wt}`, repo);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    git(["worktree", "remove", wt], repo);
  }, 15000);

  it("AC1 REGRESSION control: the pre-fix hook (matching --force only) let AC1's exact incident payload through — proves the fix, not the fixture, produces the block", () => {
    // Reconstructs the pre-fix rule literally (drop the OR-with-non-force
    // extension) against the SAME live fixture used by the AC1 test above, so
    // the control is not vacuous: same repo, same unmerged branch, same clean
    // worktree — only the matched pattern differs.
    const wt = join(base, "wt-ac1-control-prefix");
    git(["worktree", "add", "-q", wt, "unmerged-branch"], repo);
    const preFixForceOnly = /\bgit\s+worktree\s+remove\b[^\n]*?\s(--force|-f)(?=\s|$)/;
    expect(preFixForceOnly.test(`git worktree remove ${wt}`)).toBe(false);
    git(["worktree", "remove", "--force", wt], repo);
  });
});
