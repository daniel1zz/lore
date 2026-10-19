/**
 * SPEC-076 §C1 D7 — repo-root `CLAUDE.md` marker-section rewrite step suite
 * (migrated off SPEC-060 D4's original blanket backup-then-overwrite).
 * Exercises `flows/setup-project-flow.ts`'s `runClaudeMdStep`/
 * `computeClaudeMdCandidate` (not exported — tested exclusively through
 * `scaffoldProject`'s public surface) against an in-memory `ProjectFsPort`
 * fake, mirroring `tests/unit/flows/setup-project-manifest.test.ts`'s
 * established fixture pattern. Six-dimension coverage of the SAME single
 * step this suite has always covered — see
 * `tests/integration/setup-user-once-marker.bun.test.ts` (AC-076-4) for the
 * fuller three-legacy-form + user_once + fs-error-injection integration
 * suite this task's own oracle names.
 *
 * Coverage:
 *   HAPPY:      no pre-existing CLAUDE.md -> the whole file becomes the
 *               marker-wrapped template, verbatim; no backup
 *   NEGATIVE:   an unreadable/missing CLAUDE.md.template asset -> the step
 *               reports "failed", every OTHER step still completes normally
 *   BOUNDARY:   pre-existing CLAUDE.md byte-identical to the (already
 *               marker-wrapped) template -> "skipped", no backup created
 *   ERROR:      an injected write failure on a DIFFERING pre-existing
 *               CLAUDE.md (user-authored content) leaves the original
 *               content on disk untouched and reports "failed"
 *   STATE:      pre-existing differing (user-authored) CLAUDE.md -> the
 *               marker-wrapped section is APPENDED (never a whole-file
 *               overwrite), a backup of the pre-run bytes is written first
 *               (AC-076-4/R3), and a SECOND run over the now marker-wrapped
 *               file performs 0 additional backups (idempotent)
 *   REGRESSION: the manifest ledger tracks "CLAUDE.md" after a write
 *
 * @spec_ref AC-076-4
 */

import { describe, expect, it } from "vitest";
import { err, ok, resolveMemoryFileBudgets, setupManifestSchema } from "@lore/core";
import type { FsProbe, LoreError, MemoryFileBudgets, Result } from "@lore/core";
import {
  scaffoldProject,
  type AdoptionWriteOutcome,
  type ExecPort,
  type InitCorpus,
  type ProjectAssetSource,
  type ProjectFsPort,
  type ProjectScaffoldFlowDeps,
} from "../../../src/flows/setup-project-flow.js";
import { renderProjectScaffoldReceipt } from "../../../src/adapters/cli/setup-render.js";
import { spliceManagedSections, type ManagedSection } from "../../../src/service/context-projection.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REPO_DIR = "/repo";

const HOOK_ASSET_CONTENTS: Record<string, string> = {
  "pre-push": "#!/usr/bin/env bash\necho pre-push\n",
  "reference-transaction": "#!/bin/sh\necho reference-transaction\n",
};
const TREE_YAML_CONTENT = "root: prd\n";
const GITIGNORE_BLOCK = "# --- lore ---\n.DS_Store\nnode_modules/\ndist/\ncoverage/\n.agent-worktree-marker\n.lore/lore.db*\n";
// Mirrors the shipped `assets/project/CLAUDE.md.template`'s own marker pair
// verbatim (module-private constants, not imported — same convention this
// file already used for its OTHER fixture constants). This is the RAW asset
// shape — never fingerprinted (see `assets/project/CLAUDE.md.template`
// itself): fingerprints are stamped only by `spliceManagedSections` at write
// time, never baked into the shipped template.
const CLAUDE_MD_MARKER_START = "# ─── lore governance (managed) ───";
const CLAUDE_MD_MARKER_END = "# ─── end lore governance ───";
const CLAUDE_MD_BODY = "# CLAUDE.md\n\nLore-governed workflow stub.\n\n## Module Index\n";
const CLAUDE_MD_TEMPLATE = `${CLAUDE_MD_MARKER_START}\n${CLAUDE_MD_BODY}${CLAUDE_MD_MARKER_END}\n`;
// `runClaudeMdStep` hands the template's bare body to `spliceManagedSections`
// as ONE section under this id (mirrors `setup-project-flow.ts`'s own
// module-private `CLAUDE_MD_SECTION_ID` constant — not imported, same
// convention as every other fixture constant in this file).
const CLAUDE_MD_SECTION_ID = "governance";
// Fresh-install-only skeleton (`assets/project/CLAUDE.md.skeleton`): the managed block is spliced AFTER it.
const CLAUDE_MD_SKELETON = "# CLAUDE.md\n\n## What This Is\n\n## Commands\n\n## Architecture\n\n";

/** Splices `sections` into `existing` via the REAL shared splice function, failing the test loudly (not silently) on an unexpected splice error — used to derive the exact fingerprinted bytes `runClaudeMdStep` itself would produce, rather than hand-typing them (which would silently drift from the real hash/format the moment either changes). */
function spliceOrThrow(existing: string, sections: ManagedSection[]): string {
  const result = spliceManagedSections(existing, sections);
  if (!result.ok) throw new Error(`fixture splice failed unexpectedly: ${JSON.stringify(result.error)}`);
  return result.value.content;
}

const CLAUDE_MD_SECTIONS: ManagedSection[] = [{ id: CLAUDE_MD_SECTION_ID, body: CLAUDE_MD_BODY }];

/** What `runClaudeMdStep` writes on a from-scratch install (`existing === ""`) — freshly fingerprinted. */
const EXPECTED_FRESH_CLAUDE_MD = spliceOrThrow(CLAUDE_MD_SKELETON, CLAUDE_MD_SECTIONS);
/** The zone alone — what lands AFTER an existing user-authored file's bytes (no skeleton). */
const EXPECTED_APPENDED_ZONE = spliceOrThrow("", CLAUDE_MD_SECTIONS);
/** What `runClaudeMdStep` writes when adopting a legacy (fingerprint-less) marker zone byte-identical to `CLAUDE_MD_TEMPLATE`. */
const EXPECTED_ADOPTED_CLAUDE_MD = spliceOrThrow(CLAUDE_MD_TEMPLATE, CLAUDE_MD_SECTIONS);

interface FakeFile {
  content: string;
  mode: number;
}

class InMemoryProjectFs implements ProjectFsPort {
  files = new Map<string, FakeFile>();
  backupCalls = 0;

  exists(path: string): boolean {
    return this.files.has(path);
  }
  readFile(path: string): string | null {
    return this.files.get(path)?.content ?? null;
  }
  writeFile(path: string, content: string, mode: number): void {
    this.files.set(path, { content, mode });
  }
  mkdir(_path: string): void {}
  backup(src: string, destDir: string): void {
    this.backupCalls++;
    const file = this.files.get(src);
    if (!file) throw new Error(`backup: no such file "${src}"`);
    const name = src.split("/").pop() as string;
    this.files.set(`${destDir}/${name}`, { ...file });
  }
  /**
   * `_opts` is DECLARED even though this fake ignores it (D8 of
   * spec-lore-setup-deletes-repo-source-through-dev-symlinks): TypeScript lets an
   * implementation declare FEWER parameters than the port it satisfies, so a
   * double typed `remove(path)` silently opts OUT of the required-boundary
   * constraint — and the wrapper below could then drop the boundary on its
   * forward with no compile error, making the enforcement vacuous in test space.
   */
  remove(path: string, _opts: { boundary: string }): void {
    this.files.delete(path);
  }
}

function withInjectedWriteFailure(base: InMemoryProjectFs, failOnPath: string): ProjectFsPort {
  return {
    exists: (p) => base.exists(p),
    readFile: (p) => base.readFile(p),
    mkdir: (p) => base.mkdir(p),
    backup: (s, d) => base.backup(s, d),
    // Forwards `opts` rather than dropping it (D8).
    remove: (p, opts) => base.remove(p, opts),
    writeFile(path: string, content: string, mode: number): void {
      if (path === failOnPath) throw new Error(`injected write failure: ${path}`);
      base.writeFile(path, content, mode);
    },
  };
}

function makeExec(): ExecPort {
  return {
    async run(argv: string[]) {
      if (argv[1] === "--version") return { code: 0, stdout: "git version 2.45.0\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

function makeInitCorpus(fs: InMemoryProjectFs): InitCorpus {
  return async (repoDir: string) => {
    fs.files.set(`${repoDir}/.lore/config.yaml`, { content: "project:\n  name: test\n", mode: 0o644 });
    return ok(undefined);
  };
}

function makeAssets(overrides: Partial<Record<string, string>> = {}): ProjectAssetSource {
  return {
    async readAsset(name: string): Promise<Result<string, LoreError>> {
      if (name in overrides) {
        const content = overrides[name];
        if (content === undefined) {
          return err({ code: "VALIDATION_ERROR", field: "name", message: `unknown project asset: ${name}`, value: name });
        }
        return ok(content);
      }
      const hookContent = HOOK_ASSET_CONTENTS[name];
      if (hookContent !== undefined) return ok(hookContent);
      if (name === "lore.tree.yaml.template") return ok(TREE_YAML_CONTENT);
      if (name === "gitignore.template") return ok(GITIGNORE_BLOCK);
      if (name === "CLAUDE.md.template") return ok(CLAUDE_MD_TEMPLATE);
      if (name === "CLAUDE.md.skeleton") return ok(CLAUDE_MD_SKELETON);
      return err({ code: "VALIDATION_ERROR", field: "name", message: `unknown project asset: ${name}`, value: name });
    },
  };
}

function makeDeps(fs: InMemoryProjectFs, assetOverrides: Partial<Record<string, string>> = {}): ProjectScaffoldFlowDeps {
  return { fs, exec: makeExec(), initCorpus: makeInitCorpus(fs), assets: makeAssets(assetOverrides) };
}

const CLAUDE_MD_PATH = `${REPO_DIR}/CLAUDE.md`;
const MANIFEST_PATH = `${REPO_DIR}/.lore/.lore-project-manifest.json`;

// Fixed clock so the backup directory name is deterministic and assertable.
const FIXED_NOW = "2026-07-21T00-00-00.000Z";
const fixedNow = (): string => FIXED_NOW;

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("setup-project-flow — CLAUDE.md marker-section rewrite (SPEC-076 D7) — HAPPY", () => {
  it("no pre-existing CLAUDE.md: the whole file becomes the marker-wrapped template, no backup", async () => {
    const fs = new InMemoryProjectFs();
    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.claude_md.status).toBe("done");
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(EXPECTED_FRESH_CLAUDE_MD);
    expect(result.value.backups).toEqual([]);
    expect(fs.backupCalls).toBe(0);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("setup-project-flow — CLAUDE.md marker-section rewrite (SPEC-076 D7) — NEGATIVE", () => {
  it("unreadable CLAUDE.md.template asset: step reports failed, every other step still completes", async () => {
    const fs = new InMemoryProjectFs();
    const deps = makeDeps(fs, { "CLAUDE.md.template": undefined });

    const result = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.claude_md.status).toBe("failed");
    expect(result.value.claude_md.detail).toBeTruthy();
    expect(fs.exists(CLAUDE_MD_PATH)).toBe(false);

    expect(result.value.init.status).toBe("done");
    expect(result.value.tree_yaml.status).toBe("done");
    expect(result.value.gitignore.status).toBe("done");
    for (const h of result.value.hooks) expect(h.status).toBe("done");
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("setup-project-flow — CLAUDE.md marker-section rewrite (SPEC-076 D7) — BOUNDARY", () => {
  it("pre-existing CLAUDE.md is a LEGACY (fingerprint-less) marker zone byte-identical to the template: adopted (done, backed up), never 'failed'", async () => {
    const fs = new InMemoryProjectFs();
    fs.files.set(CLAUDE_MD_PATH, { content: CLAUDE_MD_TEMPLATE, mode: 0o644 });

    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Legacy adoption: every pre-fingerprinting-era install has exactly this
    // shape (marker zone present, no `<!-- lore:managed -->` comment inside).
    // The zone is discarded and rebuilt fingerprinted, so bytes DO change —
    // this must never surface as "failed" (the pre-fix VALIDATION_ERROR bug),
    // and the differing on-disk bytes are backed up before being overwritten
    // (same rule any other differing pre-existing content gets).
    expect(result.value.claude_md.status).toBe("done");
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(EXPECTED_ADOPTED_CLAUDE_MD);
    const expectedBackupPath = `.lore/.lore-backups/${FIXED_NOW}/CLAUDE.md`;
    expect(result.value.backups).toEqual([expectedBackupPath]);
    expect(fs.readFile(`${REPO_DIR}/${expectedBackupPath}`)).toBe(CLAUDE_MD_TEMPLATE);
    expect(fs.backupCalls).toBe(1);

    // A second run over the now-fingerprinted output is a normal idempotent
    // re-converge — proving the adoption is truly one-way.
    const second = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR }, fixedNow);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.claude_md.status).toBe("skipped");
    expect(second.value.backups).toEqual([]);
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(EXPECTED_ADOPTED_CLAUDE_MD);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("setup-project-flow — CLAUDE.md marker-section rewrite (SPEC-076 D7) — ERROR", () => {
  it("injected write failure on a differing (user-authored) pre-existing CLAUDE.md: original left untouched, reports failed", async () => {
    const fs = new InMemoryProjectFs();
    const original = "# CLAUDE.md\n\nHand-written by lore-init-context.\n";
    fs.files.set(CLAUDE_MD_PATH, { content: original, mode: 0o644 });
    const deps: ProjectScaffoldFlowDeps = { ...makeDeps(fs), fs: withInjectedWriteFailure(fs, CLAUDE_MD_PATH) };

    const result = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.claude_md.status).toBe("failed");
    expect(result.value.claude_md.detail).toContain("injected write failure");
    // The original, hand-written content is never lost even though the write itself failed.
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(original);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("setup-project-flow — CLAUDE.md marker-section rewrite (SPEC-076 D7) — STATE", () => {
  it("AC-076-4: pre-existing differing (user-authored) CLAUDE.md is preserved and backed up, the managed section is APPENDED; a second run appends 0 more", async () => {
    const fs = new InMemoryProjectFs();
    const original = "# CLAUDE.md\n\nHand-written by lore-init-context.\n";
    fs.files.set(CLAUDE_MD_PATH, { content: original, mode: 0o644 });
    const deps = makeDeps(fs);

    const first = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.value.claude_md.status).toBe("done");
    // Every original byte survives as an exact prefix; the managed section is
    // appended after it, freshly fingerprinted (the appended zone is always
    // brand new — there's no legacy zone to adopt when none existed at all).
    const afterFirst = fs.readFile(CLAUDE_MD_PATH) as string;
    // The skeleton is fresh-install-only: an existing file gets the zone alone, never skeleton sections.
    expect(afterFirst).toBe(`${original}${EXPECTED_APPENDED_ZONE}`);
    expect(afterFirst).not.toContain("## What This Is");

    // Exactly one backup, at the deterministic destination path, byte-identical to the pre-run file.
    const expectedBackupPath = `.lore/.lore-backups/${FIXED_NOW}/CLAUDE.md`;
    expect(first.value.backups).toEqual([expectedBackupPath]);
    expect(fs.readFile(`${REPO_DIR}/${expectedBackupPath}`)).toBe(original);
    expect(fs.backupCalls).toBe(1);

    // Second run: the file is now marker-wrapped — no further backup/append.
    const second = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.claude_md.status).toBe("skipped");
    expect(second.value.backups).toEqual([]);
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(afterFirst);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("setup-project-flow — CLAUDE.md marker-section rewrite (SPEC-076 D7) — REGRESSION", () => {
  it("manifest tracks CLAUDE.md after a write", async () => {
    const fs = new InMemoryProjectFs();
    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);

    const raw = fs.readFile(MANIFEST_PATH);
    expect(raw).not.toBeNull();
    const parsed = setupManifestSchema.safeParse(JSON.parse(raw as string));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const entry = parsed.data.entries.find((e) => e.path === "CLAUDE.md");
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe("governance");
  });
});

// ─── ADOPTION (spec-claude-md-root-section-structure-check-and-adoption-mode D4) ─────────

const REAL_SHAPE_BODY = "## Module Index\n\nmodules.\n\n## Finding Live Project State\n\nlore search.\n";
const REAL_SHAPE_TEMPLATE = `${CLAUDE_MD_MARKER_START}\n${REAL_SHAPE_BODY}${CLAUDE_MD_MARKER_END}\n`;
const REAL_SHAPE_SKELETON =
  "# CLAUDE.md\n\n## What This Is\n\nA service.\n\n## Commands\n\n- make test\n\n## Architecture\n\nLayers.\n\n";

type AdoptionCall = { repoDir: string; mode: "enforce" | "warn" };

/** A probe of an empty repository: every path is missing, nothing is readable. */
const NO_REPOSITORY_PROBE: FsProbe = { stat: () => "missing", readFile: () => null, listDir: () => null };

function makeAdoptionDeps(
  fs: InMemoryProjectFs,
  calls: AdoptionCall[],
  outcome: Result<AdoptionWriteOutcome, LoreError> = ok({ status: "written" }),
  budgets: Result<MemoryFileBudgets, LoreError> = ok(resolveMemoryFileBudgets(undefined)),
): ProjectScaffoldFlowDeps {
  return {
    ...makeDeps(fs, { "CLAUDE.md.template": REAL_SHAPE_TEMPLATE, "CLAUDE.md.skeleton": REAL_SHAPE_SKELETON }),
    resolveMemoryFileBudgets: () => budgets,
    // An explicit fake probe: this fixture's CLAUDE.md names no code, so nothing is read.
    resolveReferenceContext: () => ({ probe: NO_REPOSITORY_PROBE, referenceDocuments: [] }),
    writeAdoptionMode: (repoDir, mode) => {
      calls.push({ repoDir, mode });
      return outcome;
    },
  };
}

describe("setup-project-flow — adoption step (D4) — judged on POST-SPLICE content", () => {
  it("HAPPY: fresh install = skeleton + managed block -> enforce, empty checklist", async () => {
    const fs = new InMemoryProjectFs();
    const calls: AdoptionCall[] = [];
    const result = await scaffoldProject(makeAdoptionDeps(fs, calls), { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toEqual([{ repoDir: REPO_DIR, mode: "enforce" }]);
    expect(result.value.adoption).toEqual({ status: "written", mode: "enforce", checklist: [] });
    const content = fs.readFile(CLAUDE_MD_PATH) ?? "";
    expect(content.indexOf("## What This Is")).toBeLessThan(content.indexOf("## Module Index"));
  });

  it("NEGATIVE: existing file missing the skeleton sections -> warn + one checklist line per missing section; skeleton NOT injected", async () => {
    const fs = new InMemoryProjectFs();
    fs.files.set(CLAUDE_MD_PATH, { content: "# Mine\n\n## Notes\n\nprose\n", mode: 0o644 });
    const calls: AdoptionCall[] = [];
    const result = await scaffoldProject(makeAdoptionDeps(fs, calls), { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls.map((c) => c.mode)).toEqual(["warn"]);
    const checklist = result.value.adoption?.checklist ?? [];
    expect(checklist.filter((l) => l.includes("is missing")).map((l) => /"## ([^"]+)"/.exec(l)?.[1])).toEqual([
      "What This Is",
      "Commands",
      "Architecture",
    ]);
    expect(fs.readFile(CLAUDE_MD_PATH)).not.toContain("A service.");
  });

  it("BOUNDARY: existing file with all five sections + block duplicates two -> warn naming the duplicates", async () => {
    const fs = new InMemoryProjectFs();
    fs.files.set(CLAUDE_MD_PATH, { content: `${REAL_SHAPE_SKELETON}${REAL_SHAPE_BODY}`, mode: 0o644 });
    const calls: AdoptionCall[] = [];
    const result = await scaffoldProject(makeAdoptionDeps(fs, calls), { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls.map((c) => c.mode)).toEqual(["warn"]);
    expect((result.value.adoption?.checklist ?? []).some((l) => l.includes("appears 2 times"))).toBe(true);
  });

  it("STATE: port reports kept -> adoption row is kept with the existing value and no checklist", async () => {
    const fs = new InMemoryProjectFs();
    fs.files.set(CLAUDE_MD_PATH, { content: "# Mine\n", mode: 0o644 });
    const result = await scaffoldProject(
      makeAdoptionDeps(fs, [], ok({ status: "kept", existing: "enforce" })),
      { repoDir: REPO_DIR },
      fixedNow,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adoption).toEqual({ status: "kept", mode: "warn", detail: "enforce", checklist: [] });
  });

  it("ERROR: port failure is surfaced as adoption.status failed (never swallowed)", async () => {
    const fs = new InMemoryProjectFs();
    const failure: LoreError = { code: "STORE_ERROR", message: "config unreadable" };
    const result = await scaffoldProject(makeAdoptionDeps(fs, [], err(failure)), { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adoption?.status).toBe("failed");
    expect(result.value.adoption?.detail).toContain("config unreadable");
  });

  it("DEFECT-FIX: the repo's REAL (tighter) budgets are used — a file over a custom max_lines but under the default 300 -> warn + capacity finding", async () => {
    const fs = new InMemoryProjectFs();
    const tighter: MemoryFileBudgets = {
      ...resolveMemoryFileBudgets(undefined),
      root: { max_lines: 10, max_bytes: 30720 },
    };
    const calls: AdoptionCall[] = [];
    const result = await scaffoldProject(
      makeAdoptionDeps(fs, calls, ok({ status: "written" }), ok(tighter)),
      { repoDir: REPO_DIR },
      fixedNow,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Fresh install is ~25 lines: over 10, far under 300.
    expect(calls.map((c) => c.mode)).toEqual(["warn"]);
    expect((result.value.adoption?.checklist ?? []).some((l) => l.includes("ceiling"))).toBe(true);
  });

  it("ERROR: budgets cannot be resolved -> adoption failed (loud), port never called", async () => {
    const fs = new InMemoryProjectFs();
    const calls: AdoptionCall[] = [];
    const result = await scaffoldProject(
      makeAdoptionDeps(fs, calls, ok({ status: "written" }), err({ code: "STORE_ERROR", message: "config broken" })),
      { repoDir: REPO_DIR },
      fixedNow,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adoption?.status).toBe("failed");
    expect(result.value.adoption?.detail).toContain("config broken");
    expect(calls).toEqual([]);
  });

  it("NO-SILENT-FALLBACK: a missing adoption port is a LOUD skipped row naming the port, never an absent row", async () => {
    const fs = new InMemoryProjectFs();
    const bare = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR }, fixedNow);
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.value.adoption?.status).toBe("skipped");
    expect(bare.value.adoption?.mode).toBeUndefined();
    expect(bare.value.adoption?.detail).toContain("writeAdoptionMode");
    expect(bare.value.adoption?.detail).toContain("resolveMemoryFileBudgets");

    const half = await scaffoldProject(
      { ...makeDeps(new InMemoryProjectFs()), writeAdoptionMode: () => ok({ status: "written" }) },
      { repoDir: REPO_DIR },
      fixedNow,
    );
    expect(half.ok && half.value.adoption?.status).toBe("skipped");
    expect(half.ok && half.value.adoption?.detail).toContain("resolveMemoryFileBudgets");

    // The skip is RENDERED (visible to the operator), not just carried in the report.
    const text = renderProjectScaffoldReceipt(
      { ...bare.value, manifestPath: `${REPO_DIR}/.lore/.lore-project-manifest.json` },
      { targetDir: REPO_DIR, binPath: "/usr/local/bin/lore" },
    );
    expect(text).toContain("Adoption: skipped — not judged");
    expect(text).toContain("deps.writeAdoptionMode");
  });

  it("REGRESSION: unreadable skeleton on a fresh install -> claude_md failed, port never called", async () => {
    const fs = new InMemoryProjectFs();

    const fs2 = new InMemoryProjectFs();
    const calls: AdoptionCall[] = [];
    const deps = {
      ...makeAdoptionDeps(fs2, calls),
      assets: makeAssets({ "CLAUDE.md.template": REAL_SHAPE_TEMPLATE, "CLAUDE.md.skeleton": undefined }),
    };
    const result = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claude_md.status).toBe("failed");
    expect(calls).toEqual([]);
  });
});
