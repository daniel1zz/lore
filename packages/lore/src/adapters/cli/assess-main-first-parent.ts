/**
 * Transitional stub: the git-backed first-parent port of the per-landing attestation is gone (criteria run once at the
 * assessed commit, AC-AO-3). Kept only so `commands/assess.ts`, which task-b1-regression-at-the-assessed-commit-by-single-file
 * holds, still resolves its import until the patch in the B2 report is applied; the patch deletes this file.
 *
 * Public surface: createGitMainFirstParent (returns an inert port).
 * Side-effect class: pure.
 *
 * @deprecated delete with the assess.ts patch (spec-a-plan-s-tests-and-criteria-are-measured-once-at-its, AC-AO-3).
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-3, BR-1498)
 */

/** Inert stand-in for the retired first-parent port. */
export type RetiredMainFirstParentPort = Readonly<Record<string, never>>;

/**
 * @param _cwd - unused
 * @param _env - unused
 * @returns an inert port
 */
export function createGitMainFirstParent(_cwd: string, _env: NodeJS.ProcessEnv): RetiredMainFirstParentPort {
  return {};
}
