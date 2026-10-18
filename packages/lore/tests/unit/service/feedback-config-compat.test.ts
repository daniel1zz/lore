/**
 * RED scenarios for AC-GI-10 (spec-the-defect-channel-reaches-no-machine-but-
 * its-own-github): `feedback.inbound.open_report_cap` is a RETIRED config key
 * that must go on parsing forever — the key is never removed from
 * `FeedbackConfigSchema`, only its six runtime consumer symbols (enumerated in
 * that spec's Scope section — deliberately not repeated here as literal
 * identifiers, since AC-GI-9's oracle is a case-sensitive scan of exactly
 * those six strings across `packages/**`, this file included) are deleted by
 * the paired implementation task (`task-skill-delete-the-six-cap-symbols-and-
 * retire-the-cap-config-key-without-removing-it`). This file is the RED half
 * of that red/green pair: it must fail against TODAY's schema and turn green
 * only once that task lands `open_report_cap` as `.optional()` plus a
 * by-name `console.warn`.
 *
 * Runner: vitest (no `bun:sqlite` import anywhere in this file or its
 * transitive imports).
 *
 * Six-dimension coverage, one scenario per `it`:
 *   HAPPY    — the key present + numeric parses AND warns by name
 *   STATE    — the resolved config exposes no cap-derived value at all
 *   NEGATIVE — no `feedback` section at all parses with NO warning (proves
 *              the warning is conditional on the key's presence, not
 *              unconditional noise)
 *   NEGATIVE (falsifier) — an UNRELATED unknown key under `feedback.inbound`
 *              still fails. This is the mandatory fourth scenario: without
 *              it, an implementer could satisfy the first three by replacing
 *              `.strict()` with `.passthrough()` on `inbound`, which would
 *              silently destroy schema strictness while leaving scenarios
 *              1-3 green.
 *
 * ⛔ This file does not touch `packages/core/src/config.ts` — it is anchored
 * to the RED task only. The cap-deletion task (anchor-locked against this
 * task) owns the schema edit.
 */

import { describe, it, expect, vi } from "vitest";
import { FeedbackConfigSchema, retiredConfigKeyNotices } from "@lore/core";

/** Flattens every recorded `console.warn` call's arguments into one string, so a
 * substring check for the retired key's name is robust to whatever exact
 * message shape the paired implementation picks (single string, template
 * literal, multiple args, …). */
function flattenWarnCalls(warnSpy: ReturnType<typeof vi.spyOn>): string {
  return warnSpy.mock.calls.map((args) => args.map((a) => String(a)).join(" ")).join("\n");
}

describe("feedback-config-compat: retired open_report_cap key parses with a warning while strict mode stays intact (AC-GI-10)", () => {
  it("HAPPY: a config carrying feedback.inbound.open_report_cap with a numeric value parses successfully and emits a warning naming the key", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const raw = { inbound: { open_report_cap: 7 } };

      const result = FeedbackConfigSchema.safeParse(raw);

      // Today this already succeeds (the field is a plain positive int with a
      // default) — the failing half of THIS scenario is the warning below.
      expect(result.success).toBe(true);

      // The schema prints nothing (no process stream below the entry); the by-name notice is the pure
      // `retiredConfigKeyNotices` of the raw config, printed by the loader through the run's stderr.
      expect(warnSpy).not.toHaveBeenCalled();
      expect(retiredConfigKeyNotices({ feedback: raw }).join("\n")).toContain("open_report_cap");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("STATE: once parsing succeeds, the resolved config exposes no cap-derived value that any code path could act on", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const raw = { inbound: { open_report_cap: 7 } };

      const result = FeedbackConfigSchema.safeParse(raw);
      expect(result.success).toBe(true);

      // RED today: the current schema echoes the given value back verbatim
      // (`result.data.inbound.open_report_cap === 7`) because the field is
      // `.default()`, not stripped after validation. Once the paired task
      // lands, a reader can no longer observe a numeric cap here at all —
      // property access must come back `undefined` whether the field was
      // stripped outright or merely left unset post-transform.
      if (result.success) {
        expect(result.data.inbound.open_report_cap).toBeUndefined();
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("NEGATIVE: a config with no feedback section at all parses with no warning — the warning is conditional on the key's presence, not unconditional noise", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // `FeedbackConfigSchema.safeParse({})` is this codebase's own idiom for
      // "no feedback section configured at all" (config.ts's other
      // `resolve*` helpers fall back THROUGH a schema parse of `{}` rather
      // than restating a shipped default as a literal) — not a partial
      // `inbound` fixture.
      const result = FeedbackConfigSchema.safeParse({});

      expect(result.success).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(retiredConfigKeyNotices({})).toEqual([]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("NEGATIVE (falsifier): an unrelated unknown key under feedback.inbound still FAILS — the retired key is a targeted exemption, strict mode is otherwise intact", () => {
    // No warnSpy needed — this scenario is about the parse RESULT, not warnings.
    // Deliberately does NOT also carry `open_report_cap`, so this scenario is
    // isolated from the exemption under test: it must fail purely because of
    // `.strict()`, both today and after the paired task lands.
    const raw = { inbound: { some_other_typo_field: true } };

    const result = FeedbackConfigSchema.safeParse(raw);

    // Already green today (current schema is `.strict()`), and MUST stay
    // green after the cap-key exemption lands. If an implementer satisfies
    // the three scenarios above by swapping `.strict()` for `.passthrough()`
    // on `inbound`, this assertion is the one that turns red and catches it.
    expect(result.success).toBe(false);
  });
});
