/**
 * SPEC-076 §C1 D7 — repo-root `CLAUDE.md` marker-section rewrite +
 * `user_once` never-rewritten invariance (task
 * `task-skill-implement-t6-claude-md-marker-section-migration-user`,
 * AC-076-4).
 *
 * bun test (per the task's own oracle command) exercising
 * `flows/setup-project-flow.ts::scaffoldProject` end to end against an
 * in-memory `ProjectFsPort` fake — mirrors
 * `tests/unit/flows/setup-project-claudemd.test.ts`'s established fixture
 * pattern, extended with an `mtime` counter (bumped only on an actual
 * `writeFile` call) so "never rewritten" is asserted on BOTH bytes and
 * mtime, not bytes alone.
 *
 * Coverage:
 *   HAPPY:      no pre-existing CLAUDE.md (legacy form (a)) -> the whole
 *               file becomes the marker-wrapped template, verbatim
 *   STATE:      legacy un-marked stub, byte-identical to the template's own
 *               body (form (b)) -> fully replaced by the marker-wrapped
 *               form (AC-076-4: "outside the markers" is empty before AND
 *               after, trivially byte-identical); genuinely user-authored
 *               content (form (c)) -> the managed section is APPENDED,
 *               every original byte preserved as an exact prefix, a
 *               mandatory backup is written first (R3), and a second
 *               converge appends 0 more (idempotent)
 *   BOUNDARY:   an ALREADY marker-wrapped file (a prior converge's own
 *               output) whose template body then CHANGES between runs ->
 *               only the governed span is spliced, bytes outside the
 *               markers stay byte-identical, proving AC-076-4's "section
 *               between markers equals the new template" holds on repeat
 *               converges too, not just the first write
 *   ERROR:      an injected write failure AND an injected backup failure on
 *               a differing pre-existing CLAUDE.md each leave the original
 *               bytes on disk untouched and report "failed" loudly
 *               (R3 contingency)
 *   NEGATIVE:   a malformed shipped `CLAUDE.md.template` asset (missing its
 *               marker wrapper) -> the step reports "failed", every other
 *               step still completes, and a pre-existing user file is left
 *               untouched
 *   REGRESSION: `user_once` files (`.lore/config.yaml` via `initCorpus`,
 *               `lore.tree.yaml`) are byte- AND mtime-unchanged across TWO
 *               consecutive converge runs (AC-076-4's user_once clause)
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
} from "../../src/flows/setup-project-flow.js";
import { spliceManagedSections, type ManagedSection } from "../../src/service/context-projection.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REPO_DIR = "/repo";

const HOOK_ASSET_CONTENTS: Record<string, string> = {
  "pre-push": "#!/usr/bin/env bash\necho pre-push\n",
};
const TREE_YAML_CONTENT = "root: prd\n";
const GITIGNORE_BLOCK = "# --- lore ---\n.DS_Store\nnode_modules/\ndist/\ncoverage/\n.agent-worktree-marker\n.lore/lore.db*\n";

// Mirrors the shipped `assets/project/CLAUDE.md.template`'s own marker pair
// verbatim (the literal strings this task's spec digest pins) — NOT
// imported from the flow module (the constants are module-private), same
// convention as the sibling `setup-project-claudemd.test.ts`'s own local
// `CLAUDE_MD_TEMPLATE` constant.
const MARKER_START = "# ─── lore governance (managed) ───";
const MARKER_END = "# ─── end lore governance ───";
const CLAUDE_MD_BODY = "# CLAUDE.md\n\nLore-governed workflow stub.\n\n## Module Index\n";
// This is the RAW shipped-asset shape — never fingerprinted (mirrors
// `assets/project/CLAUDE.md.template` itself, which carries no `<!--
// lore:managed -->` comment either). Fingerprints are stamped only by
// `spliceManagedSections` at write time.
const CLAUDE_MD_TEMPLATE = `${MARKER_START}\n${CLAUDE_MD_BODY}${MARKER_END}\n`;
// A second, DIFFERENT template body — used by the BOUNDARY case to prove a
// content change only ever touches the governed span on a re-converge.
const CLAUDE_MD_BODY_V2 = "# CLAUDE.md\n\nLore-governed workflow stub (v2, updated prose).\n";
const CLAUDE_MD_TEMPLATE_V2 = `${MARKER_START}\n${CLAUDE_MD_BODY_V2}${MARKER_END}\n`;
// `runClaudeMdStep` hands the template's bare body to `spliceManagedSections`
// as ONE section under this id (mirrors `setup-project-flow.ts`'s own
// module-private `CLAUDE_MD_SECTION_ID` constant).
const CLAUDE_MD_SECTION_ID = "governance";

/** Splices `sections` into `existing` via the REAL shared splice function, failing the test loudly on an unexpected splice error — derives the exact fingerprinted bytes `runClaudeMdStep` itself would produce instead of hand-typing them. */
function spliceOrThrow(existing: string, sections: ManagedSection[]): string {
  const result = spliceManagedSections(existing, sections);
  if (!result.ok) throw new Error(`fixture splice failed unexpectedly: ${JSON.stringify(result.error)}`);
  return result.value.content;
}

/** What `runClaudeMdStep` writes on a from-scratch install (`existing === ""`) — freshly fingerprinted. */
const EXPECTED_FRESH_CLAUDE_MD = spliceOrThrow("", [{ id: CLAUDE_MD_SECTION_ID, body: CLAUDE_MD_BODY }]);
/** Same, for the v2 template body (BOUNDARY case's second converge). */
const EXPECTED_FRESH_CLAUDE_MD_V2 = spliceOrThrow("", [{ id: CLAUDE_MD_SECTION_ID, body: CLAUDE_MD_BODY_V2 }]);

interface FakeFile {
  content: string;
  mode: number;
  /** Bumped by the shared monotonic `clock` counter on every `writeFile` call — a deterministic mtime proxy. */
  mtime: number;
}

class InMemoryProjectFs implements ProjectFsPort {
  files = new Map<string, FakeFile>();
  backupCalls = 0;
  private clock = 0;

  exists(path: string): boolean {
    if (this.files.has(path)) return true;
    // Directory semantics: `.lore` "exists" once anything is written under
    // it, even though this fake never stores directory entries directly —
    // mirrors `setup-project-manifest.test.ts`'s established fake (the SSOT
    // precedent for this exact prefix-scan trick, needed for `runInitStep`'s
    // "skipped once `.lore/config.yaml` is present" branch).
    const prefix = `${path}/`;
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }
  readFile(path: string): string | null {
    return this.files.get(path)?.content ?? null;
  }
  writeFile(path: string, content: string, mode: number): void {
    this.clock += 1;
    this.files.set(path, { content, mode, mtime: this.clock });
  }
  mkdir(_path: string): void {}
  backup(src: string, destDir: string): void {
    this.backupCalls++;
    const file = this.files.get(src);
    if (!file) throw new Error(`backup: no such file "${src}"`);
    const name = src.split("/").pop() as string;
    this.clock += 1;
    this.files.set(`${destDir}/${name}`, { ...file, mtime: this.clock });
  }
  /**
   * `_opts` is DECLARED even though this fake ignores it (D8 of
   * spec-lore-setup-deletes-repo-source-through-dev-symlinks): a double typed
   * `remove(path)` silently opts OUT of the required-boundary constraint,
   * re-opening in test space the hole the required parameter exists to close.
   */
  remove(path: string, _opts: { boundary: string }): void {
    this.files.delete(path);
  }
  /** Test-only helper — the mtime of `path`, or `undefined` if never written. */
  mtimeOf(path: string): number | undefined {
    return this.files.get(path)?.mtime;
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

function withInjectedBackupFailure(base: InMemoryProjectFs, failOnSrc: string): ProjectFsPort {
  return {
    exists: (p) => base.exists(p),
    readFile: (p) => base.readFile(p),
    mkdir: (p) => base.mkdir(p),
    // Forwards `opts` rather than dropping it (D8).
    remove: (p, opts) => base.remove(p, opts),
    writeFile: (p, c, m) => base.writeFile(p, c, m),
    backup(src: string, destDir: string): void {
      if (src === failOnSrc) throw new Error(`injected backup failure: ${src}`);
      base.backup(src, destDir);
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
    fs.writeFile(`${repoDir}/.lore/config.yaml`, "project:\n  name: test\n", 0o644);
    return ok(undefined);
  };
}

function makeAssets(
  overrides: Partial<Record<string, string>> = {},
  claudeMdTemplate: string = CLAUDE_MD_TEMPLATE,
): ProjectAssetSource {
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
      if (name === "CLAUDE.md.template") return ok(claudeMdTemplate);
      // reason: this suite pins the MARKER-form write only; an empty skeleton keeps a fresh
      // install's bytes == the bare zone. The skeleton path is pinned in setup-project-claudemd.test.ts.
      if (name === "CLAUDE.md.skeleton") return ok("");
      return err({ code: "VALIDATION_ERROR", field: "name", message: `unknown project asset: ${name}`, value: name });
    },
  };
}

function makeDeps(
  fs: InMemoryProjectFs,
  opts: { assetOverrides?: Partial<Record<string, string>>; claudeMdTemplate?: string } = {},
): ProjectScaffoldFlowDeps {
  return {
    fs,
    exec: makeExec(),
    initCorpus: makeInitCorpus(fs),
    assets: makeAssets(opts.assetOverrides, opts.claudeMdTemplate),
  };
}

const CLAUDE_MD_PATH = `${REPO_DIR}/CLAUDE.md`;
const CONFIG_YAML_PATH = `${REPO_DIR}/.lore/config.yaml`;
const TREE_YAML_PATH = `${REPO_DIR}/lore.tree.yaml`;

const FIXED_NOW = "2026-07-25T00-00-00.000Z";
const fixedNow = (): string => FIXED_NOW;

// ─── HAPPY — legacy form (a): no pre-existing CLAUDE.md ───────────────────────

describe("setup-user-once-marker — CLAUDE.md marker rewrite (SPEC-076 D7) — HAPPY", () => {
  it("AC-076-4 form (a): no pre-existing CLAUDE.md -> the whole file is the marker-wrapped template", async () => {
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

// ─── STATE — legacy forms (b)/(c) ──────────────────────────────────────────────

describe("setup-user-once-marker — CLAUDE.md marker rewrite (SPEC-076 D7) — STATE", () => {
  it("AC-076-4 form (b): pre-existing content byte-identical to the OLD un-marked stub is fully replaced, no data at stake", async () => {
    const fs = new InMemoryProjectFs();
    fs.files.set(CLAUDE_MD_PATH, { content: CLAUDE_MD_BODY, mode: 0o644, mtime: 0 });

    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.claude_md.status).toBe("done");
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(EXPECTED_FRESH_CLAUDE_MD);
    // "Bytes outside the markers" is the empty string both before (the whole
    // file WAS the body, no markers existed yet) and after (nothing sits
    // outside the wrapped template) — trivially byte-identical.
    expect(EXPECTED_FRESH_CLAUDE_MD.startsWith(MARKER_START)).toBe(true);
    expect(EXPECTED_FRESH_CLAUDE_MD.endsWith(MARKER_END)).toBe(true);
  });

  it("AC-076-4 form (c): genuinely user-authored content is preserved byte-for-byte, the managed section is APPENDED, backed up first", async () => {
    const fs = new InMemoryProjectFs();
    const original = "# My Project\n\nHand-written developer notes — please keep me.\n";
    fs.files.set(CLAUDE_MD_PATH, { content: original, mode: 0o644, mtime: 0 });
    const deps = makeDeps(fs);

    const first = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.value.claude_md.status).toBe("done");
    const afterFirst = fs.readFile(CLAUDE_MD_PATH) as string;
    // Every original byte survives as an exact prefix — "bytes outside the
    // marker pair are byte-identical to pre-converge" (AC-076-4).
    expect(afterFirst.startsWith(original)).toBe(true);
    // The section between the markers equals the new template exactly.
    const managedSection = afterFirst.slice(original.length + (original.endsWith("\n") ? 0 : 1));
    expect(managedSection).toBe(EXPECTED_FRESH_CLAUDE_MD);

    // R3: a mandatory backup was written before the append.
    const expectedBackupPath = `.lore/.lore-backups/${FIXED_NOW}/CLAUDE.md`;
    expect(first.value.backups).toEqual([expectedBackupPath]);
    expect(fs.readFile(`${REPO_DIR}/${expectedBackupPath}`)).toBe(original);
    expect(fs.backupCalls).toBe(1);

    // A second converge over the now marker-wrapped file appends 0 more —
    // idempotent, matching the AC-076-4 "converge twice" invariant.
    const second = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.claude_md.status).toBe("skipped");
    expect(second.value.backups).toEqual([]);
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(afterFirst);
  });
});

// ─── BOUNDARY — already marker-wrapped, template content changes ─────────────

describe("setup-user-once-marker — CLAUDE.md marker rewrite (SPEC-076 D7) — BOUNDARY", () => {
  it("AC-076-4: a re-converge with an UPDATED template only rewrites the governed span, bytes outside stay byte-identical", async () => {
    const fs = new InMemoryProjectFs();
    const original = "# Notes before markers ever existed.\n";
    fs.files.set(CLAUDE_MD_PATH, { content: original, mode: 0o644, mtime: 0 });

    // First converge: form (c) append — introduces the marker pair.
    const first = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR }, fixedNow);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const afterFirst = fs.readFile(CLAUDE_MD_PATH) as string;
    expect(afterFirst).toBe(`${original}${EXPECTED_FRESH_CLAUDE_MD}`);

    // Second converge: the SHIPPED template's body has changed (v2) —
    // only the governed span should be replaced. The zone from the first
    // converge is already fingerprinted (not legacy), so this is a normal
    // "updated" rebuild, not adoption.
    const second = await scaffoldProject(
      makeDeps(fs, { claudeMdTemplate: CLAUDE_MD_TEMPLATE_V2 }),
      { repoDir: REPO_DIR },
      fixedNow,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.claude_md.status).toBe("done");
    const afterSecond = fs.readFile(CLAUDE_MD_PATH) as string;
    expect(afterSecond).toBe(`${original}${EXPECTED_FRESH_CLAUDE_MD_V2}`);
    // The prefix (everything outside the markers) is unchanged across both runs.
    expect(afterSecond.startsWith(original)).toBe(true);
    expect(afterSecond.slice(original.length)).toBe(EXPECTED_FRESH_CLAUDE_MD_V2);
  });
});

// ─── ERROR — fs failures leave the original untouched, fail loud (R3) ────────

describe("setup-user-once-marker — CLAUDE.md marker rewrite (SPEC-076 D7) — ERROR", () => {
  it("R3: injected WRITE failure on a differing pre-existing CLAUDE.md leaves the original untouched, reports failed", async () => {
    const fs = new InMemoryProjectFs();
    const original = "# Hand-written notes.\n";
    fs.files.set(CLAUDE_MD_PATH, { content: original, mode: 0o644, mtime: 0 });
    const deps: ProjectScaffoldFlowDeps = { ...makeDeps(fs), fs: withInjectedWriteFailure(fs, CLAUDE_MD_PATH) };

    const result = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.claude_md.status).toBe("failed");
    expect(result.value.claude_md.detail).toContain("injected write failure");
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(original);
  });

  it("R3: injected BACKUP failure on a differing pre-existing CLAUDE.md leaves the original untouched, reports failed, never overwrites un-backed-up content", async () => {
    const fs = new InMemoryProjectFs();
    const original = "# Hand-written notes.\n";
    fs.files.set(CLAUDE_MD_PATH, { content: original, mode: 0o644, mtime: 0 });
    const deps: ProjectScaffoldFlowDeps = { ...makeDeps(fs), fs: withInjectedBackupFailure(fs, CLAUDE_MD_PATH) };

    const result = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.claude_md.status).toBe("failed");
    expect(result.value.claude_md.detail).toContain("injected backup failure");
    // Not backed up AND not overwritten — the original is exactly as it was.
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(original);
  });
});

// ─── NEGATIVE — malformed shipped template asset ──────────────────────────────

describe("setup-user-once-marker — CLAUDE.md marker rewrite (SPEC-076 D7) — NEGATIVE", () => {
  it("a shipped template missing its marker wrapper fails loud, every other step still completes, a pre-existing user file is untouched", async () => {
    const fs = new InMemoryProjectFs();
    const original = "# Hand-written notes.\n";
    fs.files.set(CLAUDE_MD_PATH, { content: original, mode: 0o644, mtime: 0 });
    // A malformed asset — no marker wrapper at all.
    const deps = makeDeps(fs, { claudeMdTemplate: "# CLAUDE.md\n\nNot wrapped in markers.\n" });

    const result = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.claude_md.status).toBe("failed");
    expect(result.value.claude_md.detail).toContain("lore governance markers");
    expect(fs.readFile(CLAUDE_MD_PATH)).toBe(original);

    expect(result.value.init.status).toBe("done");
    expect(result.value.tree_yaml.status).toBe("done");
    expect(result.value.gitignore.status).toBe("done");
    for (const h of result.value.hooks) expect(h.status).toBe("done");
  });
});

// ─── REGRESSION — user_once files never rewritten (bytes AND mtime) ──────────

describe("setup-user-once-marker — user_once files never rewritten across converge (SPEC-076 §C1) — REGRESSION", () => {
  it("AC-076-4: .lore/config.yaml and lore.tree.yaml are byte- and mtime-unchanged across two converge runs", async () => {
    const fs = new InMemoryProjectFs();
    const deps = makeDeps(fs);

    const first = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.init.status).toBe("done");
    expect(first.value.tree_yaml.status).toBe("done");

    const configContentAfterFirst = fs.readFile(CONFIG_YAML_PATH);
    const configMtimeAfterFirst = fs.mtimeOf(CONFIG_YAML_PATH);
    const treeContentAfterFirst = fs.readFile(TREE_YAML_PATH);
    const treeMtimeAfterFirst = fs.mtimeOf(TREE_YAML_PATH);
    expect(configContentAfterFirst).not.toBeNull();
    expect(treeContentAfterFirst).toBe(TREE_YAML_CONTENT);
    expect(configMtimeAfterFirst).toBeDefined();
    expect(treeMtimeAfterFirst).toBeDefined();

    // Second converge — CLAUDE.md/gitignore keep changing underneath (not
    // user_once), but the two user_once files must not be touched at all.
    const second = await scaffoldProject(deps, { repoDir: REPO_DIR }, fixedNow);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.init.status).toBe("skipped");
    expect(second.value.tree_yaml.status).toBe("skipped");

    expect(fs.readFile(CONFIG_YAML_PATH)).toBe(configContentAfterFirst);
    expect(fs.mtimeOf(CONFIG_YAML_PATH)).toBe(configMtimeAfterFirst as number);
    expect(fs.readFile(TREE_YAML_PATH)).toBe(treeContentAfterFirst);
    expect(fs.mtimeOf(TREE_YAML_PATH)).toBe(treeMtimeAfterFirst as number);
  });
});

// ─── manifest schema sanity (byproduct of every scenario above) ──────────────

describe("setup-user-once-marker — manifest stays schema-valid after a marker-form write", () => {
  it("manifest tracks CLAUDE.md after a form-(a) write", async () => {
    const fs = new InMemoryProjectFs();
    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR }, fixedNow);
    expect(result.ok).toBe(true);

    const raw = fs.readFile(`${REPO_DIR}/.lore/.lore-project-manifest.json`);
    expect(raw).not.toBeNull();
    const parsed = setupManifestSchema.safeParse(JSON.parse(raw as string));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const entry = parsed.data.entries.find((e) => e.path === "CLAUDE.md");
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe("governance");
  });
});
