/**
 * `packages/lore/src/adapters/real-fs-probe.ts::buildRealFsProbe` — symlink-escape
 * containment guard (BUG-015). The pre-fix implementation resolved every anchor path
 * via plain `statSync`/`readFileSync`/`readdirSync`, which follow symlinks by
 * default; a repo-internal symlink pointing OUTSIDE the repo root previously probed
 * SUCCESSFULLY, reporting content/listing sourced from outside the repository and
 * defeating the whole point of a repo-scoped drift oracle (SPEC-045).
 *
 * Fixture: real `mkdtempSync` directories (no mocking of `node:fs`) — a "repo" dir
 * and a SIBLING "secret" dir outside it, with a symlink inside "repo" pointing at
 * the sibling. Proves containment against the REAL filesystem, not a stubbed one.
 *
 * Runner: vitest (no `bun:sqlite` involved — `buildRealFsProbe` is pure `node:fs`).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a repo-internal symlink resolving to legitimate in-repo content —
 *               REGRESSION baseline, must keep working post-fix
 *   NEGATIVE:   a genuinely missing path — untouched by the escape guard, still
 *               collapses to "missing" / null (pre-existing G11 contract)
 *   BOUNDARY:   a symlink target that IS the repo root itself (not a descendant) —
 *               must be treated as WITHIN the root, not an escape
 *   ERROR:      an escaping symlink for each of `stat` (throws)/`readFile` (null)/
 *               `listDir` (null) — the two FsProbe-contract-legal failure signals
 *   STATE:      a symlinked DIRECTORY escape (not just a file) for stat + listDir
 *   REGRESSION: `repoRoot` itself sitting behind a symlink (e.g. macOS /tmp ->
 *               /private/tmp, mkdtempSync's own default base) must NOT false-positive
 *               every anchor as an escape
 *
 * Source: SPEC-045 §Design Decisions D4; BUG-015 (symlink-escape hardening).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRealFsProbe } from "../../../src/adapters/real-fs-probe.js";

let baseDir: string;
let repoRoot: string;
let siblingDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "lore-fsprobe-"));
  repoRoot = join(baseDir, "repo");
  siblingDir = join(baseDir, "secret-sibling");
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(siblingDir, { recursive: true });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

// ─── HAPPY: repo-internal symlink resolving to legitimate in-repo content ─────

describe("buildRealFsProbe — repo-internal symlink to in-repo content (HAPPY, REGRESSION baseline)", () => {
  it("stat/readFile/listDir all succeed for a symlink whose target stays within the repo", () => {
    writeFileSync(join(repoRoot, "real-file.txt"), "hello from inside the repo");
    symlinkSync(join(repoRoot, "real-file.txt"), join(repoRoot, "link-to-real.txt"));

    mkdirSync(join(repoRoot, "real-dir"));
    writeFileSync(join(repoRoot, "real-dir", "child.txt"), "child content");
    symlinkSync(join(repoRoot, "real-dir"), join(repoRoot, "link-to-real-dir"));

    const probe = buildRealFsProbe(repoRoot);

    expect(probe.stat("link-to-real.txt")).toBe("file");
    expect(probe.readFile("link-to-real.txt")).toBe("hello from inside the repo");

    expect(probe.stat("link-to-real-dir")).toBe("dir");
    expect(probe.listDir("link-to-real-dir")).toEqual(["child.txt"]);
  });

  it("a plain (non-symlink) file/dir probes normally, unaffected by the containment guard", () => {
    writeFileSync(join(repoRoot, "plain.txt"), "plain content");
    mkdirSync(join(repoRoot, "plain-dir"));
    writeFileSync(join(repoRoot, "plain-dir", "a.txt"), "a");

    const probe = buildRealFsProbe(repoRoot);

    expect(probe.stat("plain.txt")).toBe("file");
    expect(probe.readFile("plain.txt")).toBe("plain content");
    expect(probe.stat("plain-dir")).toBe("dir");
    expect(probe.listDir("plain-dir")).toEqual(["a.txt"]);
  });
});

// ─── NEGATIVE: genuinely missing path — unaffected by the escape guard ────────

describe("buildRealFsProbe — genuinely missing path (NEGATIVE)", () => {
  it("collapses to missing/null exactly as before the escape guard, for a path that never existed", () => {
    const probe = buildRealFsProbe(repoRoot);

    expect(probe.stat("does/not/exist.txt")).toBe("missing");
    expect(probe.readFile("does/not/exist.txt")).toBeNull();
    expect(probe.listDir("does/not/exist-dir")).toBeNull();
  });

  it("a dangling symlink (target does not exist) collapses to missing, not an escape error", () => {
    symlinkSync(join(repoRoot, "never-created.txt"), join(repoRoot, "dangling-link.txt"));
    const probe = buildRealFsProbe(repoRoot);

    // realpathSync on a dangling symlink throws ENOENT — same "genuinely
    // doesn't exist" collapse as any other missing path, untouched by BUG-015.
    expect(probe.stat("dangling-link.txt")).toBe("missing");
    expect(probe.readFile("dangling-link.txt")).toBeNull();
  });
});

// ─── BOUNDARY: symlink target IS the repo root itself ─────────────────────────

describe("buildRealFsProbe — symlink target is the repo root itself (BOUNDARY)", () => {
  it("treats a symlink resolving to repoRoot itself as WITHIN the root, not an escape", () => {
    symlinkSync(repoRoot, join(repoRoot, "link-to-self"));
    const probe = buildRealFsProbe(repoRoot);

    // resolved === realRepoRoot exactly (not a descendant) — isWithinRoot's
    // own-root branch, distinct from the sep-prefixed descendant check.
    expect(probe.stat("link-to-self")).toBe("dir");
    expect(probe.listDir("link-to-self")).toContain("link-to-self");
  });
});

// ─── ERROR: escaping symlink — stat throws, readFile/listDir return null ──────

describe("buildRealFsProbe — symlink escaping the repo root (ERROR)", () => {
  it("stat() THROWS (never collapses to 'missing') for a symlinked FILE escape", () => {
    writeFileSync(join(siblingDir, "secret.txt"), "top secret sibling content");
    symlinkSync(join(siblingDir, "secret.txt"), join(repoRoot, "escape-link.txt"));

    const probe = buildRealFsProbe(repoRoot);

    expect(() => probe.stat("escape-link.txt")).toThrow(/outside repo root/);
  });

  it("readFile() returns null (never the sibling's real content) for the same escape", () => {
    writeFileSync(join(siblingDir, "secret.txt"), "top secret sibling content");
    symlinkSync(join(siblingDir, "secret.txt"), join(repoRoot, "escape-link.txt"));

    const probe = buildRealFsProbe(repoRoot);

    expect(probe.readFile("escape-link.txt")).toBeNull();
  });

  it("listDir() returns null (never the sibling's real listing) for a symlinked DIRECTORY escape", () => {
    writeFileSync(join(siblingDir, "leaked.txt"), "leaked");
    symlinkSync(siblingDir, join(repoRoot, "escape-dir-link"));

    const probe = buildRealFsProbe(repoRoot);

    expect(probe.listDir("escape-dir-link")).toBeNull();
  });

  it("stat() also throws for a symlinked DIRECTORY escape (STATE — distinct from the file-escape case)", () => {
    symlinkSync(siblingDir, join(repoRoot, "escape-dir-link"));
    const probe = buildRealFsProbe(repoRoot);

    expect(() => probe.stat("escape-dir-link")).toThrow(/outside repo root/);
  });

  it("a nested escaping symlink (subdirectory -> sibling) is caught identically to a top-level one", () => {
    mkdirSync(join(repoRoot, "nested", "deep"), { recursive: true });
    writeFileSync(join(siblingDir, "secret.txt"), "nested escape target");
    symlinkSync(join(siblingDir, "secret.txt"), join(repoRoot, "nested", "deep", "escape.txt"));

    const probe = buildRealFsProbe(repoRoot);

    expect(() => probe.stat("nested/deep/escape.txt")).toThrow(/outside repo root/);
    expect(probe.readFile("nested/deep/escape.txt")).toBeNull();
  });
});

// ─── REGRESSION: repoRoot itself sitting behind a symlink (e.g. /tmp -> /private/tmp) ─

describe("buildRealFsProbe — repoRoot itself resolves through a symlink (REGRESSION)", () => {
  it("does not false-positive every anchor as an escape when repoRoot's OWN path is symlink-backed", () => {
    // Simulates macOS's /tmp -> /private/tmp (mkdtempSync's own default base):
    // repoRoot is reached via a symlinked ANCESTOR directory, not `repoRoot`
    // resolving to a *different* location — realpathSync(repoRoot) still
    // equals realpathSync(anything under it) modulo the anchor's own suffix,
    // so this must NOT throw for ordinary in-repo content.
    const realBase = join(baseDir, "real-base");
    mkdirSync(realBase, { recursive: true });
    const symlinkedBase = join(baseDir, "symlinked-base");
    symlinkSync(realBase, symlinkedBase);

    const repoViaSymlink = join(symlinkedBase, "repo");
    mkdirSync(repoViaSymlink, { recursive: true });
    writeFileSync(join(repoViaSymlink, "ordinary.txt"), "ordinary in-repo content");

    // Construct the probe using the SYMLINK-BACKED path, exactly as
    // `process.cwd()` would hand it to `buildRealFsProbe` on a machine whose
    // tmpdir/home is itself behind a symlink.
    const probe = buildRealFsProbe(repoViaSymlink);

    expect(probe.stat("ordinary.txt")).toBe("file");
    expect(probe.readFile("ordinary.txt")).toBe("ordinary in-repo content");
  });

  it("still catches a genuine escape even when repoRoot itself is symlink-backed", () => {
    const realBase = join(baseDir, "real-base-2");
    mkdirSync(realBase, { recursive: true });
    const symlinkedBase = join(baseDir, "symlinked-base-2");
    symlinkSync(realBase, symlinkedBase);

    const repoViaSymlink = join(symlinkedBase, "repo");
    mkdirSync(repoViaSymlink, { recursive: true });
    writeFileSync(join(siblingDir, "secret.txt"), "still secret");
    symlinkSync(join(siblingDir, "secret.txt"), join(repoViaSymlink, "escape.txt"));

    const probe = buildRealFsProbe(repoViaSymlink);

    expect(() => probe.stat("escape.txt")).toThrow(/outside repo root/);
  });
});

// ─── Default repoRoot (process.cwd()) construction still works ────────────────

describe("buildRealFsProbe — default repoRoot argument", () => {
  it("constructs without throwing when repoRoot is omitted (defaults to process.cwd())", () => {
    expect(() => buildRealFsProbe()).not.toThrow();
  });
});
