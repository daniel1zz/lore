/**
 * Dotted-path get/set/diff helpers for the Settings UI's generic config-leaf
 * editor (SPEC-064 T4). Pure, browser-safe — no `@lore/core` import needed;
 * these are display-layer tree utilities, not corpus/config validation logic
 * (validation stays server-side in `ConfigService`/`GlobalConfigService`, per
 * SPEC-064 D2 — this module never decides what is safe to write, only how to
 * read/write a JS object by dotted path and diff two snapshots of one).
 *
 * Public surface: getByPath, setByPath, buildPatchFromChangedPaths
 * Invariants:
 *   - `setByPath` never mutates its input — every ancestor on the path is
 *     shallow-cloned, exactly like the doc-editor's existing immutable-update
 *     conventions elsewhere in this package.
 *   - `buildPatchFromChangedPaths` compares `draft` against `baseline` via
 *     `Object.is` per leaf path (config leaves here are always primitives —
 *     the generic row editor never renders an `<input>` for a complex/array/
 *     object leaf, see `ConfigScopePanel`) and returns a MINIMAL nested patch
 *     containing only the changed paths — this is what keeps
 *     `ConfigService.update`'s `restart_required` honest (SPEC-062 D5: it is
 *     computed from the PATCH's own touched keys, not a value-level diff) —
 *     sending the whole config tree as "the patch" would mark every key
 *     touched, including unrelated `sync.*`/`ai.*` restart-classified keys.
 *
 * Side-effect class: pure
 * Source: SPEC-064 §Design D5 (freeze base at edit-start); SPEC-062 D5 (honest restart_required)
 */

/**
 * Read a dotted-path leaf value off an arbitrary object. Returns `undefined`
 * for any missing intermediate segment (never throws).
 *
 * @param obj - Source object (typically a redacted `LoreConfig`/`GlobalLoreConfig`).
 * @param path - Dotted path, e.g. `"workflow.claim_ttl_minutes"`.
 */
export function getByPath(obj: unknown, path: string): unknown {
  let node: unknown = obj;
  for (const segment of path.split(".")) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * Immutably set a dotted-path leaf value, cloning every ancestor on the path.
 * Intermediate segments that don't yet exist (or aren't plain objects) are
 * created as fresh `{}` — this is how an edit to a currently-ABSENT key
 * (e.g. `sync.enabled` on a fresh corpus with no `sync:` section at all)
 * produces a well-formed nested patch object.
 *
 * @param obj - Source object — never mutated.
 * @param path - Dotted path to set.
 * @param value - New leaf value.
 * @returns A new object with `value` set at `path`; all untouched branches
 *   are the SAME references as in `obj` (structural sharing).
 */
export function setByPath<T>(obj: T, path: string, value: unknown): T {
  const segments = path.split(".");
  function recur(node: unknown, depth: number): unknown {
    const isObj = node !== null && typeof node === "object" && !Array.isArray(node);
    const base: Record<string, unknown> = isObj ? { ...(node as Record<string, unknown>) } : {};
    const segment = segments[depth];
    if (segment === undefined) return node;
    if (depth === segments.length - 1) {
      base[segment] = value;
    } else {
      base[segment] = recur(base[segment], depth + 1);
    }
    return base;
  }
  // reason: `recur` rebuilds the SAME structural shape as `obj` (only the one
  // leaf at `path` changes) — safe generic widen-back-to-`T`, not a claim
  // about a DIFFERENT runtime shape (P3 in ai-anti-patterns.md).
  return recur(obj, 0) as T;
}

/**
 * Diffs `draft` against `baseline` over exactly `candidatePaths`, and builds
 * a minimal nested patch object containing only the leaves that changed.
 *
 * @param baseline - The snapshot frozen at edit-start (SPEC-064 D5).
 * @param draft - The live-edited working copy.
 * @param candidatePaths - The full set of dotted paths this editor COULD have
 *   changed (i.e. every editable `FieldSpec.path` for the scope) — only these
 *   are compared, so a read-only/complex leaf can never accidentally end up
 *   in the outgoing patch.
 * @returns `{patch, changedPaths}` — `patch` is `{}` (zero keys) when nothing
 *   changed; `changedPaths` is the flat list of dotted paths that differ,
 *   useful for UI summaries without re-deriving them from `patch`.
 */
export function buildPatchFromChangedPaths(
  baseline: unknown,
  draft: unknown,
  candidatePaths: readonly string[],
): { patch: Record<string, unknown>; changedPaths: string[] } {
  const changedPaths: string[] = [];
  let patch: Record<string, unknown> = {};
  for (const path of candidatePaths) {
    const before = getByPath(baseline, path);
    const after = getByPath(draft, path);
    if (!Object.is(before, after)) {
      changedPaths.push(path);
      patch = setByPath(patch, path, after);
    }
  }
  return { patch, changedPaths };
}
