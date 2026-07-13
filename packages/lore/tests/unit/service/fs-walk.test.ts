/**
 * Unit tests for walkFiles() in packages/lore/src/service/fs-walk.ts.
 *
 * Spec-first design: expected values are derived from the module's own JSDoc
 * header contract (Dirent-based recursive walk, depth-first, extension filter
 * via node:path's extname(), `recursive` defaults true, `onError` defaults
 * "throw" vs "skip" is per-subdirectory) BEFORE reading the implementation body.
 *
 * This module is the byte-identical-preservation contract for a refactor
 * extracting a duplicated directory-walk out of migration-service.ts,
 * export-docs-service.ts, and eval/scenarios/migration-coverage.ts — tests
 * assert what the module is DOCUMENTED to do, not a convenient simplification.
 *
 * Uses a real temp filesystem (mkdtempSync). No mocks.
 * Runs under vitest (no bun:sqlite dependency).
 *
 * Coverage dimensions: HAPPY / BOUNDARY / ERROR
 *
 * @spec_ref AC-FSWALK — fs-walk.ts module header (extension filter, recursive, onError)
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walkFiles } from "../../../src/service/fs-walk.js";

// ─── Temp Directory Lifecycle ─────────────────────────────────────────────────

const tmpDirs: string[] = [];
// Directories that were deliberately chmod'd unreadable during a test — must be
// restored to a removable mode before rmSync in afterEach, or cleanup throws.
const restrictedDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-fswalk-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of restrictedDirs.splice(0)) {
    try {
      chmodSync(dir, 0o755);
    } catch {
      // best-effort restore; rmSync below will surface any real problem
    }
  }
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Some environments (notably running as root, or certain CI containers) do not
 * actually enforce 0o000 permissions on readdirSync. Detect this so the
 * onError:"skip"/"throw" tests degrade gracefully instead of false-failing.
 */
function chmodActuallyRestrictsReaddir(dir: string): boolean {
  chmodSync(dir, 0o000);
  restrictedDirs.push(dir);
  try {
    readdirSync(dir);
    return false; // read succeeded despite 0o000 — chmod is not enforced here
  } catch {
    return true;
  }
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY — nested directories with extension filter", () => {
  it("returns exactly the matching files across a nested tree, excluding non-matching extensions", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "sub", "deeper"), { recursive: true });
    writeFileSync(join(root, "a.md"), "a");
    writeFileSync(join(root, "sub", "b.md"), "b");
    writeFileSync(join(root, "sub", "deeper", "c.md"), "c");
    writeFileSync(join(root, "other.txt"), "not markdown");

    const result = walkFiles(root, { extensions: [".md"] });

    expect(result.sort()).toEqual(
      [
        join(root, "a.md"),
        join(root, "sub", "b.md"),
        join(root, "sub", "deeper", "c.md"),
      ].sort(),
    );
    expect(result).not.toContain(join(root, "other.txt"));
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY — empty directory", () => {
  it("returns an empty array for a directory with no entries", () => {
    const root = makeTempDir();
    expect(walkFiles(root)).toEqual([]);
  });
});

describe("BOUNDARY — single file, extension filter excludes a sibling", () => {
  it("returns exactly the one matching file, excluding a non-matching sibling", () => {
    const root = makeTempDir();
    writeFileSync(join(root, "keep.md"), "keep");
    writeFileSync(join(root, "skip.txt"), "skip");

    const result = walkFiles(root, { extensions: [".md"] });

    expect(result).toEqual([join(root, "keep.md")]);
    expect(result).not.toContain(join(root, "skip.txt"));
  });

  it("no extensions option ⇒ every file entry is included regardless of extension", () => {
    const root = makeTempDir();
    writeFileSync(join(root, "keep.md"), "keep");
    writeFileSync(join(root, "also.txt"), "also");

    const result = walkFiles(root);

    expect(result.sort()).toEqual(
      [join(root, "keep.md"), join(root, "also.txt")].sort(),
    );
  });
});

describe("BOUNDARY — recursive: false excludes subdirectory contents", () => {
  it("only top-level files are returned even though subdirectory files would match the filter", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "top.md"), "top");
    writeFileSync(join(root, "sub", "nested.md"), "nested");

    const result = walkFiles(root, { extensions: [".md"], recursive: false });

    expect(result).toEqual([join(root, "top.md")]);
    expect(result).not.toContain(join(root, "sub", "nested.md"));
  });
});

describe("BOUNDARY — onError: 'skip' only blanks the unreadable subtree", () => {
  it("a sibling directory's files are still returned when one subdirectory is unreadable", () => {
    const root = makeTempDir();
    const blocked = join(root, "blocked");
    const sibling = join(root, "sibling");
    mkdirSync(blocked);
    mkdirSync(sibling);
    writeFileSync(join(blocked, "hidden.md"), "hidden");
    writeFileSync(join(sibling, "visible.md"), "visible");

    if (!chmodActuallyRestrictsReaddir(blocked)) {
      // Running as root or in an environment that ignores 0o000 — chmod-based
      // unreadable-directory simulation is not possible here. Skip rather than
      // false-fail; the "throw" counterpart below applies the same guard.
      return;
    }

    const result = walkFiles(root, { extensions: [".md"], onError: "skip" });

    expect(result).toEqual([join(sibling, "visible.md")]);
    expect(result).not.toContain(join(blocked, "hidden.md"));
  });
});

describe("ERROR — onError: 'throw' (default) propagates an unreadable subdirectory", () => {
  it("walkFiles throws when a subdirectory's readdirSync fails and onError defaults to 'throw'", () => {
    const root = makeTempDir();
    const blocked = join(root, "blocked");
    mkdirSync(blocked);
    writeFileSync(join(blocked, "hidden.md"), "hidden");

    if (!chmodActuallyRestrictsReaddir(blocked)) {
      return;
    }

    expect(() => walkFiles(root, { extensions: [".md"] })).toThrow();
  });

  it("walkFiles throws when a subdirectory's readdirSync fails and onError is explicitly 'throw'", () => {
    const root = makeTempDir();
    const blocked = join(root, "blocked");
    mkdirSync(blocked);
    writeFileSync(join(blocked, "hidden.md"), "hidden");

    if (!chmodActuallyRestrictsReaddir(blocked)) {
      return;
    }

    expect(() => walkFiles(root, { extensions: [".md"], onError: "throw" })).toThrow();
  });
});
