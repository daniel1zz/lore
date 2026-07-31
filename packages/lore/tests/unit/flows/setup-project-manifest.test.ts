/**
 * SPEC-060 D1 — repo-level install ledger suite. Exercises
 * `flows/setup-project-flow.ts`'s manifest write seam (`runManifestWriteSeam`,
 * not exported — tested exclusively through `scaffoldProject`'s public
 * surface) against an in-memory `ProjectFsPort` fake — a UNIT-level
 * complement to `tests/unit/service/project-setup-service.test.ts`'s
 * real-fs, throwaway-mkdtemp-repo integration suite (which this task's
 * REGRESSION dimension requires stays green, unmodified).
 *
 * Coverage:
 *   HAPPY:      fresh repo -> ledger entries equal exactly the set of files
 *               written this run (AC-060-1)
 *   NEGATIVE:   a corrupted on-disk ledger is treated as absent — the run
 *               still succeeds and produces a freshly valid ledger
 *   BOUNDARY:   second identical run issues 0 writer-port calls and leaves
 *               every tracked file byte-identical (AC-060-2); a conflicting
 *               hook file is excluded from the ledger entirely
 *   ERROR:      an injected write failure excludes that one path from the
 *               ledger while its siblings are still tracked
 *   STATE:      a previously ledger-tracked hook that a user has since
 *               hand-edited is DROPPED from the ledger on the next run —
 *               never overwritten, never deleted from disk
 *   REGRESSION: the ledger's `claude_dir` field holds `repoDir` (the D1
 *               field-reuse decision) and the whole document re-parses
 *               against `setupManifestSchema` unchanged
 *
 * @spec_ref AC-060-1, AC-060-2
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
const HOOK_TARGET_PATHS = Object.keys(HOOK_ASSET_CONTENTS).map((name) => `hooks/${name}`);
const TREE_YAML_CONTENT = "root: prd\n";

interface FakeFile {
  content: string;
  mode: number;
}

/** In-memory, flat-map `ProjectFsPort` fake. Tracks writer-port call counts for AC-060-2's zero-calls assertion. */
class InMemoryProjectFs implements ProjectFsPort {
  files = new Map<string, FakeFile>();
  writerCalls = { writeFile: 0, mkdir: 0, backup: 0, remove: 0 };

  exists(path: string): boolean {
    if (this.files.has(path)) return true;
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
    this.writerCalls.writeFile++;
    this.files.set(path, { content, mode });
  }

  mkdir(_path: string): void {
    this.writerCalls.mkdir++;
  }

  backup(src: string, destDir: string): void {
    this.writerCalls.backup++;
    const file = this.files.get(src);
    if (!file) throw new Error(`backup: no such file "${src}"`);
    const name = src.split("/").pop() as string;
    this.files.set(`${destDir}/${name}`, { ...file });
  }

  /**
   * `_opts` is DECLARED even though this fake ignores it (D8 of
   * spec-lore-setup-deletes-repo-source-through-dev-symlinks): a double typed
   * `remove(path)` silently opts OUT of the required-boundary constraint,
   * re-opening in test space the hole the required parameter exists to close.
   */
  remove(path: string, _opts: { boundary: string }): void {
    this.writerCalls.remove++;
    this.files.delete(path);
  }

  totalWriterCalls(): number {
    return this.writerCalls.writeFile + this.writerCalls.mkdir + this.writerCalls.backup + this.writerCalls.remove;
  }

  resetWriterCalls(): void {
    this.writerCalls = { writeFile: 0, mkdir: 0, backup: 0, remove: 0 };
  }
}

/** `writeFile` throws for one specific path; every other call delegates to `base`. */
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
  let hooksPath: string | null = null;
  return {
    async run(argv: string[]) {
      if (argv[0] === "git" && argv[1] === "config" && argv[2] === "--get") {
        return hooksPath === null ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: `${hooksPath}\n`, stderr: "" };
      }
      if (argv[0] === "git" && argv[1] === "config" && argv[2] === "core.hooksPath") {
        hooksPath = argv[3] ?? null;
        return { code: 0, stdout: "", stderr: "" };
      }
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

function makeAssets(): ProjectAssetSource {
  return {
    async readAsset(name: string): Promise<Result<string, LoreError>> {
      const hookContent = HOOK_ASSET_CONTENTS[name];
      if (hookContent !== undefined) return ok(hookContent);
      if (name === "lore.tree.yaml.template") return ok(TREE_YAML_CONTENT);
      return err({ code: "VALIDATION_ERROR", field: "name", message: `unknown project asset: ${name}`, value: name });
    },
  };
}

function makeDeps(fs: InMemoryProjectFs): ProjectScaffoldFlowDeps {
  return { fs, exec: makeExec(), initCorpus: makeInitCorpus(fs), assets: makeAssets() };
}

const MANIFEST_PATH = `${REPO_DIR}/.lore/.lore-project-manifest.json`;

function readManifest(fs: InMemoryProjectFs) {
  const raw = fs.readFile(MANIFEST_PATH);
  expect(raw).not.toBeNull();
  const parsed: unknown = JSON.parse(raw as string);
  const validated = setupManifestSchema.safeParse(parsed);
  expect(validated.success).toBe(true);
  if (!validated.success) throw new Error("unreachable");
  return validated.data;
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("setup-project-flow — manifest ledger (SPEC-060 D1) — HAPPY", () => {
  it("manifest entries equal written file set", async () => {
    const fs = new InMemoryProjectFs();
    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.manifest.status).toBe("done");

    const manifest = readManifest(fs);
    const entryPaths = manifest.entries.map((e) => e.path).sort();

    const writtenPaths = [
      ...result.value.hooks.filter((h) => h.status === "done").map((h) => h.file),
      ...(result.value.tree_yaml.status === "done" ? ["lore.tree.yaml"] : []),
    ].sort();

    expect(entryPaths).toEqual(writtenPaths);
    expect(entryPaths).toEqual([...HOOK_TARGET_PATHS, "lore.tree.yaml"].sort());

    // Every hook row and tree_yaml are "done" on a genuinely fresh repo.
    for (const h of result.value.hooks) expect(h.status).toBe("done");
    expect(result.value.tree_yaml.status).toBe("done");
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("setup-project-flow — manifest ledger (SPEC-060 D1) — NEGATIVE", () => {
  it("a corrupted on-disk ledger is treated as absent — run still succeeds, ledger is rewritten valid", async () => {
    const fs = new InMemoryProjectFs();
    fs.files.set(MANIFEST_PATH, { content: "{ not: valid json", mode: 0o644 });

    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.manifest.status).toBe("done");
    const manifest = readManifest(fs);
    expect(manifest.entries.map((e) => e.path).sort()).toEqual([...HOOK_TARGET_PATHS, "lore.tree.yaml"].sort());

    // Every step still ran and wrote its files despite the corrupted ledger.
    for (const h of result.value.hooks) expect(h.status).toBe("done");
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("setup-project-flow — manifest ledger (SPEC-060 D1) — BOUNDARY", () => {
  it("second run issues 0 writer calls", async () => {
    const fs = new InMemoryProjectFs();
    const deps = makeDeps(fs);

    const first = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(first.ok).toBe(true);

    const snapshotBefore = new Map(fs.files);
    fs.resetWriterCalls();

    const second = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(fs.totalWriterCalls()).toBe(0);
    expect(second.value.manifest.status).toBe("skipped");
    for (const h of second.value.hooks) expect(h.status).toBe("skipped");
    expect(second.value.tree_yaml.status).toBe("skipped");

    // Every tracked file's bytes are unchanged.
    expect(fs.files.size).toBe(snapshotBefore.size);
    for (const [path, file] of snapshotBefore) {
      expect(fs.files.get(path)).toEqual(file);
    }
  });

  it("a conflicting hook file is excluded from the ledger entirely", async () => {
    const fs = new InMemoryProjectFs();
    fs.files.set(`${REPO_DIR}/hooks/g1-spec-create.sh`, {
      content: "#!/usr/bin/env bash\n# user-customized\n",
      mode: 0o755,
    });

    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const g1 = result.value.hooks.find((h) => h.file === "hooks/g1-spec-create.sh");
    expect(g1?.status).toBe("conflict");

    const manifest = readManifest(fs);
    const entryPaths = manifest.entries.map((e) => e.path);
    expect(entryPaths).not.toContain("hooks/g1-spec-create.sh");
    expect(entryPaths.sort()).toEqual(
      [...HOOK_TARGET_PATHS.filter((p) => p !== "hooks/g1-spec-create.sh"), "lore.tree.yaml"].sort(),
    );

    // The user's customized content is untouched.
    expect(fs.readFile(`${REPO_DIR}/hooks/g1-spec-create.sh`)).toBe("#!/usr/bin/env bash\n# user-customized\n");
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("setup-project-flow — manifest ledger (SPEC-060 D1) — ERROR", () => {
  it("an injected write failure excludes that one path from the ledger; siblings still tracked", async () => {
    const fs = new InMemoryProjectFs();
    const failingPath = `${REPO_DIR}/hooks/g2-spec-promote.sh`;
    const deps: ProjectScaffoldFlowDeps = { ...makeDeps(fs), fs: withInjectedWriteFailure(fs, failingPath) };

    const result = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const g2 = result.value.hooks.find((h) => h.file === "hooks/g2-spec-promote.sh");
    expect(g2?.status).toBe("failed");
    expect(g2?.detail).toContain("injected write failure");

    const manifest = readManifest(fs);
    const entryPaths = manifest.entries.map((e) => e.path);
    expect(entryPaths).not.toContain("hooks/g2-spec-promote.sh");
    expect(entryPaths.sort()).toEqual(
      [...HOOK_TARGET_PATHS.filter((p) => p !== "hooks/g2-spec-promote.sh"), "lore.tree.yaml"].sort(),
    );

    // Every other hook + tree_yaml still succeeded and is tracked.
    const otherHooks = result.value.hooks.filter((h) => h.file !== "hooks/g2-spec-promote.sh");
    for (const h of otherHooks) expect(h.status).toBe("done");
    expect(result.value.tree_yaml.status).toBe("done");
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("setup-project-flow — manifest ledger (SPEC-060 D1) — STATE", () => {
  it("a previously-tracked hook later hand-edited by the user is dropped from the ledger on the next run", async () => {
    const fs = new InMemoryProjectFs();
    const deps = makeDeps(fs);

    const first = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const manifestAfterFirst = readManifest(fs);
    expect(manifestAfterFirst.entries.map((e) => e.path)).toContain("hooks/g3-plan-promote.sh");

    // User hand-edits a previously lore-written hook.
    const userEdited = "#!/usr/bin/env bash\n# hand-edited after install\n";
    fs.files.set(`${REPO_DIR}/hooks/g3-plan-promote.sh`, { content: userEdited, mode: 0o755 });

    const second = await scaffoldProject(deps, { repoDir: REPO_DIR });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const g3 = second.value.hooks.find((h) => h.file === "hooks/g3-plan-promote.sh");
    expect(g3?.status).toBe("conflict");

    // Never overwritten, never deleted — the user's edit survives byte-for-byte.
    expect(fs.readFile(`${REPO_DIR}/hooks/g3-plan-promote.sh`)).toBe(userEdited);

    // Dropped from the ledger — lore no longer claims this path.
    const manifestAfterSecond = readManifest(fs);
    expect(manifestAfterSecond.entries.map((e) => e.path)).not.toContain("hooks/g3-plan-promote.sh");
    // Every other previously-tracked path is still tracked.
    for (const p of HOOK_TARGET_PATHS.filter((p) => p !== "hooks/g3-plan-promote.sh")) {
      expect(manifestAfterSecond.entries.map((e) => e.path)).toContain(p);
    }
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("setup-project-flow — manifest ledger (SPEC-060 D1) — REGRESSION", () => {
  it("claude_dir holds repoDir (field-reuse decision) and the document re-parses against setupManifestSchema", async () => {
    const fs = new InMemoryProjectFs();
    const result = await scaffoldProject(makeDeps(fs), { repoDir: REPO_DIR });
    expect(result.ok).toBe(true);

    const raw = fs.readFile(MANIFEST_PATH);
    expect(raw).not.toBeNull();
    const parsedOnce: unknown = JSON.parse(raw as string);
    const validatedOnce = setupManifestSchema.safeParse(parsedOnce);
    expect(validatedOnce.success).toBe(true);
    if (!validatedOnce.success) return;
    expect(validatedOnce.data.claude_dir).toBe(REPO_DIR);

    // Re-parsing the SAME bytes a second time is stable (pure schema, no drift).
    const parsedTwice: unknown = JSON.parse(raw as string);
    expect(setupManifestSchema.safeParse(parsedTwice).success).toBe(true);
  });
});
