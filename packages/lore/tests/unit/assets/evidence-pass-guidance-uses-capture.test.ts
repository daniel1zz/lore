// @reads assets/**
/**
 * Shipped guidance must not teach a `lore evidence ... --result pass` form the evidence gate refuses.
 *
 * The gate (`rejectMissingPassOutputTail`, packages/lore/src/service/task-workflow-service.ts) refuses a
 * self-reported "pass" whose proof is a hand-authored `--output-tail` / `--output-tail-file`; it accepts
 * `--capture` (the runner spawns `--command` itself) and, for `--oracle manual` only, a described tail.
 * Two implementers followed the old execute rule literally, were refused, and released with zero evidence.
 *
 * This oracle scans every `assets/**` markdown file for a `lore evidence` example whose `--result` can be
 * `pass` (`pass`, `<pass|fail>`, `pass|fail`) and that lacks `--capture`. A backslash-continued shell
 * line counts as one example. A bare `--oracle manual` example is exempt (the gate's one self-report path).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const PASS_RESULT = /--result\s+<?pass\b/;
const MANUAL_ONLY = /--oracle\s+manual(?![|\w])/;

export interface UngatedPassExample {
  readonly line: number;
  readonly text: string;
}

/**
 * Pure: finds `lore evidence` examples teaching `--result pass` without `--capture`.
 *
 * @example
 * findUngatedPassExamples('lore evidence t --oracle test --command "x" --result pass');
 * // => [{ line: 1, text: 'lore evidence t --oracle test --command "x" --result pass' }]
 * @example
 * findUngatedPassExamples('lore evidence t --oracle test --command "x" --result pass --capture'); // => []
 */
export function findUngatedPassExamples(markdown: string): UngatedPassExample[] {
  const lines = markdown.split("\n");
  const found: UngatedPassExample[] = [];
  for (let i = 0; i < lines.length; i++) {
    const start = (lines[i] as string).indexOf("lore evidence");
    if (start < 0) continue;
    let text = (lines[i] as string).slice(start);
    let j = i;
    while (text.trimEnd().endsWith("\\") && j + 1 < lines.length) {
      j++;
      text += `\n${lines[j] as string}`;
    }
    if (PASS_RESULT.test(text) && !text.includes("--capture") && !MANUAL_ONLY.test(text)) {
      found.push({ line: i + 1, text: text.replace(/\s+/g, " ").trim() });
    }
  }
  return found;
}

function listMarkdown(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listMarkdown(full);
    return full.endsWith(".md") ? [full] : [];
  });
}

describe("shipped evidence guidance only teaches pass forms the gate accepts", () => {
  it("NEGATIVE: a pass example with a hand-authored tail or no capture is flagged", () => {
    expect(findUngatedPassExamples('lore evidence t --oracle test --command "x" --result pass --output-tail-file o.log')).toHaveLength(1);
    expect(findUngatedPassExamples("lore evidence t --oracle x --command y --result <pass|fail>")).toHaveLength(1);
    expect(findUngatedPassExamples('lore evidence t --oracle test \\\n  --command "x" --result pass \\\n  --ac A-1')).toHaveLength(1);
  });

  it("HAPPY/BOUNDARY: capture, expected-fail, fail-only and bare manual examples are accepted", () => {
    expect(findUngatedPassExamples('lore evidence t --oracle test --command "x" --result pass --capture')).toEqual([]);
    expect(findUngatedPassExamples('lore evidence t --oracle test \\\n  --command "x" --result pass \\\n  --capture')).toEqual([]);
    expect(findUngatedPassExamples('lore evidence t --oracle test --command "x" --result expected-fail')).toEqual([]);
    expect(findUngatedPassExamples('lore evidence t --oracle manual --command "x" --result pass --output-tail "checked"')).toEqual([]);
    expect(findUngatedPassExamples("lore evidence t --oracle <tsc|manual> --result pass")).toHaveLength(1);
  });

  it("REGRESSION: no assets/** markdown teaches --result pass without --capture", () => {
    const assetsDir = join(REPO_ROOT, "assets");
    const files = listMarkdown(assetsDir);
    expect(files.length).toBeGreaterThan(20); // liveness: the scan saw the shipped tree
    const offenders = files.flatMap((file) =>
      findUngatedPassExamples(readFileSync(file, "utf8")).map((hit) => `${relative(REPO_ROOT, file)}:${hit.line}: ${hit.text}`),
    );
    expect(offenders, "add --capture; the gate refuses a hand-authored tail for --result pass").toEqual([]);
  });
});
