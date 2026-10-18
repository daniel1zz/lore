/**
 * Ownership decision for lore rules files (BR-1176, spec D1): decides, from a file's own managed header,
 * whether a refresh may overwrite or delete it. Ownership is RECORDED (fragment source identity in the
 * header), never inferred from the `lore-` file-name prefix; when it cannot be proven the file is KEPT.
 *
 * Public surface: `rulesSourceId`, `classifyExistingRulesFile`, `RulesOwnership`.
 * Invariants:
 *   - Pure: bytes in, verdict out. No fs, no clock, no env.
 *   - "prune" is returned ONLY for a file whose header parses, names the SAME source id as this refresh,
 *     and whose body hash is still intact. Every doubt maps to a skip verdict.
 *   - A legacy file (header without `source=`) is never pruned; selected + byte-equal to this refresh's
 *     legacy-shape render it is adopted, otherwise it is kept as `legacy_skip`.
 * Side-effect class: pure.
 * Spec: spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D1; ADR adr-ambient-process-state-is-read-once-at-the-entry-one part 3.
 */
import { parseRulesFile } from "./section.js";

/** Verdict for one existing `lore-*.md` file. */
export type RulesOwnership =
  /** Same source, body intact: this refresh owns the file and may rewrite (selected) or delete (deselected) it. */
  | { readonly kind: "owned" }
  /** Same source but the body was hand-edited after refresh wrote it: keep, report `diverged_skip`. */
  | { readonly kind: "diverged" }
  /** Header names a different fragment source folder: keep, report `foreign_skip`. */
  | { readonly kind: "foreign" }
  /** No source identity (written before BR-1176) or no parseable header: keep unless adoptable, report `legacy_skip`. */
  | { readonly kind: "legacy"; readonly adoptable: boolean };

/**
 * Identity of the fragment source one refresh read, recorded in each rules file header.
 *
 * reason: user scope draws ONLY from the user layer (select.ts LAYERS_BY_OUTLET), so its identity is the user
 * `context/` folder. Project scope files are committed to the repo and must stay byte-identical across machines
 * and HOMEs (AC-CV-3, AC-ISCOPE-1(b), `setup --project --check`), so no folder path may enter their bytes:
 * project scope records NO source (`null`) and keeps the intact-header ownership test; its target folder is
 * repo-relative, so the wrong-folder incident class (a resolved HOME) cannot occur there.
 *
 * @param scope Which memory scope this refresh renders.
 * @param userDir Port path of `<userConfigDir>/context` (used only for scope "user").
 * @returns The string recorded in each rules file header, or `null` when the scope records none.
 */
export function rulesSourceId(scope: "project" | "user", userDir: string): string | null {
  return scope === "user" ? `user=${userDir}` : null;
}

/**
 * Classifies the bytes currently on disk for a rules file this refresh is about to touch.
 *
 * @param existing Complete bytes of the existing file.
 * @param sourceId This refresh's {@link rulesSourceId}.
 * @param legacyRender For a selected fragment, the legacy-shape (no `source=`) render of what this refresh
 *   would write; a legacy file byte-equal to it is adoptable. `null` for a deselected file (never adoptable).
 */
export function classifyExistingRulesFile(existing: string, sourceId: string | null, legacyRender: string | null): RulesOwnership {
  const parsed = parseRulesFile(existing);
  if (parsed === null) return { kind: "legacy", adoptable: false };
  if (sourceId === null) {
    // Scope records no source: a file that DOES name one was written by another scope's refresh.
    if (parsed.sourceId !== null) return { kind: "foreign" };
    return parsed.intact ? { kind: "owned" } : { kind: "diverged" };
  }
  if (parsed.sourceId === null) return { kind: "legacy", adoptable: legacyRender !== null && existing === legacyRender };
  if (parsed.sourceId !== sourceId) return { kind: "foreign" };
  return parsed.intact ? { kind: "owned" } : { kind: "diverged" };
}
