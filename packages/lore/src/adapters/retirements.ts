/**
 * Retirement registry: the ONE list of every shipped surface lore has retired.
 *
 * Purpose: declare, per retired surface, what it was, what replaces it and which spec
 * retired it, so `RETIRED_FROM_INSTALL_PATHS` (real-asset-source.ts) derives from here
 * and `retirement-registry.bun.test.ts` proves every row is still enforced.
 * Public surface: {@link RETIREMENTS}, {@link Retirement}, {@link RetirementKind}.
 * Invariants:
 *   - `id` is unique; `target` is unique within its `kind`.
 *   - `install-asset` rows name an `assets/`-relative path. `still_shipped: true` means the
 *     file is still physically in `assets/` (and the npm package) but never installed; those
 *     rows (and only those) feed `RETIRED_FROM_INSTALL_PATHS`, because `distribution/assemble.ts`
 *     copies every set member into the npm staging dir and a deleted file would break it.
 *     `still_shipped: false` means the file was deleted from `assets/`; the row exists so
 *     the converge test can prove a tracked copy on an old machine is removed.
 *   - `outlet` targets are the outlet id (`hook:session-start`); `settings-entry` targets are
 *     `<Event>:<hook file name>` of a retired hook registration in `settings.json`.
 *   - There is no `cli-command` kind: a removed command is simply unknown to the CLI (its ordinary
 *     unknown-command refusal), never kept registered to refuse itself.
 * Side-effect class: pure (constants only).
 *
 * @spec_ref spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-9
 */

export type RetirementKind = "install-asset" | "outlet" | "settings-entry";

/** One retired surface. */
export interface Retirement {
  readonly id: string;
  readonly kind: RetirementKind;
  readonly target: string;
  /** What a caller or an old install uses instead (a command, a path or a verb), never empty. */
  readonly replacement: string;
  /** Slug or AC id of the spec that retired it. */
  readonly spec_ref: string;
  /** `install-asset` only: true while the file is still in `assets/` (see module doc). */
  readonly still_shipped?: boolean;
}

/**
 * Every retired surface. Add a row here when retiring something; never hand-list a retired
 * path elsewhere (`RETIRED_FROM_INSTALL_PATHS` derives from this array).
 */
export const RETIREMENTS: readonly Retirement[] = [
  {
    id: "install-governance-seat-briefing",
    kind: "install-asset",
    target: "governance/seat-briefing.md",
    replacement: "lore governance --seat-briefing",
    spec_ref: "SPEC-083 D3, SPEC-085 D3",
    still_shipped: true,
  },
  {
    id: "install-governance-claude-md-contract",
    kind: "install-asset",
    target: "governance/claude-md-contract.md",
    replacement: "lore governance claude-md",
    spec_ref: "SPEC-083 D3",
    still_shipped: true,
  },
  {
    id: "install-skill-lore-init-context",
    kind: "install-asset",
    target: "skills/lore-init-context/SKILL.md",
    replacement: "lore context",
    spec_ref: "spec-context-verb-family-two-zone-claude-md-anatomy-lore AC-CTX-6",
    still_shipped: true,
  },
  {
    id: "install-agent-lore-explorer",
    kind: "install-asset",
    target: "agents/lore-explorer.md",
    replacement: "agents/lore-reader.md",
    spec_ref: "spec-two-helper-agent-types-lore-reader-and-lore-implementer AC-AT-6",
    still_shipped: false,
  },
  {
    id: "install-agent-lore-reviewer",
    kind: "install-asset",
    target: "agents/lore-reviewer.md",
    replacement: "agents/lore-reader.md",
    spec_ref: "spec-two-helper-agent-types-lore-reader-and-lore-implementer AC-AT-6",
    still_shipped: false,
  },
  {
    id: "install-hook-session-start-fragments",
    kind: "install-asset",
    target: "hooks/session-start-fragments.mjs",
    replacement: "hooks/session-start-resume.mjs",
    spec_ref: "AC-UR-5",
    still_shipped: false,
  },
  {
    id: "settings-session-start-fragments",
    kind: "settings-entry",
    target: "SessionStart:session-start-fragments.mjs",
    replacement: "SessionStart:session-start-resume.mjs",
    spec_ref: "AC-UR-5",
  },
  {
    id: "outlet-hook-session-start",
    kind: "outlet",
    target: "hook:session-start",
    replacement: "hook:subagent-start",
    spec_ref: "AC-UR-3",
  },
];
