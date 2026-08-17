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
 * ⛔ THIS SUITE IS NOT AUTOMATICALLY REACHED BY A HOOK-ONLY CHANGE. See
 * {@link REPO_HOOK_RELATIVE}'s doc comment for the measured reason and for what
 * does protect that change set today (the selector's loud-zero refusal).
 *
 * @spec_ref AC-080-3
 * @spec_ref spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor AC-BFI-9
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Locate the REAL repo-root hook pair ───────────────────────────────────
// packages/lore/tests/unit/assets/pre-push-parity.test.ts -> repo root is
// 5 levels up from this file's own directory.

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");

/**
 * The two repo-relative paths this suite judges, written as LITERAL strings
 * (never assembled from `join("hooks", "pre-push")` segments) so `grep
 * 'hooks/pre-push'` finds this file — the only mechanism by which a human or a
 * future selector rule can discover that this suite is the oracle for that pair.
 *
 * ⛔ MEASURED, so nobody re-derives it optimistically: adding these literals does
 * NOT make `bun run test:changed` select this file on a hook-only change set, and
 * they are not here for that. `scripts/changed-tests.ts`'s tree-scanning rule (d)
 * gates membership on {@link BARE_MAIN_INVOCATION_RE} — a bare `main()` call this
 * suite has no reason to contain — and BOTH of its scopes exclude these paths
 * anyway: `"packages-test-tree"` requires `startsWith("packages/")`, and
 * `"repo-tracked-text-source"` defers to `hasTextSourceExtension`, which is false
 * for an extensionless file (its own doc comment uses `hooks/pre-push` as the
 * worked example of `hasNoExtension`). `hooks/**` and `assets/**` are outside the
 * selector's file universe entirely. Closing that hole needs a change to
 * `scripts/changed-tests.ts`, not to this file. See
 * `knowledge-bun-run-test-changed-full-selection-contract-and-its`.
 *
 * What DOES protect a hook-only change today is the selector's loud-zero rule:
 * measured 2026-08-17, a change set of exactly these two paths selects 0 tests
 * and `test:changed` exits 1 naming both as unselected, rather than reporting a
 * hollow green. That is a refusal to answer, not coverage — this suite still has
 * to be run deliberately, or reached via a full-suite run.
 */
const REPO_HOOK_RELATIVE = "hooks/pre-push";
const ASSET_HOOK_RELATIVE = "assets/project/pre-push";

const REPO_HOOK_PATH = join(REPO_ROOT, REPO_HOOK_RELATIVE);
const ASSET_HOOK_PATH = join(REPO_ROOT, ASSET_HOOK_RELATIVE);

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

  // RED (AC-CMC-4, spec-project-claude-md-content-contract-governance-injected):
  // the paired implementation task (task-skill-implement-pre-push-pair-check-
  // step-assets-manifest) has not landed as of this test's authoring — neither
  // hook copy invokes `lore status --check-claude-md` yet, confirmed empirically
  // against this worktree's on-disk hook files. This case is therefore RED now
  // and flips GREEN once that task appends the check-claude-md step to both
  // copies (mirroring the audit --verify case immediately above, which pins the
  // SAME invariant for the SPEC-080/081 G5 step).
  it("HAPPY: both hook copies invoke `lore status --check-claude-md` (AC-CMC-4)", () => {
    const repoHook = readFileSync(REPO_HOOK_PATH, "utf8");
    const assetHook = readFileSync(ASSET_HOOK_PATH, "utf8");
    expect(repoHook).toContain("--check-claude-md");
    expect(assetHook).toContain("--check-claude-md");
  });

  // AC-BFI-9 (spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor):
  // the anchor-coverage ratchet is the hook's LAST step. Pinned on the real
  // INVOCATION token `check-anchor-coverage.ts` rather than the bare
  // `check-anchor-coverage` the criterion's own grep uses, because the bare form
  // also matches a comment — the exact G6 gap the behavioural trip suite
  // (packages/lore/tests/integration/pre-push-binary-provenance-trip.bun.test.ts)
  // exists to close, and there is no reason to reproduce it here.
  it("HAPPY: both hook copies invoke the anchor-coverage ratchet script (AC-BFI-9)", () => {
    const repoHook = readFileSync(REPO_HOOK_PATH, "utf8");
    const assetHook = readFileSync(ASSET_HOOK_PATH, "utf8");
    expect(repoHook).toContain("scripts/check-anchor-coverage.ts");
    expect(assetHook).toContain("scripts/check-anchor-coverage.ts");
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
