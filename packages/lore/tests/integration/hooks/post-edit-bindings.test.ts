// @spawns assets/hooks/post-edit-bindings.mjs
// @spawns packages/lore/src/index.ts
/**
 * AC-BIND-4 (spec-prose-about-code-is-bound-to-what-it-describes-one, D3): the installed PostToolUse
 * hook, fed an Edit/Write/MultiEdit of a bound file, returns additional context naming each binding
 * document and line without blocking; an unbound file returns nothing; a package.json edit that
 * changes only an unrelated script returns nothing for prose bound to another script.
 *
 * Real hook process, real stdin payloads, a throwaway git project (mkdtemp, `lore init`) and a PATH
 * `lore` shim that runs the SOURCE CLI (`lore refs --json` is the one index; the hook has no second
 * grammar). Never touches the repo's `.lore/` or the real HOME.
 *
 * Coverage: HAPPY (bound Edit lists CLAUDE.md line, fragment line, spec) / NEGATIVE (unbound file,
 * file outside the repo, unrelated script edit) / BOUNDARY (Write vs git HEAD, MultiEdit, changed
 * script triggers) / ERROR (lore unavailable: loud on stderr, exit 0, no block) / STATE (read-only).
 *
 * @spec_ref spec-prose-about-code-is-bound-to-what-it-describes-one
 * @ac_ref AC-BIND-4
 */

import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HOOK = resolve(__dirname, "../../../../../assets/hooks/post-edit-bindings.mjs");
const INDEX_TS = resolve(__dirname, "../../../src/index.ts");
const SETUP_TIMEOUT_MS = 120_000;
const CASE_TIMEOUT_MS = 60_000;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function sh(cwd: string, command: string, args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const r = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1", ...env } });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function mustSucceed(run: Run, label: string): Run {
  if (run.status !== 0) throw new Error(`${label} failed (exit ${run.status}): ${run.stderr}${run.stdout}`);
  return run;
}

const NODE_BINARY = mustSucceed(sh(tmpdir(), "which", ["node"]), "which node").stdout.trim();

// A PATH holding git (the hook needs it) but no `lore`: a directory with only a git symlink.
const gitOnlyDir = mkdtempSync(join(tmpdir(), "post-edit-bindings-git-"));
symlinkSync(mustSucceed(sh(tmpdir(), "which", ["git"]), "which git").stdout.trim(), join(gitOnlyDir, "git"));
const gitOnlyPath = gitOnlyDir;

const root = mkdtempSync(join(tmpdir(), "post-edit-bindings-"));
const shimDir = mkdtempSync(join(tmpdir(), "post-edit-bindings-shim-"));
writeFileSync(join(shimDir, "lore"), `#!/bin/sh\nexec bun run ${INDEX_TS} "$@"\n`);
chmodSync(join(shimDir, "lore"), 0o755);
const withShim = { PATH: `${shimDir}:${process.env.PATH ?? ""}` };

const PACKAGE_JSON = JSON.stringify({ name: "fixture", scripts: { build: "tsc", lint: "eslint ." } }, null, 2) + "\n";

function lore(args: string[]): Run {
  return sh(root, "bun", ["run", INDEX_TS, ...args]);
}

mustSucceed(sh(root, "git", ["init", "-q"]), "git init");
sh(root, "git", ["config", "user.email", "t@t.t"]);
sh(root, "git", ["config", "user.name", "t"]);
mustSucceed(lore(["init"]), "lore init");
patchLoreConfig(root, ["workflow:", "  gates:", "    spec-create:", "      enabled: false", ""].join("\n"));
mkdirSync(join(root, "src"), { recursive: true });
mkdirSync(join(root, ".lore", "context"), { recursive: true });
writeFileSync(join(root, "src", "widget.ts"), "export function renderWidget() {}\n");
writeFileSync(join(root, "src", "unbound.ts"), "export const Alone = 1;\n");
writeFileSync(join(root, "package.json"), PACKAGE_JSON);
writeFileSync(join(root, "CLAUDE.md"), ["# Fixture", "", "The widget lives in `src/widget.ts`.", "", "Build it with `bun run build`.", ""].join("\n"));
writeFileSync(
  join(root, ".lore", "context", "widget-rules.md"),
  ["---", "id: project-widget-rules", "title: Widget rules", 'audience: ["subagent:*"]', "mode: static", "---", "Never edit `src/widget.ts#renderWidget` by hand.", ""].join("\n"),
);
const created = mustSucceed(lore(["create", "spec", "--title", "Widget Contract", "--no-ai", "--content", "## Goal\n\nBody.", "--json"]), "create spec");
const specSlug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
mustSucceed(lore(["anchor", "add", specSlug, "src/widget.ts#renderWidget"]), "anchor add");
mustSucceed(sh(root, "git", ["add", "-A"]), "git add");
mustSucceed(sh(root, "git", ["commit", "-qm", "init"]), "git commit");

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(gitOnlyDir, { recursive: true, force: true });
});

function runHook(payload: Record<string, unknown>, env: NodeJS.ProcessEnv = withShim): Run {
  // reason: an absolute interpreter path, so a test that blanks PATH (lore unavailable) still starts the hook.
  const r = spawnSync(NODE_BINARY, [HOOK], {
    input: JSON.stringify({ hook_event_name: "PostToolUse", session_id: "S1", cwd: root, ...payload }),
    encoding: "utf8",
    env: { ...process.env, HOME: root, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function contextOf(run: Run): string {
  const parsed = JSON.parse(run.stdout) as {
    decision?: unknown;
    permissionDecision?: unknown;
    hookSpecificOutput: { hookEventName: string; additionalContext: string; permissionDecision?: unknown };
  };
  expect(parsed.decision).toBeUndefined();
  expect(parsed.permissionDecision).toBeUndefined();
  expect(parsed.hookSpecificOutput.permissionDecision).toBeUndefined();
  expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  return parsed.hookSpecificOutput.additionalContext;
}

/** Applies a package.json state on disk (PostToolUse sees the file AFTER the tool) and restores it. */
function withPackageJson(after: string, body: () => void): void {
  const path = join(root, "package.json");
  writeFileSync(path, after);
  try {
    body();
  } finally {
    writeFileSync(path, PACKAGE_JSON);
  }
}

const widget = (): string => join(root, "src", "widget.ts");
const pkg = (): string => join(root, "package.json");

describe("AC-BIND-4: post-edit-bindings hook", () => {
  it("HAPPY: an Edit of a bound file names each binding document and line, and never blocks", () => {
    const run = runHook({ tool_name: "Edit", tool_input: { file_path: widget(), old_string: "a", new_string: "b" } });

    expect(run.status).toBe(0);
    const context = contextOf(run);
    expect(context).toContain("src/widget.ts");
    expect(context).toContain("CLAUDE.md:3");
    expect(context).toContain(".lore/context/widget-rules.md:7");
    expect(context).toContain(specSlug);
  }, CASE_TIMEOUT_MS);

  it("NEGATIVE: an unbound file returns nothing", () => {
    const run = runHook({ tool_name: "Edit", tool_input: { file_path: join(root, "src", "unbound.ts"), old_string: "a", new_string: "b" } });

    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
  }, CASE_TIMEOUT_MS);

  it("NEGATIVE: a path outside the repository returns nothing", () => {
    const run = runHook({ tool_name: "Write", tool_input: { file_path: join(shimDir, "elsewhere.ts"), content: "x" } });

    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
  }, CASE_TIMEOUT_MS);

  it("NEGATIVE: a package.json edit changing only an unrelated script returns nothing for prose bound to build", () => {
    withPackageJson(PACKAGE_JSON.replace('"eslint ."', '"eslint src"'), () => {
      const run = runHook({ tool_name: "Edit", tool_input: { file_path: pkg(), old_string: '"eslint ."', new_string: '"eslint src"' } });

      expect(run.status).toBe(0);
      expect(run.stdout).toBe("");
    });
  }, CASE_TIMEOUT_MS);

  it("HAPPY: a package.json edit changing the bound script names the prose line", () => {
    withPackageJson(PACKAGE_JSON.replace('"tsc"', '"tsc -b"'), () => {
      const run = runHook({ tool_name: "Edit", tool_input: { file_path: pkg(), old_string: '"tsc"', new_string: '"tsc -b"' } });

      expect(run.status).toBe(0);
      const context = contextOf(run);
      expect(context).toContain("CLAUDE.md:5");
      expect(context).toContain("build");
    });
  }, CASE_TIMEOUT_MS);

  it("BOUNDARY: a Write is compared with git HEAD (unrelated script silent, bound script reported)", () => {
    withPackageJson(PACKAGE_JSON.replace('"eslint ."', '"eslint src"'), () => {
      const run = runHook({ tool_name: "Write", tool_input: { file_path: pkg(), content: "disk holds the result" } });
      expect(run.stdout).toBe("");
    });
    withPackageJson(PACKAGE_JSON.replace('"tsc"', '"tsc -b"'), () => {
      const run = runHook({ tool_name: "Write", tool_input: { file_path: pkg(), content: "x" } });
      expect(contextOf(run)).toContain("CLAUDE.md:5");
    });
  }, CASE_TIMEOUT_MS);

  it("BOUNDARY: a MultiEdit touching the bound script is reported, one touching only lint is not", () => {
    withPackageJson(PACKAGE_JSON.replace('"tsc"', '"tsc -b"').replace('"eslint ."', '"eslint src"'), () => {
      const run = runHook({
        tool_name: "MultiEdit",
        tool_input: {
          file_path: pkg(),
          edits: [
            { old_string: '"tsc"', new_string: '"tsc -b"' },
            { old_string: '"eslint ."', new_string: '"eslint src"' },
          ],
        },
      });
      expect(contextOf(run)).toContain("CLAUDE.md:5");
    });
    withPackageJson(PACKAGE_JSON.replace('"eslint ."', '"eslint src"'), () => {
      const run = runHook({ tool_name: "MultiEdit", tool_input: { file_path: pkg(), edits: [{ old_string: '"eslint ."', new_string: '"eslint src"' }] } });
      expect(run.stdout).toBe("");
    });
  }, CASE_TIMEOUT_MS);

  it("ERROR: lore unavailable is said on stderr, exits 0 and emits no block", () => {
    const run = runHook({ tool_name: "Edit", tool_input: { file_path: widget(), old_string: "a", new_string: "b" } }, { PATH: gitOnlyPath });

    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("[post-edit-bindings] `lore` not found on PATH");
  }, CASE_TIMEOUT_MS);

  it("STATE: the hook is read-only (the working tree is unchanged by it)", () => {
    const before = sh(root, "git", ["status", "--porcelain"]).stdout;
    runHook({ tool_name: "Edit", tool_input: { file_path: widget(), old_string: "a", new_string: "b" } });

    expect(sh(root, "git", ["status", "--porcelain"]).stdout).toBe(before);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain("src/widget.ts");
  }, CASE_TIMEOUT_MS);
}, SETUP_TIMEOUT_MS);
