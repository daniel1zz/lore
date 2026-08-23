/**
 * Single wording SSOT for the SPEC-073 error-path "report an issue" hint — one line,
 * appended to a CLI error/gate-denial's stderr output ONLY when the failure is
 * classified as a `"gate"` denial or an `"internal"` error. A plain non-gate
 * `VALIDATION_ERROR` or a CLI usage error (`errClass === null`) renders `null`
 * regardless of configuration — the two call sites (`./loader.ts`'s internal-error
 * branches, `./commands/gate.ts`'s blocked-output branches) MUST treat `null` as
 * "print nothing", never a placeholder string.
 *
 * SPEC-OOB closed a self-lock: SPEC-073 originally rendered `null` for an
 * UNCONFIGURED consumer too (`feedback.upstream` absent from `.lore/config.yaml`) —
 * but SPEC-072's config is provisioned by no init/setup path, so a fresh consumer was
 * never told the reporting channel exists. The unconfigured branch now returns a
 * distinct one-line provision-guidance hint instead of `null`. The CONFIGURED
 * branch's wording is UNCHANGED (SPEC-073 AC-073-1 regression floor).
 *
 * ⛔ REWRITTEN (P4, spec-the-defect-channel-reaches-no-machine-but-its-own-github):
 * the unconfigured hint used to point at `lore report-issue --auto-config`
 * (SPEC-OOB's self-provisioning entry point). That flag AND the mechanism it
 * drove are deleted outright in P4 — self-provisioning only ever produced the
 * now-retired legacy SQLite shape. Pointing a caller at a flag that no longer
 * exists would be this hint's own fail-loud module lying to its caller; the
 * hint now names `feedback.upstream.repo` (the GitHub shape) directly instead.
 *
 * Public surface:
 *   - `buildReportIssueHint(errClass, upstreamConfigured)` — the sole hint-text builder.
 *
 * Invariants:
 *   - Re-verify-first wording: both the configured and unconfigured hint tell the
 *     reader to re-check their OWN input/config before filing, mirroring the vendored
 *     corpus-workflow stanza this spec also adds to `assets/` (SPEC-073 §Scope
 *     "vendored discipline") — a caller must never be nudged to file a report as a
 *     reflex before ruling out user error.
 *   - Deliberately takes a pre-computed `boolean` for `upstreamConfigured`, NOT a
 *     `LoreConfig` object — callers derive it via
 *     `report-issue-wiring.ts::resolveFeedbackUpstreamCfg`, so this module stays
 *     import-light (zero dependencies) and safe to import from ANY seam regardless of
 *     that seam's own vitest-reachability.
 *   - Pure: no IO, no `process.exit`, no config parsing. Callers are responsible for
 *     wrapping the call in a `try/catch` if there's any risk of a caller-side crash —
 *     this function itself has no failure mode (string interpolation only) but the
 *     defensive wrapping still belongs at the CALL SITE per SPEC-073 §Design ("hint
 *     resolution can NEVER turn a working error path into a crash").
 *   - Each returned string is exactly ONE physical line — never contains `\n` —
 *     because callers append their own trailing newline and write the result as a
 *     single stderr line (SPEC-073 AC-073-1 / SPEC-OOB AC-OOB-6 both assert an exact
 *     physical-line count).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-073 §Design, §Scope; SPEC-OOB §Design ("Hint SSOT unchanged... the
 *   unconfigured branch gains a return value instead of `null`"); P4 of
 *   spec-the-defect-channel-reaches-no-machine-but-its-own-github (wording rewrite).
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
 *   `report-issue-wiring.ts::resolveFeedbackUpstreamCfg(config) !== undefined`).
 *   Configured → the direct filing hint (SPEC-073, unchanged). Unconfigured → a
 *   distinct provision-guidance hint naming `feedback.upstream.repo` instead of
 *   assuming a reachable channel.
 * @returns the single hint line (no trailing newline, no embedded `\n` — callers
 *   append their own), or `null` when `errClass === null` (byte-absent from stderr —
 *   REGRESSION-safe: the non-gate/non-internal case must reproduce the pre-SPEC-073
 *   output exactly regardless of configuration).
 * @example
 *   buildReportIssueHint("gate", true)
 *   // => "If, after re-checking your own input, you still judge this a lore defect:
 *   //     run `lore report-issue --title <short-title> --expected <what-you-expected>
 *   //     --actual <what-happened>` to file it."
 *   buildReportIssueHint("gate", false)
 *   // => "If, after re-checking your own input, you still judge this a lore
 *   //     reporting gap: configure feedback.upstream.repo (e.g. \"owner/repo\") in
 *   //     .lore/config.yaml, then re-run with --title/--expected/--actual to file it."
 *   buildReportIssueHint(null, true)    // => null (not a gate/internal error)
 *   buildReportIssueHint(null, false)   // => null (not a gate/internal error)
 */
export function buildReportIssueHint(
  errClass: ReportIssueHintErrClass,
  upstreamConfigured: boolean,
): string | null {
  if (errClass === null) return null;
  if (!upstreamConfigured) {
    return (
      "If, after re-checking your own input, you still judge this a lore reporting " +
      'gap: configure feedback.upstream.repo (e.g. "owner/repo") in .lore/config.yaml, ' +
      "then re-run with --title <short-title> --expected <what-you-expected> " +
      "--actual <what-happened> to file it."
    );
  }
  return (
    "If, after re-checking your own input, you still judge this a lore defect: run " +
    "`lore report-issue --title <short-title> --expected <what-you-expected> " +
    "--actual <what-happened>` to file it."
  );
}
