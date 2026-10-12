/**
 * Deterministic duplicate-line detector for context fragments.
 * Spec: spec-rule-store-git-tracked-fragment-selection-on-demand-skill (Scope 5, AC-RS-4); rule BR-1067.
 *
 * Public surface: `findDuplicateLines`, `ReadingGroup`, `DuplicateFinding`.
 * Invariants:
 *   - Pure (no IO, no clock); never mutates inputs; output is sorted (group, line, first.id, second.id, kind).
 *   - A duplicate is the same line in two DIFFERENT fragments (by id) of ONE reading group.
 *     Fragments in different groups are never compared (a main session never reads a helper-only
 *     fragment, and two helper types never read each other's).
 *   - Lines compare exactly (`kind: "exact"`) or after collapsing whitespace runs and trimming
 *     (`kind: "whitespace"`, only when no exact match exists between that fragment pair).
 *   - The same line repeated inside ONE fragment is not a finding.
 *   - Ignored lines (never compared): blank lines; Markdown headings (`#`..`######`);
 *     fenced code delimiters (``` and ~~~); horizontal rules (3+ of `-`, `*` or `_`);
 *     the managed fingerprint comment line (`<!-- lore:managed`).
 *   - Known limit: restating a line in another language is NOT detected (by design).
 * Input is the already-selected fragments per reading group; the caller builds it from
 * `selectFragments` output per outlet (a `Fragment` satisfies `ReadingFragment` structurally).
 * Side-effect class: pure.
 */

/** Structural subset of `Fragment` this module reads. */
export interface ReadingFragment {
  readonly frontmatter: { readonly id: string };
  readonly path: string;
  readonly body: string;
}

/** Fragments one session reads together, e.g. `main`, `subagent:tester`. */
export interface ReadingGroup {
  readonly group: string;
  readonly fragments: readonly ReadingFragment[];
}

export interface DuplicateFinding {
  readonly group: string;
  /** Whitespace-normalized line text. */
  readonly line: string;
  readonly kind: "exact" | "whitespace";
  /** The pair, ordered by fragment id ascending. */
  readonly first: { readonly id: string; readonly path: string };
  readonly second: { readonly id: string; readonly path: string };
}

const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const FENCE = /^\s*(```|~~~)/;
const HORIZONTAL_RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const MANAGED_COMMENT = /^\s*<!--\s*lore:managed/;

function isIgnored(line: string): boolean {
  return (
    line.trim() === "" ||
    HEADING.test(line) ||
    FENCE.test(line) ||
    HORIZONTAL_RULE.test(line) ||
    MANAGED_COMMENT.test(line)
  );
}

function normalize(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/** normalized line -> set of raw lines (CR stripped) in one fragment. */
function indexFragment(body: string): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const rawWithCr of body.split("\n")) {
    const raw = rawWithCr.replace(/\r$/, "");
    if (isIgnored(raw)) continue;
    const key = normalize(raw);
    const raws = index.get(key) ?? new Set<string>();
    raws.add(raw);
    index.set(key, raws);
  }
  return index;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function findDuplicateLines(groups: readonly ReadingGroup[]): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];
  for (const { group, fragments } of groups) {
    const sorted = [...fragments].sort((a, b) => compareStrings(a.frontmatter.id, b.frontmatter.id));
    const indexed = sorted.map((f) => ({ f, index: indexFragment(f.body) }));
    for (let i = 0; i < indexed.length; i++) {
      for (let j = i + 1; j < indexed.length; j++) {
        const a = indexed[i]!;
        const b = indexed[j]!;
        if (a.f.frontmatter.id === b.f.frontmatter.id) continue;
        for (const [line, rawsA] of a.index) {
          const rawsB = b.index.get(line);
          if (rawsB === undefined) continue;
          const exact = [...rawsA].some((raw) => rawsB.has(raw));
          findings.push({
            group,
            line,
            kind: exact ? "exact" : "whitespace",
            first: { id: a.f.frontmatter.id, path: a.f.path },
            second: { id: b.f.frontmatter.id, path: b.f.path },
          });
        }
      }
    }
  }
  return findings.sort(
    (x, y) =>
      compareStrings(x.group, y.group) ||
      compareStrings(x.line, y.line) ||
      compareStrings(x.first.id, y.first.id) ||
      compareStrings(x.second.id, y.second.id) ||
      compareStrings(x.kind, y.kind),
  );
}
