// @reads assets/project/**
// @reads packages/lore/src/flows/setup-project-flow.ts
// @reads packages/lore/src/service/project-setup-service.ts
// @reads packages/lore/src/service/setup-service.ts
/**
 * ProjectSetupService + setup-project-flow suite (SPEC-046 AC-046-C).
 *
 * Exercises the repo-target scaffold behind `lore setup --project` end-to-end
 * against REAL fs/exec/asset ports, in a THROWAWAY `mkdtemp` git repo per test
 * (I6, 2026-07-07 pollution-incident rule) — the real repo's own `.lore/` and
 * its `assets/project/` tree are only ever READ (asset lookups), never written.
 *
 * `initCorpus` here is a lightweight, self-contained fixture (mkdir `.lore/` +
 * `saveConfig`) rather than the production wiring `commands/setup.ts` will
 * provide (that wiring — reusing `commands/init.ts`'s exact logic via an
 * adapter-built thunk — is a SEPARATE task, AC-046-E). This suite only proves
 * `scaffoldProject`'s OWN step orchestration: it calls `initCorpus` exactly
 * once when `.lore/` is absent, skips it when present, and treats a resolved
 * `err` the same as any other step failure.
 *
 * Coverage:
 *   HAPPY:      fresh git repo -> full scaffold, all steps done, hooks
 *               executable, hooksPath == <abs repo>/hooks
 *   NEGATIVE:   pre-existing DIFFERENT hooks/pre-push -> conflict
 *               reported, file left byte-for-byte untouched
 *   BOUNDARY:   (a) fully-scaffolded repo re-run -> everything skipped
 *               (idempotency); (b) repo with no `.git` -> git-config step
 *               fails loud, file steps still reported done
 *   ERROR:      injected fs.writeFile throw on one hook file -> that file
 *               reports failed, remaining hook files AND subsequent steps are
 *               still attempted (documented "continue" policy, not abort)
 *   STATE:      scaffold -> re-run -> byte-identical resulting tree (hash compare)
 *   REGRESSION: static import-scan — project-setup-service.ts and
 *               setup-service.ts never import each other; setup-project-flow.ts
 *               never imports anything under adapters/cli/commands/
 *
 * @spec_ref AC-046-C
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { spawnSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { ok, err } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import { saveConfig } from "@lore/core/node";

import { ProjectSetupService } from "../../../src/service/project-setup-service.js";
import {
  scaffoldProject,
  type ProjectFsPort,
  type ExecPort,
  type InitCorpus,
  type ProjectAssetSource,
  type ProjectScaffoldFlowDeps,
} from "../../../src/flows/setup-project-flow.js";

// ─── Repo-root resolution (assets-ssot.test.ts precedent) ─────────────────────
// packages/lore/tests/unit/service/project-setup-service.test.ts -> repo root is 5 levels up.

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const PROJECT_ASSETS_DIR = join(REPO_ROOT, "assets", "project");

const HOOK_FILES = [
  "pre-push",
  "reference-transaction",
];

// ─── Real port builders ─────────────────────────────────────────────────────

function makeRealFs(): ProjectFsPort {
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
  };
}

/** Wraps a real fs port, making `writeFile` throw when the target path matches `failOnPath`. */
function withInjectedWriteFailure(base: ProjectFsPort, failOnPath: string): ProjectFsPort {
  return {
    ...base,
    writeFile(path: string, content: string, mode: number): void {
      if (path === failOnPath) {
        throw new Error(`injected write failure: ${path}`);
      }
      base.writeFile(path, content, mode);
    },
  };
}

function makeRealExec(): ExecPort {
  return {
    async run(argv: string[], cwd: string) {
      const [cmd, ...args] = argv;
      if (!cmd) {
        return { code: -1, stdout: "", stderr: "empty argv" };
      }
      const result = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
      if (result.error) {
        return { code: -1, stdout: "", stderr: result.error.message };
      }
      return {
        code: result.status ?? -1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
  };
}

function makeRealAssetSource(): ProjectAssetSource {
  return {
    async readAsset(name: string): Promise<Result<string, LoreError>> {
      try {
        const content = readFileSync(join(PROJECT_ASSETS_DIR, name), "utf-8");
        return ok(content);
      } catch {
        return err({
          code: "VALIDATION_ERROR",
          field: "name",
          message: `unknown or unreadable project asset: ${name}`,
          value: name,
        });
      }
    },
  };
}

/**
 * Lightweight `.lore/` bootstrap fixture — NOT the production wiring (see
 * module docstring). Creates `.lore/config.yaml` via the real SSOT
 * `saveConfig`, proving the flow's `initCorpus` call actually lands on disk.
 */
const testInitCorpus: InitCorpus = async (repoDir: string) => {
  return saveConfig(repoDir, { project: { name: "test-project", author: "test" } });
};

function makeRealDeps(): ProjectScaffoldFlowDeps {
  return {
    fs: makeRealFs(),
    exec: makeRealExec(),
    initCorpus: testInitCorpus,
    assets: makeRealAssetSource(),
  };
}

// ─── Throwaway repo fixture (I6 — never the real repo's own .lore/) ───────────

const tempDirs: string[] = [];

function makeThrowawayGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-project-setup-"));
  tempDirs.push(dir);
  execSync("git init -q", { cwd: dir });
  return dir;
}

/** A throwaway dir with NO `.git` ancestor — used for the BOUNDARY "no git" case. */
function makeThrowawayNonGitDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-project-setup-nogit-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** Recursively hashes every file's relative path + POSIX mode + content under `root`, order-independent. */
function hashTree(root: string): string {
  const rows: string[] = [];
  const walk = (dir: string, prefix: string) => {
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

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("scaffoldProject — HAPPY", () => {
  it("fresh git repo: full scaffold, all steps done, hooks executable, hooksPath wired", async () => {
    const repoDir = makeThrowawayGitRepo();
    const service = new ProjectSetupService(makeRealDeps());

    const result = await service.scaffold(repoDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.init.status).toBe("done");
    expect(existsSync(join(repoDir, ".lore", "config.yaml"))).toBe(true);

    expect(result.value.hooks).toHaveLength(HOOK_FILES.length);
    for (const hookName of HOOK_FILES) {
      const row = result.value.hooks.find((h) => h.file === `hooks/${hookName}`);
      expect(row?.status).toBe("done");
      const abs = join(repoDir, "hooks", hookName);
      expect(existsSync(abs)).toBe(true);
      const mode = statSync(abs).mode & 0o777;
      expect(mode & 0o111).not.toBe(0); // owner/group/other execute bit set
    }

    expect(result.value.tree_yaml.status).toBe("done");
    expect(existsSync(join(repoDir, "lore.tree.yaml"))).toBe(true);

    expect(result.value.git_hooks_path.status).toBe("done");
    expect(result.value.git_hooks_path.prior_value).toBeNull();
    const hooksPath = execSync("git config --get core.hooksPath", { cwd: repoDir }).toString().trim();
    expect(hooksPath).toBe(join(repoDir, "hooks"));
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("scaffoldProject — NEGATIVE", () => {
  it("existing DIFFERENT hooks/pre-push reports conflict and is left untouched", async () => {
    const repoDir = makeThrowawayGitRepo();
    mkdirSync(join(repoDir, "hooks"), { recursive: true });
    const customContent = "#!/usr/bin/env bash\n# user-customized, do not overwrite\n";
    writeFileSync(join(repoDir, "hooks", "pre-push"), customContent, { mode: 0o755 });

    const service = new ProjectSetupService(makeRealDeps());
    const result = await service.scaffold(repoDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const g1Row = result.value.hooks.find((h) => h.file === "hooks/pre-push");
    expect(g1Row?.status).toBe("conflict");
    expect(g1Row?.detail).toBeDefined();

    // Untouched — byte-for-byte the user's custom content, not the shipped asset.
    const onDisk = readFileSync(join(repoDir, "hooks", "pre-push"), "utf-8");
    expect(onDisk).toBe(customContent);

    // Every OTHER hook file still scaffolds normally — one conflict never blocks the rest.
    const otherRows = result.value.hooks.filter((h) => h.file !== "hooks/pre-push");
    for (const row of otherRows) {
      expect(row.status).toBe("done");
    }
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("scaffoldProject — BOUNDARY", () => {
  it("re-run over an already-scaffolded repo reports every step skipped (idempotency)", async () => {
    const repoDir = makeThrowawayGitRepo();
    const service = new ProjectSetupService(makeRealDeps());

    const first = await service.scaffold(repoDir);
    expect(first.ok).toBe(true);

    const second = await service.scaffold(repoDir);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.init.status).toBe("skipped");
    for (const row of second.value.hooks) {
      expect(row.status).toBe("skipped");
    }
    expect(second.value.tree_yaml.status).toBe("skipped");
    expect(second.value.git_hooks_path.status).toBe("skipped");
    expect(second.value.git_hooks_path.prior_value).toBe(join(repoDir, "hooks"));
  });

  it("repo with no .git ancestor: git-config step fails loud, file steps still done", async () => {
    const repoDir = makeThrowawayNonGitDir();
    const service = new ProjectSetupService(makeRealDeps());

    const result = await service.scaffold(repoDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.git_hooks_path.status).toBe("failed");
    expect(result.value.git_hooks_path.detail).toBeTruthy();

    // File-based steps are independent of git presence — still fully scaffolded.
    expect(result.value.init.status).toBe("done");
    expect(result.value.tree_yaml.status).toBe("done");
    for (const row of result.value.hooks) {
      expect(row.status).toBe("done");
    }
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("scaffoldProject — ERROR", () => {
  it("injected fs write failure on one hook file: that file fails, remaining hooks and later steps still attempted", async () => {
    const repoDir = makeThrowawayGitRepo();
    const failingTarget = join(repoDir, "hooks", "pre-push");
    const deps: ProjectScaffoldFlowDeps = {
      ...makeRealDeps(),
      fs: withInjectedWriteFailure(makeRealFs(), failingTarget),
    };

    const result = await scaffoldProject(deps, { repoDir });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const failedRow = result.value.hooks.find((h) => h.file === "hooks/pre-push");
    expect(failedRow?.status).toBe("failed");
    expect(failedRow?.detail).toContain("injected write failure");
    expect(existsSync(failingTarget)).toBe(false);

    // Policy under test (documented in setup-project-flow.ts module invariants):
    // steps and per-file operations are fully independent — a failure never
    // aborts the remaining hook files or the remaining steps.
    const otherHookRows = result.value.hooks.filter((h) => h.file !== "hooks/pre-push");
    for (const row of otherHookRows) {
      expect(row.status).toBe("done");
    }
    expect(result.value.tree_yaml.status).toBe("done");
    expect(result.value.git_hooks_path.status).toBe("done");
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("scaffoldProject — STATE", () => {
  it("scaffold then re-run yields a byte-identical resulting tree (hash compare)", async () => {
    const repoDir = makeThrowawayGitRepo();
    const service = new ProjectSetupService(makeRealDeps());

    const first = await service.scaffold(repoDir);
    expect(first.ok).toBe(true);
    const hashAfterFirst = hashTree(repoDir);

    const second = await service.scaffold(repoDir);
    expect(second.ok).toBe(true);
    const hashAfterSecond = hashTree(repoDir);

    expect(hashAfterSecond).toBe(hashAfterFirst);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("scaffoldProject — REGRESSION (static import boundaries)", () => {
  /** Import specifiers (module paths) referenced by `source`'s top-level `import` statements. */
  function importSpecifiers(source: string): string[] {
    const specifiers: string[] = [];
    const importRegex = /^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(source)) !== null) {
      const spec = match[1];
      if (spec) specifiers.push(spec);
    }
    return specifiers;
  }

  /** True if any import specifier's basename (sans extension) is exactly `name` — never a substring/prefix match. */
  function importsModuleNamed(specifiers: string[], name: string): boolean {
    return specifiers.some((spec) => {
      const basename = spec.split("/").pop() ?? spec;
      const withoutExt = basename.replace(/\.(js|ts)$/, "");
      return withoutExt === name;
    });
  }

  it("project-setup-service.ts does not import setup-service.ts", () => {
    const source = readFileSync(
      new URL("../../../src/service/project-setup-service.ts", import.meta.url),
      "utf-8",
    );
    expect(importsModuleNamed(importSpecifiers(source), "setup-service")).toBe(false);
  });

  it("setup-service.ts (if present) does not import project-setup-service.ts", () => {
    const setupServicePath = join(REPO_ROOT, "packages", "lore", "src", "service", "setup-service.ts");
    if (!existsSync(setupServicePath)) {
      // Sibling task (SetupService lifecycle) may not have landed on this branch yet —
      // the boundary is vacuously satisfied; this test re-activates the moment it does.
      return;
    }
    const source = readFileSync(setupServicePath, "utf-8");
    expect(importsModuleNamed(importSpecifiers(source), "project-setup-service")).toBe(false);
  });

  it("setup-project-flow.ts does not import anything under adapters/cli/commands/", () => {
    const source = readFileSync(
      new URL("../../../src/flows/setup-project-flow.ts", import.meta.url),
      "utf-8",
    );
    const specifiers = importSpecifiers(source);
    const commandImports = specifiers.filter((spec) => spec.includes("adapters/cli/commands/"));
    expect(commandImports).toEqual([]);
  });
});
