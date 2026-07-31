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
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync, lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { RealSetupFsWriter } from "../../../src/adapters/real-setup-fs.js";

/**
 * The guard below is a SOURCE assertion, not a behavioural one, because the
 * protection is only as good as its call sites: `remove()` skips the ancestor
 * scan entirely when `boundary` is absent, so a future call site that forgets
 * it silently reinstates the reach-through deletion. No behavioural test of
 * `RealSetupFsWriter` can catch that — the omission lives in the CALLER.
 */
const SETUP_SERVICE_SOURCE = new URL("../../../src/service/setup-service.ts", import.meta.url);

/** Sentinel content — a test that deletes the far-side file cannot fake having preserved it. */
const SSOT_CONTENT = "SSOT: this file lives in the developer's repo, not in the install tree\n";

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
      await writer.remove(file);
      expect(existsSync(file)).toBe(false);
    });
  });

  describe("REGRESSION — every SetupService removal call site declares its boundary", () => {
    it("no writer.remove( call in setup-service.ts omits the boundary option", () => {
      const source = readFileSync(SETUP_SERVICE_SOURCE, "utf8");

      // Control first: if this file stops containing removal calls at all (moved,
      // renamed), the assertion below would pass vacuously.
      const calls = source.match(/await this\.writer\.remove\([^;]*\);/g) ?? [];
      expect(calls.length).toBeGreaterThan(0);

      const missingBoundary = calls.filter((call) => !call.includes("boundary:"));
      expect(missingBoundary).toEqual([]);
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
      // Whatever it does, it must not have reached through into the repo.
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
});
