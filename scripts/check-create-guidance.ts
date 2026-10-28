#!/usr/bin/env bun
/**
 * Shipped-guidance oracle for BR-709 (`bun scripts/check-create-guidance.ts [--root <dir>]`).
 *
 * Purpose: every command example of `lore create knowledge|adr|plan` that the
 * product ships (assets/** and string literals under packages/lore/src) names
 * `--parent`, and the shipped guidance states that an ad-hoc task with
 * criteria names its governing spec with `--spec`. Guidance, product hints and
 * the refusal message must show one command shape (spec D5).
 *
 * Public surface: `scanCreateGuidance(files)`, `collectGuidanceFiles(root)`,
 * `evaluateGuidance(report)`; the CLI prints one summary line and exits 0/1.
 * Invariants: a logical line is a physical line joined with its
 * backslash-continued successors; a line that describes a refusal is skipped;
 * a scan that finds no example at all fails (an empty scan proves nothing).
 * Side effects: the CLI reads files under the root; the scan functions are pure.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface GuidanceFile {
  readonly path: string;
  readonly text: string;
}

export interface GuidanceExample {
  readonly path: string;
  readonly line: number;
  readonly command: string;
  readonly hasParent: boolean;
}

export interface GuidanceReport {
  readonly examples: readonly GuidanceExample[];
  readonly skippedRefusals: number;
  readonly statesAdhocSpec: boolean;
}

const CREATE_COMMAND = /lore create (?:knowledge|adr|plan)\b/g;
const REFUSAL_WORDS = /\b(?:rejects?|refus\w*)\b/i;
const ADHOC_SPEC_STATEMENT = /--adhoc\b[^\n]*--spec\b/;
const SOURCE_PREFIX = "packages/lore/src/";

interface LogicalLine {
  readonly line: number;
  readonly text: string;
}

function joinContinuations(text: string): LogicalLine[] {
  const physical = text.split("\n");
  const logical: LogicalLine[] = [];
  for (let index = 0; index < physical.length; index++) {
    let joined = physical[index] ?? "";
    const start = index + 1;
    while (joined.endsWith("\\") && index + 1 < physical.length) {
      index++;
      joined = `${joined.slice(0, -1)} ${(physical[index] ?? "").trim()}`;
    }
    logical.push({ line: start, text: joined });
  }
  return logical;
}

function isSourceCommentLine(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*");
}

/** Lists every create example in the given files; pure. */
export function scanCreateGuidance(files: readonly GuidanceFile[]): GuidanceReport {
  const examples: GuidanceExample[] = [];
  let skippedRefusals = 0;
  let statesAdhocSpec = false;
  for (const file of files) {
    const inSource = file.path.startsWith(SOURCE_PREFIX);
    const lines = joinContinuations(file.text);
    if (!inSource && lines.some((l) => ADHOC_SPEC_STATEMENT.test(l.text))) statesAdhocSpec = true;
    for (const logical of lines) {
      if (inSource && isSourceCommentLine(logical.text)) continue;
      const starts = [...logical.text.matchAll(CREATE_COMMAND)].map((m) => m.index ?? 0);
      if (starts.length === 0) continue;
      if (REFUSAL_WORDS.test(logical.text)) {
        skippedRefusals += starts.length;
        continue;
      }
      starts.forEach((start, i) => {
        const segment = logical.text.slice(start, starts[i + 1] ?? logical.text.length);
        examples.push({
          path: file.path,
          line: logical.line,
          command: segment.trim().slice(0, 100),
          hasParent: /--parent\b/.test(segment),
        });
      });
    }
  }
  return { examples, skippedRefusals, statesAdhocSpec };
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "generated" || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(md|ts|tsx|json|txt)$/.test(name)) out.push(full);
  }
}

/** Reads assets/** and packages/lore/src/** under `root`, paths relative to it. */
export function collectGuidanceFiles(root: string): GuidanceFile[] {
  const paths: string[] = [];
  for (const sub of ["assets", "packages/lore/src"]) {
    try {
      walk(join(root, sub), paths);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return paths.map((p) => ({ path: relative(root, p), text: readFileSync(p, "utf8") }));
}

/** Turns a report into the failure lines (empty when the guidance is clean). */
export function evaluateGuidance(report: GuidanceReport): string[] {
  const failures: string[] = [];
  if (report.examples.length === 0) failures.push("no `lore create knowledge|adr|plan` example found; the scan proves nothing");
  for (const example of report.examples) {
    if (!example.hasParent) failures.push(`${example.path}:${example.line} lacks --parent: ${example.command}`);
  }
  if (!report.statesAdhocSpec) {
    failures.push("shipped guidance never states that an ad-hoc task with criteria names --spec (`lore create task --adhoc ... --spec <spec>`)");
  }
  return failures;
}

function main(argv: readonly string[]): number {
  const rootFlag = argv.indexOf("--root");
  const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const root = rootFlag >= 0 ? resolve(argv[rootFlag + 1] ?? "") : defaultRoot;
  const report = scanCreateGuidance(collectGuidanceFiles(root));
  const failures = evaluateGuidance(report);
  const withParent = report.examples.filter((e) => e.hasParent).length;
  const summary = `examples=${report.examples.length} withParent=${withParent} skippedRefusals=${report.skippedRefusals} adhocSpecStated=${report.statesAdhocSpec}`;
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error(`check-create-guidance FAIL: ${summary}`);
    return 1;
  }
  console.log(`check-create-guidance PASS: ${summary}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
