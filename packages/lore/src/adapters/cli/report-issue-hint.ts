/**
 * Single wording SSOT for the SPEC-073 error-path "report an issue" hint — one line,
 * appended to a CLI error/gate-denial's stderr output ONLY when both (a) the failure
 * is classified as a `"gate"` denial or an `"internal"` error, AND (b) the calling
 * corpus has `feedback.upstream` configured (SPEC-072's reporting channel is actually
 * reachable). Every other combination (a plain non-gate VALIDATION_ERROR, a CLI usage
 * error, an unconfigured consumer) renders `null` — the two call sites
 * (`./loader.ts`'s internal-error branches, `./commands/gate.ts`'s blocked-output
 * branches) MUST treat `null` as "print nothing", never a placeholder string.
 *
 * Public surface:
 *   - `buildReportIssueHint(errClass, upstreamConfigured)` — the sole hint-text builder.
 *
 * Invariants:
 *   - Re-verify-first wording: the hint always tells the reader to re-check their OWN
 *     input/config before filing, mirroring the vendored corpus-workflow stanza this
 *     spec also adds to `assets/` (SPEC-073 §Scope "vendored discipline") — a caller
 *     must never be nudged to file a report as a reflex before ruling out user error.
 *   - Deliberately takes a pre-computed `boolean` for `upstreamConfigured`, NOT a
 *     `LoreConfig` object — callers derive it via
 *     `report-issue-wiring.ts::resolveFeedbackUpstreamCfg`, so this module stays
 *     import-light (zero dependencies) and safe to import from ANY seam regardless of
 *     that seam's own vitest-reachability (unlike `report-issue-wiring.ts`, which
 *     value-imports `bun:sqlite` transitively via `../../store/sqlite-store.js`).
 *   - Pure: no IO, no `process.exit`, no config parsing. Callers are responsible for
 *     wrapping the call in a `try/catch` if there's any risk of a caller-side crash —
 *     this function itself has no failure mode (string interpolation only) but the
 *     defensive wrapping still belongs at the CALL SITE per SPEC-073 §Design ("hint
 *     resolution can NEVER turn a working error path into a crash").
 *
 * Side-effect class: pure
 *
 * Source: SPEC-073 §Design, §Scope
 */

/** The two error classes this hint ever renders for; every other case renders `null`. */
export type ReportIssueHintErrClass = "gate" | "internal" | null;

/**
 * Builds the one-line "file this upstream" hint for a CLI error/gate-denial's stderr
 * output.
 *
 * @param errClass - `"gate"` when the failing `LoreError.field` starts with `"gate:"`
 *   (a service-layer or pre-flight gate denial); `"internal"` when the failure is a
 *   `STORE_ERROR` or an unexpected (non-`LoreError`) throw; `null` for every other
 *   error (plain `VALIDATION_ERROR`, `DOC_NOT_FOUND`, CLI usage errors, etc.) — those
 *   never earn a hint regardless of configuration.
 * @param upstreamConfigured - whether the calling corpus's own `.lore/config.yaml` has
 *   `feedback.upstream` set (via
 *   `report-issue-wiring.ts::resolveFeedbackUpstreamCfg(config) !== undefined`) — an
 *   unconfigured consumer has nowhere to file a report, so the hint would be actively
 *   unhelpful.
 * @returns the single hint line (no trailing newline — callers append their own), or
 *   `null` when either condition fails (byte-absent from stderr — REGRESSION-safe:
 *   the unconfigured/non-gate/non-internal case must reproduce the pre-SPEC-073
 *   output exactly).
 * @example
 *   buildReportIssueHint("gate", true)
 *   // => "If, after re-checking your own input, you still judge this a lore defect:
 *   //     run `lore report-issue --title <short-title> --expected <what-you-expected>
 *   //     --actual <what-happened>` to file it."
 *   buildReportIssueHint("gate", false) // => null (not configured)
 *   buildReportIssueHint(null, true)    // => null (not a gate/internal error)
 */
export function buildReportIssueHint(
  errClass: ReportIssueHintErrClass,
  upstreamConfigured: boolean,
): string | null {
  if (errClass === null || !upstreamConfigured) return null;
  return (
    "If, after re-checking your own input, you still judge this a lore defect: run " +
    "`lore report-issue --title <short-title> --expected <what-you-expected> " +
    "--actual <what-happened>` to file it."
  );
}
