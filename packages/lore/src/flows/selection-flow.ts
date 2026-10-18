/**
 * `lore context list | add | remove` selection flow: which context fragments a scope has switched off,
 * persisted in a git-tracked `selection.yaml` (project) or the user config dir's `context/selection.yaml`.
 * Spec: spec-rule-store-git-tracked-fragment-selection-on-demand-skill (Scope 2 + 6, BR-1063, AC-RS-6).
 *
 * Public surface:
 *   - runSelectionList(deps) — every fragment with id, layer, delivery, size, selected.
 *   - runSelectionChange(deps, input) — `add` (re-enable) / `remove` (disable) one fragment id in one scope.
 *   - SelectionFlowDeps, SelectionListEntry, SelectionChangeInput, SelectionChangeOutcome, SelectionFlowError.
 *
 * Invariants:
 *   - Verb mapping follows the CLI: `add` re-enables (removeFromDisable), `remove` disables (addToDisable).
 *   - A missing selection file reads as `emptySelection()`; a write that leaves `disable: []` still writes the
 *     file (never deletes it) so `check` sees an explicit selection.
 *   - Writes are compare-and-swap (D8): the file is re-read right before the write and written ONLY if its
 *     sha256 equals the hash of the bytes this flow read; otherwise `CONFLICT` and the file is untouched.
 *   - Idempotent: a change that yields the file's current bytes performs no write (`changed: false`).
 *   - This flow does NOT run refresh; the CLI verb refreshes after `ok` (`changed` says whether it is needed).
 *   - Nothing throws: every failure is a `Result` error (`VALIDATION_ERROR` | `CONFLICT`).
 *   - All paths in `deps` are absolute; no env is read here.
 *
 * Side-effect class: IO through the injected FsWritePort (at most one selection-file write per change).
 */
import { createHash } from "node:crypto";
import { err, ok, type Fragment, type FragmentDelivery, type FsWritePort, type LoreError, type Result } from "@lore/core";
import { discoverFragments, type FragmentRoots } from "../service/context-fragments/discover.js";
import {
  addToDisable,
  emptySelection,
  parseSelection,
  removeFromDisable,
  serializeSelection,
  type Selection,
  type SelectionScope,
} from "../service/context-fragments/selection.js";

/** Errors this flow returns. */
export type SelectionFlowError = Extract<LoreError, { code: "VALIDATION_ERROR" | "CONFLICT" }>;

/** Everything the flow needs, resolved by the adapter (paths absolute). */
export interface SelectionFlowDeps {
  readonly fs: FsWritePort;
  /** Fragment layer roots (shipped / user / project). */
  readonly roots: FragmentRoots;
  /** Absolute path of each scope's selection file (`SELECTION_FILE` resolved against project root / user config dir). */
  readonly selectionPaths: Readonly<Record<SelectionScope, string>>;
}

/** One row of `lore context list`. */
export interface SelectionListEntry {
  readonly id: string;
  readonly layer: Fragment["layer"];
  readonly delivery: FragmentDelivery;
  /** Body length in characters. */
  readonly size: number;
  /** false when either scope's selection disables the id. */
  readonly selected: boolean;
}

export interface SelectionChangeInput {
  readonly action: "add" | "remove";
  readonly id: string;
  readonly scope: SelectionScope;
}

/** What the CLI verb needs to decide on refresh and to report. */
export interface SelectionChangeOutcome {
  readonly action: "add" | "remove";
  readonly id: string;
  readonly scope: SelectionScope;
  /** Absolute path of the selection file. */
  readonly path: string;
  /** false when the file already held the resulting bytes (nothing written). */
  readonly changed: boolean;
  readonly selection: Selection;
}

const LAYERS = ["shipped", "user", "project"] as const;

/** sha256 of file bytes; an absent file hashes to a sentinel no real content equals. */
function hashFileBytes(content: string | null): string {
  return content === null ? "absent" : `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function validationError(field: string, message: string): SelectionFlowError {
  return { code: "VALIDATION_ERROR", field, message };
}

/** Discover each layer separately: ownership checks need un-merged fragments (discoverFragments merges by id). */
async function discoverUnmerged(deps: SelectionFlowDeps): Promise<Result<Fragment[], SelectionFlowError>> {
  const all: Fragment[] = [];
  for (const layer of LAYERS) {
    const roots: FragmentRoots = { [layer]: deps.roots[layer] };
    const found = await discoverFragments(deps.fs, roots);
    if (!found.ok) return err(validationError("fragments", found.error.message));
    all.push(...found.value);
  }
  return ok(all);
}

/** Read + parse one scope's selection; returns the raw bytes too (the CAS baseline). */
async function readSelection(
  deps: SelectionFlowDeps,
  scope: SelectionScope,
): Promise<Result<{ bytes: string | null; selection: Selection }, SelectionFlowError>> {
  const path = deps.selectionPaths[scope];
  const bytes = await deps.fs.readFile(path);
  if (bytes === null) return ok({ bytes, selection: emptySelection() });
  const parsed = parseSelection(bytes, path);
  if (!parsed.ok) return err(parsed.error);
  return ok({ bytes, selection: parsed.value });
}

/**
 * List every fragment (merged view: highest layer per id) with its selection state.
 *
 * @param deps Flow deps.
 * @returns ok(entries sorted by id), or VALIDATION_ERROR (bad fragment / selection file).
 */
export async function runSelectionList(deps: SelectionFlowDeps): Promise<Result<SelectionListEntry[], SelectionFlowError>> {
  const project = await readSelection(deps, "project");
  if (!project.ok) return project;
  const user = await readSelection(deps, "user");
  if (!user.ok) return user;
  const discovered = await discoverFragments(deps.fs, deps.roots);
  if (!discovered.ok) return err(validationError("fragments", discovered.error.message));

  const disabled = new Set([...project.value.selection.disable, ...user.value.selection.disable]);
  const entries = discovered.value.map(
    (fragment): SelectionListEntry => ({
      id: fragment.frontmatter.id,
      layer: fragment.layer,
      delivery: fragment.frontmatter.delivery,
      size: fragment.body.length,
      selected: !disabled.has(fragment.frontmatter.id),
    }),
  );
  return ok(entries.sort((a, b) => a.id.localeCompare(b.id)));
}

/**
 * Enable (`add`) or disable (`remove`) one fragment in one scope's selection file, with a CAS write.
 *
 * @param deps Flow deps.
 * @param input Verb, fragment id, owning scope.
 * @returns ok(outcome), VALIDATION_ERROR (unknown id, scope does not own it, malformed file), or CONFLICT
 *   (the file changed between this flow's read and its write; nothing written).
 */
export async function runSelectionChange(
  deps: SelectionFlowDeps,
  input: SelectionChangeInput,
): Promise<Result<SelectionChangeOutcome, SelectionFlowError>> {
  const path = deps.selectionPaths[input.scope];
  const current = await readSelection(deps, input.scope);
  if (!current.ok) return current;
  const fragments = await discoverUnmerged(deps);
  if (!fragments.ok) return fragments;

  const next =
    input.action === "remove"
      ? addToDisable(current.value.selection, input.id, input.scope, fragments.value)
      : removeFromDisable(current.value.selection, input.id, fragments.value);
  if (!next.ok) return err(next.error);

  const content = serializeSelection(next.value);
  const outcome: SelectionChangeOutcome = { ...input, path, changed: content !== current.value.bytes, selection: next.value };
  if (!outcome.changed) return ok(outcome);

  // ── D8 compare-and-swap: write only if the bytes are still the ones this flow read ──
  const beforeWrite = await deps.fs.readFile(path);
  if (hashFileBytes(beforeWrite) !== hashFileBytes(current.value.bytes)) {
    return err({
      code: "CONFLICT",
      path,
      message: `refusing to write ${path} — it changed after it was read (another writer interleaved); nothing was written. Re-run the command.`,
    });
  }
  const written = await deps.fs.writeFile(path, content);
  if (!written.ok) {
    // reason: the rooted port refuses with VALIDATION_ERROR (BR-1177); any other code is a port-contract breach, surfaced as one.
    const refusal = written.error;
    return err(refusal.code === "VALIDATION_ERROR" ? refusal : validationError("path", `write of ${path} failed: ${refusal.code}`));
  }
  return ok(outcome);
}
