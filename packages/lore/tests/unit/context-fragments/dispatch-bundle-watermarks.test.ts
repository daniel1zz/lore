// @reads assets/context/dispatch-bundle.md
// @layer unit-asset-pin
/**
 * Pins the dispatch-bundle watermark line to the 1M-context defaults
 * (prompt 30k, subagent peak 400k, main peak 800k; owner decision 2026-11-02).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BUNDLE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "..", "..", "assets", "context", "dispatch-bundle.md",
);

describe("dispatch-bundle watermarks", () => {
  const text = readFileSync(BUNDLE, "utf8");
  it("AC-WATERMARK-1M states the 1M-context watermarks", () => {
    expect(text).toContain(
      "Watermarks: dispatch under 30k tokens, subagent peak under 400k, main peak under 800k.",
    );
  });
  it("AC-WATERMARK-1M no longer carries the old 15k/40k/150k numbers", () => {
    expect(text).not.toMatch(/15k tokens|under 40k|under 150k/);
  });
});
