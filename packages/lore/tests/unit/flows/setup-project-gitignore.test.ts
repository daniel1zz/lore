/**
 * SPEC-060 D3 — repo-root `.gitignore` append step suite. Exercises
 * `flows/setup-project-flow.ts`'s `runGitignoreStep` (not exported — tested
 * exclusively through `scaffoldProject`'s public surface) against an
 * in-memory `ProjectFsPort` fake, mirroring
 * `tests/unit/flows/setup-project-manifest.test.ts`'s established fixture
 * pattern.
 *
 * Coverage:
 *   HAPPY:      no pre-existing .gitignore -> the written file contains all
 *               6 declared entries under exactly 1 `# --- lore ---` block
 *               (AC-060-4 clause 1)
 *   NEGATIVE:   an unreadable/missing gitignore.template asset -> the step
 *               reports "failed", every OTHER step still completes normally
 *   BOUNDARY:   a pre-existing .gitignore with UNRELATED content and no
 *               marker -> the original bytes remain an exact byte prefix of
 *               the result, and exactly 1 `# --- lore ---` block is appended
 *               (AC-060-4 clause 2)
 *   ERROR:      an injected write failure leaves the pre-existing .gitignore
 *               byte-for-byte untouched and reports "failed"
 *   STATE:      a second run over an already-appended .gitignore performs 0
 *               additional appends (content unchanged, "skipped"); a THIRD
 *               run also appends 0 additional blocks (AC-060-4 clause 3)
 *   REGRESSION: the manifest ledger tracks ".gitignore" after a write and
 *               continues to track it (unchanged sha) after an idempotent
 *               skip run
 *
 * @spec_ref AC-060-4
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
const CLAUDE_MD_CONTENT = "# CLAUDE.md\n\nStub.\n";

const GITIGNORE_MARKER = "# --- lore ---";
const GITIGNORE_ENTRIES = [".DS_Store", "node_modules/", "dist/", "coverage/", ".agent-worktree-marker", ".lore/lore.db*"];
const GITIGNORE_BLOCK = `${GITIGNORE_MARKER}\n${GITIGNORE_ENTRIES.join("\n")}\n`;

interface FakeFile {
  content: string;
  mode: number;
}

class InMemoryProjectFs implements ProjectFsPort {
  files = new Map<string, FakeFile>();

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
    const file = this.files.get(src);
    if (!file) throw new Error(`backup: no such file "${src}"`);
    const name = src.split("/").pop() as string;
    this.files.set(`${destDir}/${name}`, { ...file });
  }
  /**
   * `_opts` is DECLARED even though this fake ignores it (D8 of
   * spec-lore-setup-deletes-repo-source-through-dev-symlinks) — see the identical
   * note in `setup-project-claudemd.test.ts`: a double typed `remove(path)` opts
   * OUT of the required-boundary constraint and lets the wrapper below drop the
   * boundary on its forward with no compile error.
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
      if (name === "CLAUDE.md.template") return ok(CLAUDE_MD_CONTENT);
      if (name === "CLAUDE.md.skeleton") return ok("# CLAUDE.md\n\n## What This Is\n");
      return err({ code: "VALIDATION_ERROR", field: "name", message: `unknown project asset: ${name}`, value: name });
    },
  };
}

function makeDeps(fs: InMemoryProjectFs, assetOverrides: Partial<Record<string, string>> = {}): ProjectScaffoldFlowDeps {
  return { fs, exec: makeExec(), initCorpus: makeInitCorpus(fs), assets: makeAssets(assetOverrides) };
}

const GITIGNORE_PATH = `${REPO_DIR}/.gitignore`;

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("setup-project-flow — .gitignore append (SPEC-060 D3) — HAPPY", () => {
  it("no pre-existing .gitignore: written file contains all 6 declared entries under exactly 1 marker block", async () => {
    const fs = new InMemoryProjectFs();
    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.gitignore.status).toBe("done");

    const content = fs.readFile(GITIGNORE_PATH);
    expect(content).not.toBeNull();
    for (const entry of GITIGNORE_ENTRIES) {
      expect(content).toContain(entry);
    }
    expect(countOccurrences(content as string, GITIGNORE_MARKER)).toBe(1);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("setup-project-flow — .gitignore append (SPEC-060 D3) — NEGATIVE", () => {
  it("unreadable gitignore.template asset: step reports failed, every other step still completes", async () => {
    const fs = new InMemoryProjectFs();
    const deps = makeDeps(fs, { "gitignore.template": undefined });

    const result = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.gitignore.status).toBe("failed");
    expect(result.value.gitignore.detail).toBeTruthy();
    expect(fs.exists(GITIGNORE_PATH)).toBe(false);

    // Every other step is independent of this one's failure.
    expect(result.value.init.status).toBe("done");
    expect(result.value.tree_yaml.status).toBe("done");
    expect(result.value.claude_md.status).toBe("done");
    for (const h of result.value.hooks) expect(h.status).toBe("done");
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("setup-project-flow — .gitignore append (SPEC-060 D3) — BOUNDARY", () => {
  it("pre-existing .gitignore with unrelated content: original bytes remain an exact prefix, exactly 1 block appended", async () => {
    const fs = new InMemoryProjectFs();
    const original = "*.log\n.env\n";
    fs.files.set(GITIGNORE_PATH, { content: original, mode: 0o644 });

    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.gitignore.status).toBe("done");

    const content = fs.readFile(GITIGNORE_PATH) as string;
    expect(content.startsWith(original)).toBe(true);
    expect(countOccurrences(content, GITIGNORE_MARKER)).toBe(1);
    for (const entry of GITIGNORE_ENTRIES) {
      expect(content).toContain(entry);
    }
  });

  it("third run over an already-appended .gitignore appends 0 additional blocks", async () => {
    const fs = new InMemoryProjectFs();
    const original = "*.log\n";
    fs.files.set(GITIGNORE_PATH, { content: original, mode: 0o644 });
    const deps = makeDeps(fs);

    const first = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(first.ok).toBe(true);
    const second = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(second.ok).toBe(true);
    const third = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(third.ok).toBe(true);
    if (!third.ok) return;

    expect(third.value.gitignore.status).toBe("skipped");
    const content = fs.readFile(GITIGNORE_PATH) as string;
    expect(content.startsWith(original)).toBe(true);
    expect(countOccurrences(content, GITIGNORE_MARKER)).toBe(1);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("setup-project-flow — .gitignore append (SPEC-060 D3) — ERROR", () => {
  it("injected write failure: .gitignore left byte-for-byte untouched, step reports failed", async () => {
    const fs = new InMemoryProjectFs();
    const original = "*.log\n";
    fs.files.set(GITIGNORE_PATH, { content: original, mode: 0o644 });
    const deps: ProjectScaffoldFlowDeps = { ...makeDeps(fs), fs: withInjectedWriteFailure(fs, GITIGNORE_PATH) };

    const result = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.gitignore.status).toBe("failed");
    expect(result.value.gitignore.detail).toContain("injected write failure");
    expect(fs.readFile(GITIGNORE_PATH)).toBe(original);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("setup-project-flow — .gitignore append (SPEC-060 D3) — STATE", () => {
  it("second run over an already-appended .gitignore performs 0 additional appends", async () => {
    const fs = new InMemoryProjectFs();
    const deps = makeDeps(fs);

    const first = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.gitignore.status).toBe("done");
    const afterFirst = fs.readFile(GITIGNORE_PATH);

    const second = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.gitignore.status).toBe("skipped");
    expect(fs.readFile(GITIGNORE_PATH)).toBe(afterFirst);
    expect(countOccurrences(afterFirst as string, GITIGNORE_MARKER)).toBe(1);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("setup-project-flow — .gitignore append (SPEC-060 D3) — REGRESSION", () => {
  it("manifest tracks .gitignore after a write and keeps tracking it (unchanged sha) after a skip run", async () => {
    const fs = new InMemoryProjectFs();
    const deps = makeDeps(fs);

    const first = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(first.ok).toBe(true);

    const manifestPath = `${REPO_DIR}/.lore/.lore-project-manifest.json`;
    const raw1 = fs.readFile(manifestPath);
    expect(raw1).not.toBeNull();
    const parsed1 = setupManifestSchema.safeParse(JSON.parse(raw1 as string));
    expect(parsed1.success).toBe(true);
    if (!parsed1.success) return;
    const entry1 = parsed1.data.entries.find((e) => e.path === ".gitignore");
    expect(entry1).toBeDefined();

    const second = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(second.ok).toBe(true);

    const raw2 = fs.readFile(manifestPath);
    const parsed2 = setupManifestSchema.safeParse(JSON.parse(raw2 as string));
    expect(parsed2.success).toBe(true);
    if (!parsed2.success) return;
    const entry2 = parsed2.data.entries.find((e) => e.path === ".gitignore");
    expect(entry2).toBeDefined();
    expect(entry2?.sha256).toBe(entry1?.sha256);
  });
});
