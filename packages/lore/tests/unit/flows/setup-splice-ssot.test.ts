/**
 * RED pin for AC-CTX-4 (spec-context-verb-family-two-zone-claude-md-anatomy-lore):
 * "Splice SSOT holds: setup-project-flow imports spliceManagedSections from
 * context-projection (grep-pin asserts no second marker-splice implementation
 * remains)".
 *
 * `flows/setup-project-flow.ts` currently carries its OWN CLAUDE.md
 * marker-splice implementation (`computeClaudeMdCandidate` +
 * `findClaudeMdManagedRange` + a locally-declared `CLAUDE_MD_MARKER_START`/
 * `_END` constant pair) — a second, divergent implementation of the same
 * zone-splice concern `service/context-projection.ts::spliceManagedSections`
 * (landed, AC-CTX-1) already owns as the intended single source of truth.
 * This suite is a pure source-text (grep-pin) oracle, deliberately NOT a
 * behavioral one — the two implementations currently produce structurally
 * different Z1 zone formats (single-blob vs. per-section fingerprinted), so
 * asserting on OUTPUT bytes would not distinguish "still has its own splice"
 * from "consumes the shared one". Source-text presence/absence is the only
 * oracle that pins the intended refactor precisely.
 *
 * RED today (2026-07-27): setup-project-flow.ts has not yet been refactored
 * to consume `spliceManagedSections` — it still declares its own marker
 * constant and zone-math functions. This suite MUST fail until that refactor
 * lands, and turn green exactly when it does. Per the repo's own standing
 * "contiguous-substring assumption" lesson (CLAUDE.md Dogfooding log), every
 * negative condition below keys on a LONE identifier token (verified unique
 * to setup-project-flow.ts via `grep -rn <token> packages/` before authoring
 * this pin — see the task's completion report for the grep transcript), not
 * a remembered contiguous phrase.
 *
 * Coverage:
 *   HAPPY:    setup-project-flow.ts source contains an import statement
 *             naming `spliceManagedSections` from the context-projection
 *             module.
 *   NEGATIVE: setup-project-flow.ts no longer locally `const`-declares
 *             `CLAUDE_MD_MARKER_START` (import-only usage remains legal).
 *   BOUNDARY: two INDEPENDENT lone-identifier absence checks for the local
 *             zone-splice body (`findClaudeMdManagedRange`,
 *             `computeClaudeMdCandidate`) — either surviving alone still
 *             fails the suite, so the refactor can't half-land undetected.
 *   ERROR:    (not applicable — pure source-text read, no runtime failure
 *             mode to probe; the read itself would throw loudly on a moved/
 *             deleted file, which is exactly what the positive control below
 *             guards against going undetected.)
 *   STATE:    positive control — setup-project-flow.ts still exports its
 *             known public entry point (`scaffoldProject`), so a moved/
 *             renamed file fails LOUD (via a failing assertion) instead of
 *             this suite vacuously passing on an empty/wrong read.
 *   REGRESSION: companion assertion that context-projection.ts still exports
 *             `spliceManagedSections` — guards against the pin going green
 *             merely because BOTH sides lost the symbol (e.g. a bad rename
 *             sweep), not because the intended import actually landed.
 *
 * @spec_ref AC-CTX-4
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// packages/lore/tests/unit/flows/setup-splice-ssot.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const SETUP_FLOW_PATH = join(REPO_ROOT, "packages/lore/src/flows/setup-project-flow.ts");
const CONTEXT_PROJECTION_PATH = join(REPO_ROOT, "packages/lore/src/service/context-projection.ts");

describe("AC-CTX-4: setup-project-flow consumes the shared spliceManagedSections SSOT", () => {
  const flowSource = readFileSync(SETUP_FLOW_PATH, "utf8");
  const projectionSource = readFileSync(CONTEXT_PROJECTION_PATH, "utf8");

  it("HAPPY: imports spliceManagedSections from the context-projection module", () => {
    // Lone-token match inside an import statement's named-binding list, with a
    // `from "...context-projection..."` clause on the SAME import — not a
    // remembered contiguous phrase, and not satisfied by the token merely
    // appearing in a comment (the `from` clause anchors it to real import syntax).
    const importPattern =
      /import\s+(?:type\s+)?\{[^}]*\bspliceManagedSections\b[^}]*\}\s*from\s*["'][^"']*context-projection(?:\.js)?["']/;
    expect(flowSource).toMatch(importPattern);
  });

  it("NEGATIVE: no longer locally const-declares CLAUDE_MD_MARKER_START (import-only usage stays legal)", () => {
    // Keys on the DECLARATION line specifically ("const <token>"), never bare
    // usage of the token — a refactor that imports the constant and merely
    // references it elsewhere must NOT trip this assertion.
    const localConstDeclaration = /^\s*const\s+CLAUDE_MD_MARKER_START\b/m;
    expect(flowSource).not.toMatch(localConstDeclaration);
  });

  it("BOUNDARY: no longer defines its own zone-range-finder function (findClaudeMdManagedRange)", () => {
    // Verified unique to setup-project-flow.ts (grep -rn 'findClaudeMdManagedRange'
    // packages/ — only this file's own function DECLARATION plus doc-comment
    // cross-references from context-projection.ts's prose; no other code site).
    expect(flowSource).not.toMatch(/\bfindClaudeMdManagedRange\b/);
  });

  it("BOUNDARY: no longer defines its own candidate-computation function (computeClaudeMdCandidate)", () => {
    // Independent negative condition from the above — verified unique to
    // setup-project-flow.ts the same way. Two separate lone tokens so a
    // partial refactor (renaming one function but leaving the other) still
    // fails this suite instead of one assertion silently covering for both.
    expect(flowSource).not.toMatch(/\bcomputeClaudeMdCandidate\b/);
  });

  it("STATE (positive control): setup-project-flow.ts still exports its known public entry point", () => {
    // Guards against this suite silently passing on a moved/renamed/emptied
    // file — if `scaffoldProject` stopped being exported here, something is
    // structurally wrong beyond the intended splice-consolidation refactor.
    expect(flowSource).toMatch(/export\s+async\s+function\s+scaffoldProject\b/);
  });

  it("REGRESSION (companion): context-projection.ts still exports spliceManagedSections", () => {
    // Prevents this pin from going green merely because BOTH sides lost the
    // symbol (e.g. an errant rename sweep) rather than because
    // setup-project-flow.ts actually started importing the real thing.
    expect(projectionSource).toMatch(/export\s+function\s+spliceManagedSections\b/);
  });
});
