/**
 * Pure H2 section-structure checks for project memory files
 * (spec-claude-md-root-section-structure-check-and-adoption-mode, D1/D5/D6).
 *
 * Public surface:
 *   - parseH2Headings(content) — every depth-2 heading with its 1-based line.
 *   - checkRootStructure(file, required) — root file: deterministic
 *     `section_missing` / `section_order` / `section_duplicate`, advisory
 *     `section_extra` / `section_empty`.
 *   - checkModuleStructure(file, required) — module file: advisory
 *     `module_section_missing` only.
 *
 * Invariants:
 *   - Every deterministic finding it returns is exit-relevant: there is no adoption mode that
 *     downgrades findings (retired by task-memory-file-limits-are-always-enforced-the-warn-adoption).
 *   - Heading match is CommonMark-exact via mdast (depth === 2, top-level
 *     only): ATX and setext H2 count; `###`, fenced/indented code and
 *     blockquoted headings do not. Text is trimmed, case-sensitive, never
 *     normalised further (D5).
 *   - `required` is a parameter, never read from `@lore/core` here, so the
 *     list can become configurable without changing these signatures (D6).
 *
 * Side-effect class: pure (no IO, no store, no clock)
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import type { Heading, RootContent } from "mdast";
import type { AdvisoryFinding, MemoryFileFinding, MemoryFileRecord } from "./claude-md-findings.js";

/** One depth-2 heading: trimmed text and 1-based source line. */
export interface H2Heading {
  text: string;
  line: number;
}

/** The root-structure check result: exit-relevant findings kept apart from advisories. */
export interface RootStructureResult {
  deterministic: MemoryFileFinding[];
  advisory: AdvisoryFinding[];
}

/** An HTML node that is nothing but comment(s) counts as empty body content. */
const HTML_COMMENT_ONLY = /^\s*(?:<!--[\s\S]*?-->\s*)+$/;

interface LocatedH2 {
  /** Index into the root's top-level children. */
  index: number;
  text: string;
  line: number;
}

function isH2(node: RootContent): node is Heading {
  return node.type === "heading" && node.depth === 2;
}

function locateH2(children: RootContent[]): LocatedH2[] {
  const located: LocatedH2[] = [];
  children.forEach((node, index) => {
    if (isH2(node)) located.push({ index, text: toString(node).trim(), line: node.position?.start.line ?? 0 });
  });
  return located;
}

/**
 * Lists every `## ` heading outside code, in document order.
 *
 * @param content - Raw markdown.
 * @returns Headings with trimmed text and 1-based line.
 * @example
 * parseH2Headings("# T\n\n## A\n"); // => [{ text: "A", line: 3 }]
 */
export function parseH2Headings(content: string): H2Heading[] {
  return locateH2(fromMarkdown(content).children).map(({ text, line }) => ({ text, line }));
}

/**
 * Root-file structure check: the `required` H2 sections must each appear once
 * and in the given order. Extra H2 sections and empty bodies are advisory only.
 *
 * @param file - The memory file (`path` is echoed into every finding).
 * @param required - Required H2 names, in required document order.
 * @returns `deterministic` (exit-relevant when adoption is `enforce`) and `advisory`.
 * @example
 * checkRootStructure({ path: "CLAUDE.md", role: "root", content: "" }, ["Commands"]).deterministic[0]?.kind;
 * // => "section_missing"
 */
export function checkRootStructure(file: MemoryFileRecord, required: readonly string[]): RootStructureResult {
  const children = fromMarkdown(file.content).children;
  const h2 = locateH2(children);
  const deterministic: MemoryFileFinding[] = [];
  const advisory: AdvisoryFinding[] = [];

  const firstByName = new Map<string, LocatedH2 & { ordinal: number }>();
  const counts = new Map<string, number>();
  h2.forEach((heading, ordinal) => {
    counts.set(heading.text, (counts.get(heading.text) ?? 0) + 1);
    if (!firstByName.has(heading.text)) firstByName.set(heading.text, { ...heading, ordinal });
  });

  for (const name of required) {
    if (!firstByName.has(name)) {
      deterministic.push({
        path: file.path,
        kind: "section_missing",
        role: file.role,
        reference: name,
        message: `${file.path}: required section "## ${name}" is missing`,
      });
    }
  }

  for (const name of required) {
    const n = counts.get(name) ?? 0;
    if (n > 1) {
      deterministic.push({
        path: file.path,
        kind: "section_duplicate",
        role: file.role,
        reference: name,
        measured: n,
        message: `${file.path}: section "## ${name}" appears ${n} times — each required section must appear exactly once`,
      });
    }
  }

  // Order: walk the PRESENT required sections in document order; one that sits
  // after a section the contract places later is out of order.
  const present = required
    .flatMap((name, requiredIndex) => {
      const first = firstByName.get(name);
      return first === undefined ? [] : [{ name, requiredIndex, first }];
    })
    .sort((a, b) => a.first.ordinal - b.first.ordinal);
  let highestRequiredIndex = -1;
  for (const entry of present) {
    if (entry.requiredIndex < highestRequiredIndex) {
      deterministic.push({
        path: file.path,
        kind: "section_order",
        role: file.role,
        reference: entry.name,
        message: `${file.path}:${entry.first.line}: section "## ${entry.name}" is out of order — required order is ${required.map((r) => `"${r}"`).join(", ")}`,
      });
    } else {
      highestRequiredIndex = entry.requiredIndex;
    }
  }

  const requiredSet = new Set<string>(required);
  const reportedExtra = new Set<string>();
  for (const heading of h2) {
    if (requiredSet.has(heading.text) || reportedExtra.has(heading.text)) continue;
    reportedExtra.add(heading.text);
    advisory.push({
      kind: "section_extra",
      path: file.path,
      reference: heading.text,
      message: `${file.path}:${heading.line}: extra section "## ${heading.text}" is not part of the required structure (advisory only, exit code unaffected)`,
    });
  }

  for (const name of required) {
    const first = firstByName.get(name);
    if (first === undefined) continue;
    const next = h2.find((heading) => heading.index > first.index);
    const body = children.slice(first.index + 1, next === undefined ? undefined : next.index);
    const hasContent = body.some((node) => !(node.type === "html" && HTML_COMMENT_ONLY.test(node.value)));
    if (!hasContent) {
      advisory.push({
        kind: "section_empty",
        path: file.path,
        reference: name,
        message: `${file.path}:${first.line}: required section "## ${name}" has no content (advisory only, exit code unaffected)`,
      });
    }
  }

  return { deterministic, advisory };
}

/**
 * Module-file structure check — ADVISORY ONLY (spec Scope: module files never
 * gate). One `module_section_missing` per absent required section.
 *
 * @param file - The module memory file.
 * @param required - Required H2 names for a module file.
 * @returns Advisory findings; empty when every required section is present.
 * @example
 * checkModuleStructure({ path: "a/CLAUDE.md", role: "module", content: "" }, ["Purpose"]).length; // => 1
 */
export function checkModuleStructure(file: MemoryFileRecord, required: readonly string[]): AdvisoryFinding[] {
  const present = new Set(parseH2Headings(file.content).map((heading) => heading.text));
  return required
    .filter((name) => !present.has(name))
    .map((name) => ({
      kind: "module_section_missing" as const,
      path: file.path,
      reference: name,
      message: `${file.path}: module section "## ${name}" is missing (advisory only, exit code unaffected)`,
    }));
}
