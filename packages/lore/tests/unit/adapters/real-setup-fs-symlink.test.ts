// @reads packages/lore/src/flows/setup-project-flow.ts
// @reads packages/lore/src/flows/setup-project-uninstall.ts
// @reads packages/lore/src/service/setup-service.ts
// @reads packages/lore/tests/unit/adapters/setup-fs-boundary-required.type-fixture.ts
/**
 * Real-filesystem regression suite for `RealSetupFsWriter`'s removal path
 * (spec-lore-setup-deletes-repo-source-through-dev-symlinks).
 *
 * WHY THIS USES A REAL FILESYSTEM: the defect under test is entirely about
 * `node:fs` link semantics — `existsSync` following a symlink while `rmSync`
 * deletes what it points at. A `MapFs`-style fake models paths as string keys
 * and has no notion of a link, so it CANNOT reproduce this class of bug. Every
 * test here builds a real link topology under `mkdtemp` and asserts against
 * real inodes.
 *
 * The load-bearing test is "ancestor symlink — the far-side file survives":
 * it reproduces the measured incident exactly (a 336-line SKILL.md in this
 * repo destroyed twice by `lore setup`) and is the only assertion that would
 * have caught the original defect. All the others guard the edges of the fix.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { RunnerTask } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync, lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { RealSetupFsWriter, removeProjectPath } from "../../../src/adapters/real-setup-fs.js";

/**
 * The guard below is a SOURCE assertion, not a behavioural one, because the
 * protection is only as good as its call sites: `remove()` skips the ancestor
 * scan entirely when `boundary` is absent, so a future call site that forgets
 * it silently reinstates the reach-through deletion. No behavioural test of
 * `RealSetupFsWriter` can catch that — the omission lives in the CALLER.
 */
const SETUP_SERVICE_SOURCE = new URL("../../../src/service/setup-service.ts", import.meta.url);
const PROJECT_UNINSTALL_SOURCE = new URL("../../../src/flows/setup-project-uninstall.ts", import.meta.url);
const PROJECT_FLOW_SOURCE = new URL("../../../src/flows/setup-project-flow.ts", import.meta.url);

/** Sentinel content — a test that deletes the far-side file cannot fake having preserved it. */
const SSOT_CONTENT = "SSOT: this file lives in the developer's repo, not in the install tree\n";

/**
 * AC-SL-7's negative control lives in a non-`.test.ts` fixture because it
 * asserts a COMPILE-TIME property (its oracle is `tsc`, not a runner). Nothing
 * in a test run would notice if it were deleted, so the case below pins it.
 */
const TYPE_FIXTURE_SOURCE = new URL("./setup-fs-boundary-required.type-fixture.ts", import.meta.url);

/** This file's own source — read by the membership floor to detect DISABLED cases (see below). */
const OWN_SOURCE = new URL(import.meta.url);

/**
 * AC-SL-8 — monotonic floor on this suite's COLLECTED case count, set to the
 * count measured when D8 landed.
 *
 * WHY A FLOOR AND NOT A TOTAL: an earlier revision of this spec hardcoded an
 * exact total, which drifted silently as the suite grew and had to be chased on
 * every addition. A floor lets the suite grow freely while still going red the
 * moment a case is DELETED.
 *
 * WHY IT EXISTS AT ALL: an independent review found that AC-SL-4 ("the whole
 * suite passes with zero failures") also passes if the suite SHRINKS — deleting
 * the ancestor-refusal case leaves zero failures and exit 0, a passing oracle
 * over an emptied guarantee. Zero failures says nothing about membership.
 *
 * Raise this ONLY when adding cases, never to accommodate a deletion: a red
 * floor means a guarantee left the suite, and the fix is to restore the case,
 * not to lower the number.
 *
 * MEASURED SCOPE — the count catches DELETION, not DISABLING. Verified both
 * directions: physically removing one case reports "expected 20 to be greater
 * than or equal to 21" (exit 1), but converting the same case to `it.skip`
 * leaves it COLLECTED, so the count stays 21 and this assertion passes (exit 0).
 * The count cannot be narrowed to non-skipped cases to fix that, because the
 * AC's own oracle command runs this file under `-t`, which marks every unmatched
 * case skipped too — the two are indistinguishable from inside the run. So
 * disabling is covered by a SEPARATE source-level assertion in the same case
 * below, and the two together span the hole.
 */
const SUITE_CASE_FLOOR = 21;

/**
 * Counts every COLLECTED case in a vitest task tree — not merely the executed
 * ones.
 *
 * The distinction is load-bearing: AC-SL-8's own oracle command runs this file
 * under `-t 'suite membership floor'`, so exactly ONE case executes while every
 * other is collected-then-skipped. Counting executions would report 1 under that
 * filter and make the floor unassertable (or worse, quietly satisfiable);
 * counting collection sees the whole suite either way. Measured under both a
 * filtered and an unfiltered run before this was wired.
 */
function countCollectedCases(tasks: readonly RunnerTask[]): number {
  let total = 0;
  for (const task of tasks) {
    if (task.type === "test") total += 1;
    else total += countCollectedCases(task.tasks);
  }
  return total;
}

describe("RealSetupFsWriter removal never resolves through a symlink", () => {
  let root: string;
  /** Stands in for the developer's repo (`<repo>/assets/...`). */
  let repoDir: string;
  /** Stands in for the install target (`~/.claude`). */
  let targetDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lore-setup-symlink-"));
    repoDir = join(root, "repo", "assets");
    targetDir = join(root, "claude");
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("REGRESSION — the measured incident", () => {
    it("ancestor symlink — the far-side file survives and the removal is refused by name", async () => {
      // Exact topology of the incident: the dev symlinks an install SUBDIRECTORY
      // at <targetDir>/skills/lore-init-context into their repo, and the retired
      // path lore wants gone is the FILE nested inside it.
      const repoSkillDir = join(repoDir, "skills", "lore-init-context");
      mkdirSync(repoSkillDir, { recursive: true });
      const repoSsot = join(repoSkillDir, "SKILL.md");
      writeFileSync(repoSsot, SSOT_CONTENT);

      mkdirSync(join(targetDir, "skills"), { recursive: true });
      const linkPath = join(targetDir, "skills", "lore-init-context");
      symlinkSync(repoSkillDir, linkPath);

      const writer = new RealSetupFsWriter();
      const doomedPath = join(linkPath, "SKILL.md");

      await expect(writer.remove(doomedPath, { boundary: targetDir })).rejects.toThrow(/symlink/i);

      // The whole point. Before the fix, this file was gone.
      expect(existsSync(repoSsot)).toBe(true);
      expect(readFileSync(repoSsot, "utf8")).toBe(SSOT_CONTENT);
      // The link itself is left alone: it may carry other, non-retired assets,
      // so unlinking it to delete one retired file would trade one data loss
      // for another (spec D3).
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    });

    it("the refusal names both the offending ancestor and the path it would have deleted", async () => {
      const repoSkillDir = join(repoDir, "skills", "s");
      mkdirSync(repoSkillDir, { recursive: true });
      writeFileSync(join(repoSkillDir, "SKILL.md"), SSOT_CONTENT);
      mkdirSync(join(targetDir, "skills"), { recursive: true });
      const linkPath = join(targetDir, "skills", "s");
      symlinkSync(repoSkillDir, linkPath);

      const writer = new RealSetupFsWriter();
      const doomedPath = join(linkPath, "SKILL.md");

      // A refusal a human cannot act on is barely better than the deletion —
      // it must name the link to unlink and the path that was spared.
      await expect(writer.remove(doomedPath, { boundary: targetDir })).rejects.toThrow(linkPath);
      await expect(writer.remove(doomedPath, { boundary: targetDir })).rejects.toThrow(doomedPath);
    });
  });

  describe("HAPPY — a target that IS a symlink is unlinked, never followed", () => {
    it("unlinks the link and leaves its target file intact", async () => {
      const repoFile = join(repoDir, "governance.md");
      writeFileSync(repoFile, SSOT_CONTENT);
      const linkPath = join(targetDir, "governance.md");
      symlinkSync(repoFile, linkPath);

      const writer = new RealSetupFsWriter();
      await writer.remove(linkPath, { boundary: targetDir });

      expect(existsSync(linkPath)).toBe(false);
      expect(existsSync(repoFile)).toBe(true);
      expect(readFileSync(repoFile, "utf8")).toBe(SSOT_CONTENT);
    });

    it("unlinks a symlinked DIRECTORY without recursing into the repo tree", async () => {
      const repoSubdir = join(repoDir, "skills", "kept");
      mkdirSync(repoSubdir, { recursive: true });
      const keptFile = join(repoSubdir, "SKILL.md");
      writeFileSync(keptFile, SSOT_CONTENT);
      const linkPath = join(targetDir, "kept");
      symlinkSync(repoSubdir, linkPath);

      const writer = new RealSetupFsWriter();
      await writer.remove(linkPath, { boundary: targetDir });

      expect(existsSync(linkPath)).toBe(false);
      expect(existsSync(keptFile)).toBe(true);
    });
  });

  describe("BOUNDARY", () => {
    it("a dangling symlink is removed rather than treated as absent", async () => {
      // `existsSync` reports FALSE for a dangling link (it follows), so the old
      // guard skipped it and left the link behind forever. `lstat` sees it.
      const linkPath = join(targetDir, "dangling.md");
      symlinkSync(join(repoDir, "never-existed.md"), linkPath);
      expect(existsSync(linkPath)).toBe(false);
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);

      const writer = new RealSetupFsWriter();
      await writer.remove(linkPath, { boundary: targetDir });

      expect(lstatSync.bind(null, linkPath)).toThrow();
    });

    it("a symlink ABOVE the boundary does not trigger a refusal", async () => {
      // Someone whose entire ~/.claude is a symlink is a legitimate setup with
      // nothing to do with this defect; scanning to the filesystem root would
      // refuse every removal for them (spec D4).
      const realClaude = join(root, "real-claude");
      mkdirSync(join(realClaude, "hooks"), { recursive: true });
      const installed = join(realClaude, "hooks", "h.mjs");
      writeFileSync(installed, "installed copy\n");

      const linkedTarget = join(root, "linked-claude");
      symlinkSync(realClaude, linkedTarget);

      const writer = new RealSetupFsWriter();
      // boundary IS the symlinked dir — everything scanned is strictly inside it.
      await writer.remove(join(linkedTarget, "hooks", "h.mjs"), { boundary: linkedTarget });

      expect(existsSync(installed)).toBe(false);
    });

    it("a missing target stays a silent no-op", async () => {
      const writer = new RealSetupFsWriter();
      await expect(writer.remove(join(targetDir, "nope.md"), { boundary: targetDir })).resolves.toBeUndefined();
    });
  });

  describe("ERROR — a target outside its boundary fails loud instead of skipping the check", () => {
    // The original code returned null here, which SKIPPED the ancestor scan —
    // dropping the protection precisely when the arguments stopped making sense.
    // Review found it reachable on a case-insensitive filesystem: a boundary
    // differing only in case makes the prefix test false and the removal then
    // proceeds through a symlink.
    it("throws rather than removing when the path does not resolve inside the boundary", async () => {
      const outside = join(root, "outside");
      mkdirSync(outside, { recursive: true });
      const file = join(outside, "f.md");
      writeFileSync(file, "not ours\n");

      const writer = new RealSetupFsWriter();
      await expect(writer.remove(file, { boundary: targetDir })).rejects.toThrow(/does not resolve inside/i);
      expect(existsSync(file)).toBe(true);
    });

    it("a boundary differing only in case is rejected, not silently unprotected", async () => {
      const victim = join(repoDir, "cased-victim.md");
      writeFileSync(victim, SSOT_CONTENT);
      const dir = join(targetDir, "CasedDir");
      mkdirSync(dir, { recursive: true });
      const linkPath = join(dir, "link");
      symlinkSync(repoDir, linkPath);

      const writer = new RealSetupFsWriter();
      // Same tree, boundary spelled with different case.
      await expect(
        writer.remove(join(linkPath, "cased-victim.md"), { boundary: targetDir.toUpperCase() }),
      ).rejects.toThrow();
      expect(existsSync(victim)).toBe(true);
      expect(readFileSync(victim, "utf8")).toBe(SSOT_CONTENT);
    });

    it("a target EQUAL to the boundary is allowed (no ancestors inside it to scan)", async () => {
      const selfDir = join(root, "self");
      mkdirSync(join(selfDir, "child"), { recursive: true });
      const writer = new RealSetupFsWriter();
      await writer.remove(selfDir, { boundary: selfDir });
      expect(existsSync(selfDir)).toBe(false);
    });
  });

  describe("STATE — ordinary installs are unaffected", () => {
    it("removes a real nested file and a real directory tree exactly as before", async () => {
      const dir = join(targetDir, "hooks", "nested");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, "h.mjs");
      writeFileSync(file, "installed\n");

      const writer = new RealSetupFsWriter();
      await writer.remove(file, { boundary: targetDir });
      expect(existsSync(file)).toBe(false);

      // Directory removal keeps its recursive behaviour for real (non-link) trees.
      writeFileSync(join(dir, "again.mjs"), "installed\n");
      await writer.remove(join(targetDir, "hooks"), { boundary: targetDir });
      expect(existsSync(join(targetDir, "hooks"))).toBe(false);
    });

    it("omitting the boundary keeps the call working (no ancestor scan requested)", async () => {
      const file = join(targetDir, "plain.md");
      writeFileSync(file, "installed\n");
      const writer = new RealSetupFsWriter();
      // The `@ts-expect-error` below is LOAD-BEARING, not a suppression. D8 makes
      // `boundary` a REQUIRED property, so this call is a compile error by design
      // — while the RUNTIME tolerance stays reachable and stays tested, because a
      // runtime that reinterpreted a missing boundary as "scan to the filesystem
      // root" would refuse every removal for anyone whose install root is itself
      // a symlink (the exact case D4 exists to avoid).
      //
      // It doubles as a negative control for AC-SL-7: if the signature is ever
      // quietly reverted to optional, this directive becomes UNUSED and
      // `bun run typecheck` fails with TS2578. Measured both directions.
      // @ts-expect-error — D8: boundary is required at the type level; the runtime still tolerates its absence.
      await writer.remove(file);
      expect(existsSync(file)).toBe(false);
    });
  });

  describe("REGRESSION — every removal call site declares its boundary", () => {
    // `[^;]*` deliberately spans newlines (a negated character class matches \n),
    // so a call reformatted across multiple lines is still captured. The pattern
    // deliberately does NOT require `await`: an earlier version keyed on it, and
    // a fire-and-forget `void this.writer.remove(...)` was invisible to the scan
    // while the test's own wording claimed to pin "no removal call site".
    // Syntactic scans overclaim by default — keep the prefix as short as the
    // call itself allows.
    it.each([
      { label: "setup-service.ts (machine install)", source: SETUP_SERVICE_SOURCE, pattern: /this\.writer\.remove\([^;]*\);/g },
      { label: "setup-project-uninstall.ts (per-repo scaffold)", source: PROJECT_UNINSTALL_SOURCE, pattern: /\bfs\.remove\([^;]*\);/g },
      // Third file added after a second review found a FOURTH unprotected call
      // site here — reachable from an ordinary `lore setup --project` re-run, not
      // just uninstall. Two rounds of fixes and one review pass all enumerated
      // call sites by memory of which files "the fix touched"; this pin exists so
      // enumeration stops depending on that.
      { label: "setup-project-flow.ts (scaffold write path)", source: PROJECT_FLOW_SOURCE, pattern: /\bdeps\.fs\.remove\([^;]*\);/g },
    ])("no removal call in $label omits the boundary option", ({ source, pattern }) => {
      const text = readFileSync(source, "utf8");

      // Control first: if a file stops containing removal calls at all (moved,
      // renamed), the assertion below would pass vacuously.
      const calls = text.match(pattern) ?? [];
      expect(calls.length).toBeGreaterThan(0);

      const missingBoundary = calls.filter((call) => !call.includes("boundary:"));
      expect(missingBoundary).toEqual([]);
    });
  });

  describe("REGRESSION — removeProjectPath carries the same protection", () => {
    // `lore setup --project --uninstall` feeds this sync twin repo-relative
    // tracked paths. It shipped with the identical existsSync + rmSync shape, so
    // fixing only the machine-install writer would have left half the defect.
    it("refuses an ancestor symlink and leaves the far-side file intact", () => {
      const victimDir = join(repoDir, "elsewhere");
      mkdirSync(victimDir, { recursive: true });
      const victim = join(victimDir, "hook.mjs");
      writeFileSync(victim, SSOT_CONTENT);

      const repo = join(root, "scaffolded-repo");
      mkdirSync(join(repo, ".claude"), { recursive: true });
      const linkPath = join(repo, ".claude", "hooks");
      symlinkSync(victimDir, linkPath);

      expect(() => removeProjectPath(join(linkPath, "hook.mjs"), { boundary: repo })).toThrow(/symlink/i);
      expect(existsSync(victim)).toBe(true);
      expect(readFileSync(victim, "utf8")).toBe(SSOT_CONTENT);
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    });

    it("unlinks a link target rather than following it, and still removes real paths", () => {
      const realFile = join(repoDir, "real.md");
      writeFileSync(realFile, SSOT_CONTENT);
      const repo = join(root, "scaffold2");
      mkdirSync(repo, { recursive: true });

      const linkPath = join(repo, "linked.md");
      symlinkSync(realFile, linkPath);
      removeProjectPath(linkPath, { boundary: repo });
      expect(existsSync(linkPath)).toBe(false);
      expect(existsSync(realFile)).toBe(true);

      const plain = join(repo, "plain.md");
      writeFileSync(plain, "scaffolded\n");
      removeProjectPath(plain, { boundary: repo });
      expect(existsSync(plain)).toBe(false);

      // A missing target stays a no-op, and omitting the boundary still works at
      // RUNTIME. Same load-bearing `@ts-expect-error` as the writer's twin above
      // (D8 / AC-SL-7) — the type forbids it, the runtime tolerates it.
      expect(() =>
        // @ts-expect-error — D8: boundary is required at the type level; the runtime still tolerates its absence.
        removeProjectPath(join(repo, "absent.md")),
      ).not.toThrow();
    });
  });

  describe("ERROR — removeDirIfEmpty must not abort the run on a symlink", () => {
    it("does not throw ENOTDIR when a symlink sits at the directory position", async () => {
      const repoSubdir = join(repoDir, "skills", "x");
      mkdirSync(repoSubdir, { recursive: true });
      writeFileSync(join(repoSubdir, "SKILL.md"), SSOT_CONTENT);
      const linkPath = join(targetDir, "x");
      symlinkSync(repoSubdir, linkPath);

      const writer = new RealSetupFsWriter();
      // Before the fix this threw ENOTDIR, which aborted the whole setup run
      // AFTER the irreversible deletion had already committed.
      await expect(writer.removeDirIfEmpty(linkPath)).resolves.toBeUndefined();
      // Pin the behaviour, do not merely tolerate it: the sweep's contract is
      // "clean up directories our removals emptied", and a developer's symlink is
      // not such a directory — so the LINK must still be there afterwards, and
      // nothing may have been reached through into the repo. Left unpinned, this
      // could silently drift into unlinking a link lore never created.
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(existsSync(join(repoSubdir, "SKILL.md"))).toBe(true);
    });

    it("still swallows ENOTEMPTY and ENOENT, and still removes a genuinely empty dir", async () => {
      const writer = new RealSetupFsWriter();

      const nonEmpty = join(targetDir, "nonempty");
      mkdirSync(nonEmpty);
      writeFileSync(join(nonEmpty, "f"), "x");
      await expect(writer.removeDirIfEmpty(nonEmpty)).resolves.toBeUndefined();
      expect(existsSync(nonEmpty)).toBe(true);

      await expect(writer.removeDirIfEmpty(join(targetDir, "absent"))).resolves.toBeUndefined();

      const empty = join(targetDir, "empty");
      mkdirSync(empty);
      await writer.removeDirIfEmpty(empty);
      expect(existsSync(empty)).toBe(false);
    });
  });

  describe("REGRESSION — D8's enforcement cannot be silently emptied", () => {
    it("suite membership floor — the collected case count never shrinks (AC-SL-8)", (ctx) => {
      // AC-SL-4 asserts this suite passes with ZERO FAILURES, which an
      // independent review showed is also true of a suite that SHRANK: delete
      // the ancestor-refusal case and you still get zero failures and exit 0 —
      // a green oracle over an emptied guarantee. Membership needs its own pin.
      const collected = countCollectedCases(ctx.task.file.tasks);
      expect(collected).toBeGreaterThanOrEqual(SUITE_CASE_FLOOR);

      // Second, INDEPENDENT condition — the count above cannot see a DISABLED
      // case (`it.skip` stays collected; measured: count still 21, still green),
      // and it cannot be narrowed to non-skipped cases because this AC's own
      // oracle runs under `-t`, which marks every unmatched case skipped as well.
      // So disabling is caught at the source level instead. `it.only` is included
      // because it silently EXCLUDES every other case in the file — the same
      // emptied-guarantee outcome as deleting them, reached from the other side.
      const ownText = readFileSync(OWN_SOURCE, "utf8");
      // Control: a mistyped read or a moved file would make the assertion below
      // pass vacuously against an empty/foreign string.
      expect(ownText).toContain(`const SUITE_CASE_FLOOR = ${SUITE_CASE_FLOOR}`);
      // Line-ANCHORED on purpose: a real call site is always `<indent>it.skip(`,
      // whereas the prose above discusses these tokens mid-line after `//` or
      // `*`. An unanchored pattern would match this file's own comments and fail
      // instantly — a self-defeating assertion, not a guard.
      const disabled = ownText.match(/^[ \t]*(?:it|test|describe)\.(?:skip|todo|only)\b/gm) ?? [];
      expect(disabled).toEqual([]);
    });

    it("spec-lore-setup-deletes-repo-source-through-dev-symlinks#AC-SL-7's negative-control fixture is present and still discriminates", () => {
      // The control for AC-SL-7 is a `tsc` artifact, so NO test run would notice
      // if it were deleted — every test here would still pass while the AC
      // silently became "a required signature also typechecks", which is
      // vacuous. This case is that fixture's tripwire; the membership floor
      // above is in turn the tripwire for this case being deleted.
      const text = readFileSync(TYPE_FIXTURE_SOURCE, "utf8");

      // The directives ARE the control: each asserts that a call omitting
      // `boundary` is a compile error. Revert any signature to optional and they
      // all become unused → TS2578 → `bun run typecheck` fails.
      const directives = text.match(/@ts-expect-error/g) ?? [];
      expect(directives.length).toBeGreaterThanOrEqual(5);

      // Positive controls must survive too, and this is not symmetry for its own
      // sake: without a call that DOES pass the boundary, a signature mangled
      // into rejecting EVERYTHING would satisfy every directive above and let
      // the fixture pass while the port was unusable.
      const withBoundary = text.match(/\{\s*boundary:\s*BOUNDARY\s*\}/g) ?? [];
      expect(withBoundary.length).toBeGreaterThanOrEqual(5);
    });
  });
});
