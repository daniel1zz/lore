/**
 * Six-dimension tests for `selectOutputTailWindow` (verify-spawn.ts) —
 * spec-evidence-output-tail-integrity-a-self-reported-non-pass §D4: a runner-produced
 * `output_tail` witnesses the ac_ref it is filed under, by preferring a window around
 * the id's LAST occurrence over the literal stream end — but ONLY when the plain
 * stream-tail would otherwise miss it. Pure function, no Bun API, no IO — vitest-safe
 * (unlike the bun-only `verify-executor.ts` module that calls into it).
 *
 * Dimension mapping:
 *   HAPPY:      AC-ETI-7 — the id occurs earlier than the plain tail's window; the
 *               stored tail is windowed around its LAST occurrence and contains it;
 *               a second test proves "last", not "first", wins when the id repeats
 *   NEGATIVE:   AC-ETI-8 — the id never occurs anywhere in the stream (also: acRef
 *               undefined, acRef ""); result is BYTE-IDENTICAL to the pre-change plain
 *               stream-tail in every one of those cases
 *   BOUNDARY:   the id's last occurrence already sits inside the plain tail's own
 *               window (no override fires — untouched); maxChars <= 0 => ""
 *   ERROR:      never throws on a stream shorter than maxChars, an acRef longer than
 *               the stream, or an empty stream
 *   REGRESSION: output length never exceeds maxChars; a surrogate pair (astral
 *               character) anywhere near a computed window boundary is never split
 *               into an unpaired code unit (BUG-001)
 *
 * @spec_ref AC-ETI-7, AC-ETI-8
 */

import { describe, it, expect } from "vitest";
import { tailChars } from "@lore/core";
import { selectOutputTailWindow } from "../../../src/service/verify-spawn.js";

// ─── AC-ETI-7 (HAPPY) ────────────────────────────────────────────────────────────

describe("AC-ETI-7 — window around the ac_ref's last occurrence", () => {
  it("AC-ETI-7 stores a window around the ac_ref's last occurrence when it scrolled out of the plain stream-tail window", () => {
    const marker = "AC-ETI-7";
    const cap = 4000;
    const stream = `${marker} result: PASS\n${"z".repeat(20000)}`;

    // Control: prove the OLD stream-tail behavior would have LOST the id — otherwise
    // this test could pass vacuously regardless of whether the fix is even present
    // (CLAUDE.md verification discipline: no assertion both old and new satisfy).
    const naiveTail = tailChars(stream, cap);
    expect(naiveTail.includes(marker)).toBe(false);

    const result = selectOutputTailWindow(stream, marker, cap);
    expect(result.includes(marker)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(cap);
  });

  it("AC-ETI-7 windows around the LAST occurrence, not the first, when the id repeats and both scrolled out of the plain tail", () => {
    const marker = "AC-ETI-7";
    const cap = 1000;
    const leading = "x".repeat(3000);
    const middle = "m".repeat(3000);
    const trailing = "z".repeat(2000);
    // marker occurs twice: once near the very start ("attempt 1"), once several
    // thousand characters later ("attempt 2") — both are farther from the stream end
    // than `cap`, so the plain tail witnesses NEITHER occurrence at all.
    const stream = `${leading}${marker} attempt 1 failed\n${middle}${marker} attempt 2 passed\n${trailing}`;

    const naiveTail = tailChars(stream, cap);
    expect(naiveTail.includes(marker)).toBe(false);

    const result = selectOutputTailWindow(stream, marker, cap);
    expect(result.includes(marker)).toBe(true);
    expect(result.includes("attempt 2")).toBe(true);
    expect(result.includes("attempt 1")).toBe(false);
  });
});

// ─── AC-ETI-8 (CONTROL — byte identity) ─────────────────────────────────────────

describe("AC-ETI-8 — CONTROL: byte-identical to the pre-change stream-tail when ac_ref never occurs", () => {
  it("AC-ETI-8 returns byte-identical output to the pre-change tailChars result when the ac_ref does not occur anywhere in the stream", () => {
    const cap = 4000;
    // Hand-derived expected value: "PREFIX-" (7 chars) + 4000 "b"s = 4007 chars total;
    // the last 4000 chars drop exactly the 7-char prefix, leaving all-"b". Written out
    // directly rather than computed via `tailChars` here, so this assertion does not
    // depend on the very helper it's meant to pin (CLAUDE.md verification discipline).
    const stream = "PREFIX-" + "b".repeat(cap);
    const expectedPreChangeTail = "b".repeat(cap);

    const result = selectOutputTailWindow(stream, "AC-ETI-8-DOES-NOT-OCCUR-ANYWHERE", cap);
    expect(result).toBe(expectedPreChangeTail);
    expect(result.length).toBe(cap);
  });

  it("AC-ETI-8 returns byte-identical output when acRef is undefined (no row ac_ref at all)", () => {
    const cap = 4000;
    const stream = "PREFIX-" + "b".repeat(cap);
    const expectedPreChangeTail = "b".repeat(cap);

    const result = selectOutputTailWindow(stream, undefined, cap);
    expect(result).toBe(expectedPreChangeTail);
  });

  it("AC-ETI-8 returns byte-identical output when acRef is an empty string", () => {
    const cap = 4000;
    const stream = "PREFIX-" + "b".repeat(cap);
    const expectedPreChangeTail = "b".repeat(cap);

    const result = selectOutputTailWindow(stream, "", cap);
    expect(result).toBe(expectedPreChangeTail);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────────

describe("BOUNDARY", () => {
  it("an ac_ref already visible inside the plain tail's window is left untouched (no override fires)", () => {
    const cap = 100;
    const marker = "AC-ETI-7";
    const stream = `short output with ${marker} right here`;
    expect(stream.length).toBeLessThan(cap);

    const result = selectOutputTailWindow(stream, marker, cap);
    expect(result).toBe(stream); // unchanged — identical to what plain tailChars returns
  });

  it("maxChars <= 0 returns the empty string regardless of ac_ref", () => {
    expect(selectOutputTailWindow("AC-ETI-7 stuff here", "AC-ETI-7", 0)).toBe("");
    expect(selectOutputTailWindow("AC-ETI-7 stuff here", "AC-ETI-7", -5)).toBe("");
  });
});

// ─── ERROR — never throws on degenerate input ───────────────────────────────────

describe("ERROR — never throws on degenerate input", () => {
  it("does not throw when the stream is shorter than maxChars", () => {
    expect(() => selectOutputTailWindow("short", "AC-ETI-7", 4000)).not.toThrow();
  });

  it("does not throw when acRef is longer than the entire stream, and falls back to the plain tail", () => {
    expect(() => selectOutputTailWindow("hi", "AC-ETI-7-LONGER-THAN-STREAM", 4000)).not.toThrow();
    expect(selectOutputTailWindow("hi", "AC-ETI-7-LONGER-THAN-STREAM", 4000)).toBe("hi");
  });

  it("does not throw on an empty stream", () => {
    expect(() => selectOutputTailWindow("", "AC-ETI-7", 4000)).not.toThrow();
    expect(selectOutputTailWindow("", "AC-ETI-7", 4000)).toBe("");
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────────

describe("REGRESSION", () => {
  it("output length never exceeds maxChars, whether or not the window override fires", () => {
    const cap = 500;
    const withMatch = selectOutputTailWindow(
      `${"a".repeat(10000)}AC-ETI-7${"b".repeat(10000)}`,
      "AC-ETI-7",
      cap,
    );
    const withoutMatch = selectOutputTailWindow("c".repeat(10000), "AC-ETI-7", cap);
    expect(withMatch.length).toBeLessThanOrEqual(cap);
    expect(withoutMatch.length).toBeLessThanOrEqual(cap);
  });

  it("never produces a lone (unpaired) surrogate code unit even when astral characters sit near a computed window boundary (BUG-001)", () => {
    const marker = "AC-ETI-7";
    const emoji = "\u{1F600}"; // one astral code point = one surrogate PAIR (2 units)
    // Emoji scattered every few characters across the region a computed window
    // boundary is likely to fall in, so this test has a real chance of exercising a
    // boundary landing mid-pair — real safety comes from `selectOutputTailWindow`
    // composing ONLY `headChars`/`tailChars` (never a raw `.slice` on `stream`), each
    // of which self-corrects any boundary it's given (see truncate.ts).
    const pepper = Array.from({ length: 400 }, (_, i) => `${emoji}${"x".repeat(i % 5)}`).join("");
    const stream = `${pepper}${marker} done\n${"z".repeat(5000)}`;
    const cap = 300;

    const result = selectOutputTailWindow(stream, marker, cap);

    for (let i = 0; i < result.length; i++) {
      const code = result.charCodeAt(i);
      const isHigh = code >= 0xd800 && code <= 0xdbff;
      const isLow = code >= 0xdc00 && code <= 0xdfff;
      if (isHigh) {
        const next = result.charCodeAt(i + 1);
        expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
      }
      if (isLow) {
        expect(i).toBeGreaterThan(0);
        const prev = result.charCodeAt(i - 1);
        expect(prev >= 0xd800 && prev <= 0xdbff).toBe(true);
      }
    }
  });
});
