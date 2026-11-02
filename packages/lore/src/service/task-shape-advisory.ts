/**
 * Task-body shape fingerprint and the "repeated task" advisory (spec-helpers-may-change-files-by-any-means-territory-is
 * S3, BR-1564, AC-AT-3).
 *
 * Purpose: find groups of three or more open tasks of one plan whose bodies are the same text with only counts, paths or
 * ids differing, and word one advisory per group that suggests a single scripted task.
 * Public surface: {@link normaliseTaskShape}, {@link findRepeatedTaskShapes}, {@link formatRepeatedTaskAdvisory},
 * {@link REPEATED_TASK_GROUP_MIN}, {@link OPEN_TASK_STATUSES}.
 * Invariants: pure and deterministic; a group is 3+ tasks sharing one non-empty fingerprint; groups and the tasks inside
 * them keep the input order; the result never decides whether an approval succeeds.
 * Side-effect class: pure.
 */

/** Fewest open tasks with one shape that count as a repetition worth an advisory. */
export const REPEATED_TASK_GROUP_MIN = 3;

/** Statuses of a task that is still open work (a task past `active` is archived or deprecated and is not counted). */
export const OPEN_TASK_STATUSES: ReadonlySet<string> = new Set(["draft", "approved", "active"]);

/** The part of a task the fingerprint needs: its slug, status and body text. */
export interface TaskShapeInput {
  readonly slug: string;
  readonly status: string;
  readonly content: string;
}

/** One group of open tasks sharing a shape: the shared fingerprint and the member slugs in input order. */
export interface RepeatedTaskGroup {
  readonly fingerprint: string;
  readonly slugs: readonly string[];
}

// reason: rule order is load-bearing. Ids and typed slugs go before paths (a slug inside a path is one path), paths before
// bare kebab slugs, and digits last so a digit inside an id or path is already gone. Changing the order changes which
// texts collapse together. See AC-AT-3.
const ULID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;
const TYPED_ID = /\b(?:AC|BR|AS|AD|SPEC|PRD|ADR|PR|BUG)-[A-Za-z0-9-]*\d[A-Za-z0-9-]*\b/g;
const DOC_SLUG = /\b(?:task|plan|spec|prd|adr|knowledge|issue)-[a-z0-9]+(?:-[a-z0-9]+)*\b/gi;
const FILE_PATH = /(?:[\w.@~-]+\/)+[\w.@-]*|\b[\w-]+\.(?:[cm]?[jt]sx?|json|ya?ml|md|toml|sql|sh|css|html|py|rs|go|txt)\b/g;
const KEBAB_SLUG = /\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/gi;
const DIGITS = /\d+/g;

/**
 * Reduces a task body to its shape: lowercase, ULIDs, typed ids (AC-X-1, BR-12), document slugs, file paths and
 * three-or-more-part kebab slugs each replaced by a placeholder, then every digit run by `<n>`, then whitespace collapsed.
 *
 * @param content - the task body
 * @returns the shape text; two bodies of the same shape give equal text
 * @example
 * normaliseTaskShape("Rename foo in src/a.ts at 12 sites") === normaliseTaskShape("Rename foo in lib/b/c.ts at 7 sites")
 */
export function normaliseTaskShape(content: string): string {
  return content
    .replace(ULID, "<id>")
    .replace(TYPED_ID, "<id>")
    .replace(DOC_SLUG, "<id>")
    .replace(FILE_PATH, "<path>")
    .replace(KEBAB_SLUG, "<id>")
    .replace(DIGITS, "<n>")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Groups the open tasks by shape and keeps the groups of {@link REPEATED_TASK_GROUP_MIN} or more.
 *
 * @param tasks - the plan's tasks (any status; non-open ones are ignored)
 * @returns the repeated groups, in the order their first member appears
 */
export function findRepeatedTaskShapes(tasks: readonly TaskShapeInput[]): RepeatedTaskGroup[] {
  const byShape = new Map<string, string[]>();
  for (const task of tasks) {
    if (!OPEN_TASK_STATUSES.has(task.status)) continue;
    const fingerprint = normaliseTaskShape(task.content);
    if (fingerprint === "") continue;
    const members = byShape.get(fingerprint);
    if (members === undefined) byShape.set(fingerprint, [task.slug]);
    else members.push(task.slug);
  }
  const groups: RepeatedTaskGroup[] = [];
  for (const [fingerprint, slugs] of byShape) {
    if (slugs.length >= REPEATED_TASK_GROUP_MIN) groups.push({ fingerprint, slugs });
  }
  return groups;
}

/**
 * The one-line advisory of a group.
 *
 * @param group - a group from {@link findRepeatedTaskShapes}
 * @param planSlug - the plan the tasks belong to
 * @returns text naming every task and suggesting one scripted task
 */
export function formatRepeatedTaskAdvisory(group: RepeatedTaskGroup, planSlug: string): string {
  return (
    `Advisory: ${group.slugs.length} open tasks of ${planSlug} have near-identical bodies (${group.slugs.join(", ")}). ` +
    `Consider one scripted task that makes the whole change instead of ${group.slugs.length} hand-made ones.`
  );
}
