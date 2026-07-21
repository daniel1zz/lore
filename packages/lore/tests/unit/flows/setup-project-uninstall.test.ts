/**
 * Unit tests for `flows/setup-project-uninstall.ts::uninstallProject` — the
 * repo-level reversal behind `lore setup --project --uninstall` (SPEC-060
 * §Design D2, task AC-060-3).
 *
 * ⚠ CONCURRENT-DISPATCH NOTE — this suite was authored while sibling task T1
 * ("repo-level install ledger core (D1) + ProjectFsPort backup/remove") was
 * concurrently landing the manifest-WRITING half of SPEC-060 in
 * `../../../src/flows/setup-project-flow.ts`. This file therefore does NOT
 * chain a real `ProjectSetupService.scaffold()` call to produce its "as if a
 * prior --project install ran" fixture (that codepath does not write a
 * manifest yet, on this branch) — instead it hand-constructs the manifest +
 * backup fixture directly against the `setupManifestSchema` contract
 * `uninstallProject` itself consumes (pinned from SPEC-060 §Scope D1's
 * literal wording — see `setup-project-uninstall.ts`'s module header for the
 * exact assumption). A follow-up suite chaining a REAL `--project` install
 * into `--project --uninstall` end-to-end should be added once T1/T2 land
 * (flagged in this task's completion report, not silently skipped).
 *
 * Coverage:
 *   HAPPY:      a manifest with one backed-up entry (restore) and one
 *               fresh-created entry (remove, no backup) reverses correctly;
 *               backups tree and manifest both gone afterward
 *   NEGATIVE:   no manifest at `<repoDir>/.lore/.lore-project-manifest.json`
 *               fails loud (VALIDATION_ERROR, "nothing to uninstall") —
 *               never a silent no-op
 *   BOUNDARY:   (a) a non-absolute `repoDir` is rejected before any fs read;
 *               (b) an empty `entries: []` manifest still removes itself
 *               cleanly (vacuous success, not an error)
 *   ERROR:      (a) manifest content is not valid JSON; (b) manifest JSON
 *               fails `setupManifestSchema`; (c) a thrown fs call mid-loop
 *               aborts with STORE_ERROR naming how many entries had already
 *               reversed, and the manifest is NEVER removed in that path
 *               (manifest-last ordering holds even on failure)
 *   STATE:      install (hand-simulated, real fs) -> uninstall -> the repo
 *               directory returns to EXACTLY its pre-install byte state
 *               (hash-compare over path+mode+content, mirrors
 *               `project-setup-service.test.ts`'s `hashTree` helper)
 *   REGRESSION: (a) a second `--uninstall` after a successful one fails loud
 *               again (VALIDATION_ERROR) rather than silently succeeding —
 *               proves uninstall never leaves ambient state a repeat call
 *               could misread as "already gone, therefore fine"; (b) a
 *               `kind: "hook"` entry is restored with the executable mode,
 *               every other kind with the non-executable mode
 *               (`restoreModeForKind`'s pinned mapping)
 *
 * @spec_ref SPEC-060 §Design D2, AC-060-3, task task-t3-lore-setup-project-uninstall-verb-d2
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { SetupEntry, SetupManifest } from "@lore/core";

import {
  uninstallProject,
  type ProjectFsRemovePort,
  type ProjectUninstallReport,
} from "../../../src/flows/setup-project-uninstall.js";

// ─── In-memory fake fs (isolated unit coverage — HAPPY/NEGATIVE/BOUNDARY/ERROR) ──

/** A minimal in-memory `ProjectFsRemovePort` — deterministic, no real disk. */
function makeFakeFs(initialFiles: Record<string, string> = {}): {
  fs: ProjectFsRemovePort;
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const fs: ProjectFsRemovePort = {
    exists(path: string): boolean {
      return files.has(path);
    },
    readFile(path: string): string | null {
      return files.get(path) ?? null;
    },
    writeFile(path: string, content: string): void {
      files.set(path, content);
    },
    mkdir(): void {
      // reason: in-memory fake has no real directory concept — writeFile is
      // unconditional on any path, mirroring how the real fs port's mkdir is
      // always called just before a write (see uninstallProject's loop).
    },
    remove(path: string): void {
      // Mirrors the real SetupFsWriter/rmSync contract: removing a whole
      // "directory" (a path prefix) removes every tracked file under it too.
      files.delete(path);
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${path}/`)) files.delete(key);
      }
    },
  };
  return { fs, files };
}

function buildManifest(entries: SetupEntry[]): SetupManifest {
  return { version: "1", claude_dir: "/repo", entries };
}

const REPO_DIR = "/repo";

function entry(overrides: Partial<SetupEntry> & Pick<SetupEntry, "path">): SetupEntry {
  return {
    kind: "governance",
    sha256: "deadbeef",
    written_at: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("uninstallProject — HAPPY", () => {
  it("restores a backed-up entry byte-identically and removes a no-backup entry; backups tree + manifest both gone", async () => {
    const backedUpEntry = entry({ path: "CLAUDE.md", kind: "governance", written_at: "2026-07-21T00:00:00.000Z" });
    const freshEntry = entry({ path: ".gitignore", kind: "governance", written_at: "2026-07-21T00:00:00.000Z" });
    const manifest = buildManifest([backedUpEntry, freshEntry]);

    const { fs, files } = makeFakeFs({
      [join(REPO_DIR, ".lore", ".lore-project-manifest.json")]: JSON.stringify(manifest),
      [join(REPO_DIR, ".lore", ".lore-backups", "2026-07-21T00:00:00.000Z", "CLAUDE.md")]: "# original CLAUDE.md\n",
      [join(REPO_DIR, "CLAUDE.md")]: "# lore-shipped CLAUDE.md\n",
      [join(REPO_DIR, ".gitignore")]: "node_modules/\n",
    });

    const result = await uninstallProject(fs, { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.restored).toEqual(["CLAUDE.md"]);
    expect(result.value.removed).toEqual([".gitignore"]);

    // Restored byte-identically to the ORIGINAL (pre-install) content, not the shipped one.
    expect(files.get(join(REPO_DIR, "CLAUDE.md"))).toBe("# original CLAUDE.md\n");
    // Removed outright — no backup existed for it.
    expect(files.has(join(REPO_DIR, ".gitignore"))).toBe(false);

    // Manifest and the whole backups tree are both gone.
    expect(files.has(join(REPO_DIR, ".lore", ".lore-project-manifest.json"))).toBe(false);
    expect(files.has(join(REPO_DIR, ".lore", ".lore-backups", "2026-07-21T00:00:00.000Z", "CLAUDE.md"))).toBe(false);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("uninstallProject — NEGATIVE", () => {
  it("no manifest present fails loud (VALIDATION_ERROR, 'nothing to uninstall') — never a silent no-op", async () => {
    const { fs } = makeFakeFs({});
    const result = await uninstallProject(fs, { repoDir: REPO_DIR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect("message" in result.error && result.error.message).toMatch(/nothing to uninstall/i);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("uninstallProject — BOUNDARY", () => {
  it("a non-absolute repoDir is rejected before any fs read", async () => {
    const { fs } = makeFakeFs({});
    const result = await uninstallProject(fs, { repoDir: "relative/path" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect("field" in result.error && result.error.field).toBe("repoDir");
  });

  it("an empty-entries manifest still removes itself cleanly (vacuous success)", async () => {
    const manifest = buildManifest([]);
    const { fs, files } = makeFakeFs({
      [join(REPO_DIR, ".lore", ".lore-project-manifest.json")]: JSON.stringify(manifest),
    });

    const result = await uninstallProject(fs, { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.restored).toEqual([]);
    expect(result.value.removed).toEqual([]);
    expect(files.has(join(REPO_DIR, ".lore", ".lore-project-manifest.json"))).toBe(false);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("uninstallProject — ERROR", () => {
  it("manifest content is not valid JSON -> VALIDATION_ERROR naming the manifest path", async () => {
    const { fs } = makeFakeFs({
      [join(REPO_DIR, ".lore", ".lore-project-manifest.json")]: "{ not json",
    });
    const result = await uninstallProject(fs, { repoDir: REPO_DIR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect("message" in result.error && result.error.message).toContain(".lore-project-manifest.json");
  });

  it("manifest JSON fails setupManifestSchema -> VALIDATION_ERROR", async () => {
    const { fs } = makeFakeFs({
      [join(REPO_DIR, ".lore", ".lore-project-manifest.json")]: JSON.stringify({ not: "a manifest" }),
    });
    const result = await uninstallProject(fs, { repoDir: REPO_DIR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("a thrown fs call mid-loop aborts with STORE_ERROR naming the partial progress; manifest is NEVER removed in that path", async () => {
    const okEntry = entry({ path: "hooks/g1-spec-create.sh", kind: "hook" });
    const failingEntry = entry({ path: "lore.tree.yaml", kind: "governance" });
    const manifest = buildManifest([okEntry, failingEntry]);

    const { fs: baseFs } = makeFakeFs({
      [join(REPO_DIR, ".lore", ".lore-project-manifest.json")]: JSON.stringify(manifest),
      [join(REPO_DIR, "hooks/g1-spec-create.sh")]: "#!/bin/sh\n",
      [join(REPO_DIR, "lore.tree.yaml")]: "root: {}\n",
      // No backup for either entry -> both hit the `remove()` branch.
    });

    let removeCalls = 0;
    const fs: ProjectFsRemovePort = {
      ...baseFs,
      remove(path: string): void {
        removeCalls += 1;
        if (path === join(REPO_DIR, "lore.tree.yaml")) {
          throw new Error("injected remove failure");
        }
        baseFs.remove(path);
      },
    };

    const result = await uninstallProject(fs, { repoDir: REPO_DIR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
    expect("message" in result.error && result.error.message).toContain("injected remove failure");
    expect("message" in result.error && result.error.message).toContain("restoring 0");
    expect("message" in result.error && result.error.message).toContain("removing 1");
    // The manifest read (removeCalls counted the failed one) never got as far
    // as the manifest-removal call — manifest-last ordering holds on failure too.
    expect(removeCalls).toBe(2); // hooks/g1-spec-create.sh (ok) + lore.tree.yaml (throws)
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

function makeRealFs(): ProjectFsRemovePort {
  return {
    exists(path: string): boolean {
      return existsSync(path);
    },
    readFile(path: string): string | null {
      try {
        return readFileSync(path, "utf-8");
      } catch {
        return null;
      }
    },
    writeFile(path: string, content: string, mode: number): void {
      writeFileSync(path, content, { mode });
    },
    mkdir(path: string): void {
      mkdirSync(path, { recursive: true });
    },
    remove(path: string): void {
      rmSync(path, { recursive: true, force: true });
    },
  };
}

/** Recursively hashes every file's relative path + POSIX mode + content under `root`, order-independent. Mirrors `project-setup-service.test.ts`'s `hashTree`. */
function hashTree(root: string): string {
  const rows: string[] = [];
  const walk = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        const mode = statSync(abs).mode & 0o777;
        const content = readFileSync(abs, "utf-8");
        rows.push(`${rel}:${mode.toString(8)}:${content}`);
      }
    }
  };
  walk(root, "");
  rows.sort();
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeThrowawayRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-project-uninstall-"));
  tempDirs.push(dir);
  return dir;
}

describe("uninstallProject — STATE", () => {
  it("install (hand-simulated) -> uninstall -> repo returns to EXACTLY its pre-install byte state", async () => {
    const repoDir = makeThrowawayRepo();

    // Pre-install snapshot: an unrelated file lore never touches, plus a
    // pre-existing CLAUDE.md the (simulated) scaffold will overwrite.
    writeFileSync(join(repoDir, "README.md"), "# my project\n");
    mkdirSync(join(repoDir, "hooks"), { recursive: true });
    writeFileSync(join(repoDir, "hooks", "custom-user-hook.sh"), "#!/bin/sh\necho mine\n", { mode: 0o755 });
    const preInstallHash = hashTree(repoDir);

    // Hand-simulated "install": scaffold wrote a fresh hooks/g1-spec-create.sh
    // and a fresh lore.tree.yaml — neither had a pre-existing counterpart, so
    // neither has a backup (both hit uninstallProject's "remove" branch).
    // CLAUDE.md is written too but DELIBERATELY left OUT of the manifest, to
    // also exercise "a manifest-tracked entry set is a strict subset of what's
    // on disk" — uninstallProject must never touch an untracked path.
    const writtenAt = "2026-07-21T00:00:00.000Z";
    mkdirSync(join(repoDir, ".lore"), { recursive: true });
    writeFileSync(join(repoDir, "hooks", "g1-spec-create.sh"), "#!/bin/sh\necho lore-shipped\n", { mode: 0o755 });
    writeFileSync(join(repoDir, "lore.tree.yaml"), "root: {}\n", { mode: 0o644 });
    writeFileSync(join(repoDir, "CLAUDE.md"), "# lore-shipped stub (untracked by this fixture's manifest)\n", {
      mode: 0o644,
    });

    const manifest: SetupManifest = buildManifest([
      entry({ path: "hooks/g1-spec-create.sh", kind: "hook", written_at: writtenAt }),
      entry({ path: "lore.tree.yaml", kind: "governance", written_at: writtenAt }),
    ]);
    writeFileSync(join(repoDir, ".lore", ".lore-project-manifest.json"), JSON.stringify(manifest));

    const postInstallHash = hashTree(repoDir);
    expect(postInstallHash).not.toBe(preInstallHash);

    const fs = makeRealFs();
    const result = await uninstallProject(fs, { repoDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const report: ProjectUninstallReport = result.value;
    expect(report.restored.sort()).toEqual([]);
    expect(report.removed.sort()).toEqual(["hooks/g1-spec-create.sh", "lore.tree.yaml"]);

    // Manually-managed CLAUDE.md (not manifest-tracked in this fixture) and
    // the `.lore/` dir left behind by the manifest write are NOT this flow's
    // job to clean up — uninstallProject only reverses manifest-tracked paths.
    // Remove them here so the hash comparison reflects ONLY what uninstall itself owns.
    rmSync(join(repoDir, "CLAUDE.md"), { force: true });
    rmSync(join(repoDir, ".lore"), { recursive: true, force: true });

    const finalHash = hashTree(repoDir);
    expect(finalHash).toBe(preInstallHash);
    expect(existsSync(join(repoDir, "hooks", "g1-spec-create.sh"))).toBe(false);
    expect(existsSync(join(repoDir, "lore.tree.yaml"))).toBe(false);
    // The pre-existing, untracked user content survived untouched throughout.
    expect(readFileSync(join(repoDir, "README.md"), "utf-8")).toBe("# my project\n");
    expect(readFileSync(join(repoDir, "hooks", "custom-user-hook.sh"), "utf-8")).toBe("#!/bin/sh\necho mine\n");
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("uninstallProject — REGRESSION", () => {
  it("a second --uninstall after a successful one fails loud again (VALIDATION_ERROR), never a silent success", async () => {
    const manifest = buildManifest([entry({ path: "lore.tree.yaml", kind: "governance" })]);
    const { fs } = makeFakeFs({
      [join(REPO_DIR, ".lore", ".lore-project-manifest.json")]: JSON.stringify(manifest),
      [join(REPO_DIR, "lore.tree.yaml")]: "root: {}\n",
    });

    const first = await uninstallProject(fs, { repoDir: REPO_DIR });
    expect(first.ok).toBe(true);

    const second = await uninstallProject(fs, { repoDir: REPO_DIR });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("VALIDATION_ERROR");
  });

  it("a restored 'hook'-kind entry gets the executable mode; every other kind gets the non-executable mode", async () => {
    const hookEntry = entry({ path: "hooks/g1-spec-create.sh", kind: "hook", written_at: "2026-07-21T00:00:00.000Z" });
    const governanceEntry = entry({ path: "CLAUDE.md", kind: "governance", written_at: "2026-07-21T00:00:00.000Z" });
    const manifest = buildManifest([hookEntry, governanceEntry]);

    const { fs } = makeFakeFs({
      [join(REPO_DIR, ".lore", ".lore-project-manifest.json")]: JSON.stringify(manifest),
      [join(REPO_DIR, ".lore", ".lore-backups", "2026-07-21T00:00:00.000Z", "hooks/g1-spec-create.sh")]: "#!/bin/sh\necho old\n",
      [join(REPO_DIR, ".lore", ".lore-backups", "2026-07-21T00:00:00.000Z", "CLAUDE.md")]: "# old\n",
      [join(REPO_DIR, "hooks/g1-spec-create.sh")]: "#!/bin/sh\necho new\n",
      [join(REPO_DIR, "CLAUDE.md")]: "# new\n",
    });

    const writeCalls: Array<{ path: string; mode: number }> = [];
    const fsWithModeCapture: ProjectFsRemovePort = {
      ...fs,
      writeFile(path: string, content: string, mode: number): void {
        writeCalls.push({ path, mode });
        fs.writeFile(path, content, mode);
      },
    };

    const result = await uninstallProject(fsWithModeCapture, { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);

    const hookWrite = writeCalls.find((w) => w.path === join(REPO_DIR, "hooks/g1-spec-create.sh"));
    const governanceWrite = writeCalls.find((w) => w.path === join(REPO_DIR, "CLAUDE.md"));
    expect(hookWrite?.mode).toBe(0o755);
    expect(governanceWrite?.mode).toBe(0o644);
  });
});
