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
import { err, ok, setupManifestSchema } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import {
  scaffoldProject,
  type ExecPort,
  type InitCorpus,
  type ProjectAssetSource,
  type ProjectFsPort,
  type ProjectScaffoldFlowDeps,
} from "../../../src/flows/setup-project-flow.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REPO_DIR = "/repo";

const HOOK_ASSET_CONTENTS: Record<string, string> = {
  "g1-spec-create.sh": "#!/usr/bin/env bash\necho g1\n",
  "g2-spec-promote.sh": "#!/usr/bin/env bash\necho g2\n",
  "g3-plan-promote.sh": "#!/usr/bin/env bash\necho g3\n",
  "g4-task-claim.sh": "#!/usr/bin/env bash\necho g4\n",
  "pre-push": "#!/usr/bin/env bash\necho pre-push\n",
};
const TREE_YAML_CONTENT = "root: prd\n";
const GITIGNORE_BLOCK = "# --- lore ---\n.DS_Store\nnode_modules/\ndist/\ncoverage/\n.agent-worktree-marker\n.lore/lore.db*\n";
// Mirrors the shipped `assets/project/CLAUDE.md.template`'s own marker pair
// verbatim (module-private constants, not imported — same convention this
// file already used for its OTHER fixture constants).
const CLAUDE_MD_MARKER_START = "# ─── lore governance (managed) ───";
const CLAUDE_MD_MARKER_END = "# ─── end lore governance ───";
const CLAUDE_MD_BODY = "# CLAUDE.md\n\nLore-governed workflow stub.\n\n## Module Index\n";
const CLAUDE_MD_TEMPLATE = `${CLAUDE_MD_MARKER_START}\n${CLAUDE_MD_BODY}${CLAUDE_MD_MARKER_END}\n`;

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
  remove(path: string): void {
    this.files.delete(path);
  }
}

function withInjectedWriteFailure(base: InMemoryProjectFs, failOnPath: string): ProjectFsPort {
  return {
    exists: (p) => base.exists(p),
    readFile: (p) => base.readFile(p),
    mkdir: (p) => base.mkdir(p),
    backup: (s, d) => base.backup(s, d),
    remove: (p) => base.remove(p),
    writeFile(path: string, content: string, mode: number): void {
      if (path === failOnPath) throw new Error(`injected write failure: ${path}`);
      base.writeFile(path, content, mode);
    },
  };
}

function makeExec(): ExecPort {
  return {
    async run() {
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
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(CLAUDE_MD_TEMPLATE);
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
  it("pre-existing CLAUDE.md byte-identical to the (marker-wrapped) template: skipped, no backup", async () => {
    const fs = new InMemoryProjectFs();
    fs.files.set(CLAUDE_MD_PATH, { content: CLAUDE_MD_TEMPLATE, mode: 0o644 });

    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.claude_md.status).toBe("skipped");
    expect(result.value.backups).toEqual([]);
    expect(fs.backupCalls).toBe(0);
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(CLAUDE_MD_TEMPLATE);
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
    // Every original byte survives as an exact prefix; the managed section is appended after it.
    const afterFirst = fs.readFile(CLAUDE_MD_PATH) as string;
    expect(afterFirst).toBe(`${original}${CLAUDE_MD_TEMPLATE}`);

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
