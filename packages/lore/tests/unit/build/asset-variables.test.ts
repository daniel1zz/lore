/**
 * @spec_ref spec-lore-owned-agent-context-is-generated-from-templates-and AC-CV-5 (D6, BR-1097)
 *
 * RED: the manifest must hash the EXPANDED bytes RealAssetSource installs, and
 * the manifest script must refuse unexpandable placeholders.
 *   HAPPY:      manifest sha256 == sha256(RealAssetSource.load()) for every skill/agent/hook;
 *               lore SKILL source has the placeholder, loaded bytes have the value.
 *   NEGATIVE:   installed-kind asset naming an invocation variable -> exit 1 naming file + var;
 *               '{{lore:' in a governance / project asset -> exit 1 naming file.
 *   REGRESSION: '--check' exits 0 on the repo tree; a clean temp tree is not refused (reverse control).
 *
 * Temp-tree runs copy the script + assets into a temp repo root. packages/core and
 * packages/lore/src children are symlinked (so the script's relative imports of the pure
 * expander + registry resolve), except packages/lore/src/generated which is a real copy so
 * the script's default-mode write can never touch the real repo.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CAPTURE_TAIL_CHARS } from "@lore/core";

import { RealAssetSource, isRetiredFromInstall } from "../../../src/adapters/real-asset-source.js";
import { ASSETS_ROOT, REPO_ROOT, buildManifest, sha256Hex } from "../../../../../scripts/embed-assets-manifest.mjs";
import { LORE_CONTEXT_VARIABLES } from "../../../src/service/context-variables-registry.js";

const SCRIPT = join(REPO_ROOT as string, "scripts", "embed-assets-manifest.mjs");
const INSTALLED_KINDS = new Set(["skill", "agent", "hook"]);

const scratch: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(d);
  return d;
}
afterEach(() => {
  while (scratch.length > 0) {
    const d = scratch.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

function runScriptOnTree(mutate: (assetsRoot: string) => void, extraArgs: string[] = []) {
  const root = tmp("lore-asset-vars-");
  const repo = REPO_ROOT as string;
  const assets = join(root, "assets");
  cpSync(ASSETS_ROOT as string, assets, { recursive: true });
  mutate(assets);
  mkdirSync(join(root, "scripts"), { recursive: true });
  cpSync(SCRIPT, join(root, "scripts", "embed-assets-manifest.mjs"));
  writeFileSync(join(root, "package.json"), readFileSync(join(repo, "package.json")));
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  mkdirSync(join(root, "packages", "lore", "src"), { recursive: true });
  symlinkSync(join(repo, "packages", "core"), join(root, "packages", "core"));
  writeFileSync(join(root, "packages", "lore", "package.json"), readFileSync(join(repo, "packages", "lore", "package.json")));
  for (const name of readdirSync(join(repo, "packages", "lore", "src"))) {
    if (name === "generated") cpSync(join(repo, "packages", "lore", "src", name), join(root, "packages", "lore", "src", name), { recursive: true });
    else symlinkSync(join(repo, "packages", "lore", "src", name), join(root, "packages", "lore", "src", name));
  }
  const proc = spawnSync("bun", [join(root, "scripts", "embed-assets-manifest.mjs"), ...extraArgs], {
    cwd: root,
    encoding: "utf8",
  });
  return { exit: proc.status, out: `${proc.stdout ?? ""}${proc.stderr ?? ""}` };
}

describe("AC-CV-5 manifest hashes the expanded install bytes", () => {
  it("registry is importable and non-empty, CAPTURE_TAIL_CHARS is a number", () => {
    expect(typeof CAPTURE_TAIL_CHARS).toBe("number");
    expect(Object.keys(LORE_CONTEXT_VARIABLES as object).length).toBeGreaterThan(0);
  });

  it("every skill/agent/hook manifest sha256 equals sha256 of RealAssetSource.load() bytes", async () => {
    const manifest = buildManifest(ASSETS_ROOT, REPO_ROOT) as unknown as { entries: { path: string; kind: string; sha256: string }[] };
    const loaded = await new RealAssetSource(ASSETS_ROOT as string).load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const byPath = new Map(loaded.value.files.map((f) => [f.path, f]));
    // Retired paths (e.g. skills/lore-init-context/SKILL.md) stay fingerprinted but are never loaded.
    const installed = manifest.entries.filter((e) => INSTALLED_KINDS.has(e.kind) && !isRetiredFromInstall(e.path));
    expect(installed.length).toBeGreaterThan(0);
    const mismatches: string[] = [];
    for (const entry of installed) {
      const file = byPath.get(entry.path);
      if (file === undefined) {
        mismatches.push(`${entry.path}: not loaded`);
        continue;
      }
      const bytes = typeof file.content === "string" ? Buffer.from(file.content, "utf8") : Buffer.from(file.content as Uint8Array);
      if (sha256Hex(bytes) !== entry.sha256) mismatches.push(`${entry.path}: manifest sha != loaded sha`);
    }
    expect(mismatches).toEqual([]);
  });

  it("lore SKILL.md source carries the placeholder and its loaded bytes carry the value", async () => {
    const source = readFileSync(join(ASSETS_ROOT as string, "skills", "lore", "SKILL.md"), "utf8");
    expect(source).toContain("{{lore:capture_tail_chars}}");
    const loaded = await new RealAssetSource(ASSETS_ROOT as string).load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const skill = loaded.value.files.find((f) => f.path === "skills/lore/SKILL.md");
    expect(skill).toBeDefined();
    const text = typeof skill?.content === "string" ? skill.content : Buffer.from(skill?.content as unknown as Uint8Array).toString("utf8");
    expect(text).toContain(String(CAPTURE_TAIL_CHARS));
    expect(text).not.toContain("{{lore:");
  });

  it("an installed-kind asset naming an invocation variable makes the script exit 1 naming file and variable", () => {
    const r = runScriptOnTree((assets) => {
      writeFileSync(join(assets, "skills", "lore", "invocation-probe.md"), "dir is {{lore:claude_dir}}\n");
    });
    expect(r.exit, r.out).toBe(1);
    expect(r.out).toContain("invocation-probe.md");
    expect(r.out).toContain("claude_dir");
  });

  it("'{{lore:' in a governance asset makes the script exit 1 naming the file", () => {
    const r = runScriptOnTree((assets) => {
      writeFileSync(join(assets, "governance", "probe-governance.md"), "count {{lore:capture_tail_chars}}\n");
    });
    expect(r.exit, r.out).toBe(1);
    expect(r.out).toContain("probe-governance.md");
  });

  it("'{{lore:' in a project asset makes the script exit 1 naming the file", () => {
    const r = runScriptOnTree((assets) => {
      writeFileSync(join(assets, "project", "probe-project.md"), "count {{lore:capture_tail_chars}}\n");
    });
    expect(r.exit, r.out).toBe(1);
    expect(r.out).toContain("probe-project.md");
  });

  it("a clean temp tree (reverse control) is not refused", () => {
    const r = runScriptOnTree(() => undefined);
    expect(r.exit, r.out).toBe(0);
  });

  it("'--check' exits 0 on the repo tree", () => {
    const proc = spawnSync("bun", [SCRIPT, "--check"], { cwd: REPO_ROOT as string, encoding: "utf8" });
    expect(proc.status, `${proc.stdout}${proc.stderr}`).toBe(0);
  });
});
