/**
 * Pre-push hook-pair parity suite (SPEC-080 G5, AC-080-3).
 *
 * There are two on-disk copies of the pre-push corpus-conformance hook:
 * `hooks/pre-push` (the repo's OWN activated hook, wired via
 * `git config core.hooksPath hooks`) and `assets/project/pre-push` (the
 * vendored SSOT copy `lore setup --project` installs into a THIRD PARTY
 * repo). They must never drift apart — a fix applied to one and forgotten
 * in the other is exactly the "SSOT↔installed-pair" bidirectional-divergence
 * lesson this repo has hit before (see root CLAUDE.md's dogfood log), now
 * mechanized for this specific pair. This suite is a pure `node:fs` read
 * against the repo's own checked-in files — no store, no `bun:sqlite`, no
 * subprocess.
 *
 * Coverage:
 *   HAPPY:      both copies exist, are byte-identical, and both invoke
 *               `lore audit --verify` (SPEC-080 G5's new push-time chain
 *               check) alongside the pre-existing `lore status
 *               --check-tree --check-drift` step.
 *   NEGATIVE:   a synthetic divergent copy (one extra trailing byte) is
 *               NOT reported byte-identical by the same comparison this
 *               suite uses on the real pair — proves the equality check
 *               itself isn't a tautological always-pass.
 *   BOUNDARY:   both copies fail open — the fail-open preamble
 *               (`command -v lore` / `.lore` dir check) precedes BOTH the
 *               tree/drift step and the new audit-verify step, so an
 *               absent `lore` binary or `.lore` directory still exits 0
 *               before either check ever runs.
 *   ERROR:      the `--no-verify` bypass note from the pre-SPEC-080 hook is
 *               preserved verbatim in both copies (a maintainer reading
 *               either file still finds the escape hatch documented).
 *   STATE:      both copies remain executable (owner-execute bit set) —
 *               the same regression `assets-ssot.test.ts` already guards
 *               for the whole `assets/` tree, re-asserted here for this
 *               specific pair since this suite is this pair's dedicated
 *               conformance oracle.
 *   REGRESSION: the pre-existing `lore status --check-tree --check-drift`
 *               step is still present in both copies — the new
 *               `lore audit --verify` step is additive, not a replacement.
 *
 * @spec_ref AC-080-3
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Locate the REAL repo-root hook pair ───────────────────────────────────
// packages/lore/tests/unit/assets/pre-push-parity.test.ts -> repo root is
// 5 levels up from this file's own directory.

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const REPO_HOOK_PATH = join(REPO_ROOT, "hooks", "pre-push");
const ASSET_HOOK_PATH = join(REPO_ROOT, "assets", "project", "pre-push");

describe("pre-push hook pair — content parity + audit-verify wiring (SPEC-080 G5)", () => {
  it("HAPPY: both hook copies exist on disk", () => {
    expect(existsSync(REPO_HOOK_PATH)).toBe(true);
    expect(existsSync(ASSET_HOOK_PATH)).toBe(true);
  });

  it("HAPPY: both hook copies are byte-identical", () => {
    const repoHook = readFileSync(REPO_HOOK_PATH, "utf8");
    const assetHook = readFileSync(ASSET_HOOK_PATH, "utf8");
    expect(repoHook).toBe(assetHook);
  });

  it("HAPPY: both hook copies invoke `lore audit --verify`", () => {
    const repoHook = readFileSync(REPO_HOOK_PATH, "utf8");
    const assetHook = readFileSync(ASSET_HOOK_PATH, "utf8");
    expect(repoHook).toContain("lore audit --verify");
    expect(assetHook).toContain("lore audit --verify");
  });

  it("NEGATIVE: the byte-identity check is not a tautological always-pass", () => {
    const repoHook = readFileSync(REPO_HOOK_PATH, "utf8");
    const divergent = `${repoHook}\n# an unsanctioned local edit`;
    expect(repoHook).not.toBe(divergent);
  });

  it("BOUNDARY: the fail-open preamble precedes both the tree/drift check and the audit-verify check, in both copies", () => {
    for (const path of [REPO_HOOK_PATH, ASSET_HOOK_PATH]) {
      const content = readFileSync(path, "utf8");
      const preambleIdx = content.indexOf("command -v lore");
      const loreDirIdx = content.indexOf(".lore");
      const treeDriftIdx = content.indexOf("lore status --check-tree --check-drift");
      const auditVerifyIdx = content.indexOf("lore audit --verify");

      expect(preambleIdx).toBeGreaterThanOrEqual(0);
      expect(loreDirIdx).toBeGreaterThanOrEqual(0);
      expect(treeDriftIdx).toBeGreaterThan(preambleIdx);
      expect(auditVerifyIdx).toBeGreaterThan(preambleIdx);
      expect(auditVerifyIdx).toBeGreaterThan(treeDriftIdx);
    }
  });

  it("ERROR: the --no-verify bypass note is preserved verbatim in both copies", () => {
    const repoHook = readFileSync(REPO_HOOK_PATH, "utf8");
    const assetHook = readFileSync(ASSET_HOOK_PATH, "utf8");
    expect(repoHook).toContain("Bypass: git push --no-verify");
    expect(assetHook).toContain("Bypass: git push --no-verify");
  });

  it("STATE: both copies keep their owner-execute bit set", () => {
    for (const path of [REPO_HOOK_PATH, ASSET_HOOK_PATH]) {
      const mode = statSync(path).mode;
      // eslint-disable-next-line no-bitwise
      expect(mode & 0o100).toBe(0o100);
    }
  });

  it("REGRESSION: the pre-existing tree/drift check is still present, additive alongside the new audit-verify step", () => {
    const repoHook = readFileSync(REPO_HOOK_PATH, "utf8");
    const assetHook = readFileSync(ASSET_HOOK_PATH, "utf8");
    expect(repoHook).toContain("lore status --check-tree --check-drift");
    expect(assetHook).toContain("lore status --check-tree --check-drift");
  });
});
