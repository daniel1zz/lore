import { describe, expect, it } from "vitest";
import { formatRepeatCheckWarning } from "../../../src/adapters/cli/report-issue-wiring.js";

describe("AC-RL-2: the repeat-check degradation warning is printed, never silent (BR-500)", () => {
  it("STATE: the formatter prints exactly one 'Warning: repeat check degraded' line for a degraded result and none for a clean one", () => {
    const clean = { number: 1, url: "u", possible_duplicates: [], dedup_degraded: false, retried: false };
    expect(formatRepeatCheckWarning(clean)).toBeUndefined();

    const unreadable = formatRepeatCheckWarning({ ...clean, repeat_check_degraded: { reason: "unreadable", detail: "EACCES", skipped_lines: 0 } });
    expect(unreadable).toBe("Warning: repeat check degraded (EACCES) — filed anyway.");
    expect(unreadable?.split("\n")).toHaveLength(1);

    // The ending follows the OUTCOME (retried), not the reason: corrupt lines + a NEW filing is "filed anyway".
    const degraded = { reason: "corrupt_lines" as const, detail: "2 unreadable line(s)", skipped_lines: 2 };
    expect(formatRepeatCheckWarning({ ...clean, retried: false, repeat_check_degraded: degraded })).toBe(
      "Warning: repeat check degraded (2 unreadable line(s)) — filed anyway.",
    );
    expect(formatRepeatCheckWarning({ ...clean, retried: true, repeat_check_degraded: degraded })).toBe(
      "Warning: repeat check degraded (2 unreadable line(s)) — recognised from the readable entries.",
    );
  });
});
