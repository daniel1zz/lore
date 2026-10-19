/**
 * Three-layer context-fragment discovery.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (Module Boundary
 * discover.ts, D1 layering, D2 override-by-id).
 *
 * Public surface:
 *   - discoverFragments(fs, roots) — read `*.md` fragments from the shipped, user and
 *     project roots, validate each, and return one fragment per id (project > user > shipped).
 *   - FragmentRoots — the three root directories.
 *
 * Invariants:
 *   - Fail loud: unreadable/ill-formed frontmatter, schema violations, a duplicate id
 *     inside ONE layer, or a `<system-reminder` prefix in ANY body returns err naming the
 *     offending file path(s). Nothing is skipped silently.
 *   - The `<system-reminder` scan runs on every layer BEFORE override resolution, so a
 *     poisoned lower-layer fragment is refused even when a higher layer overrides it.
 *   - A missing layer directory is an empty layer (FsReadPort.listDir resolves `[]`).
 *   - Only `*.md` entries directly inside a root are read (not recursive).
 *   - Output order is deterministic: layers shipped → user → project, file names sorted.
 *
 * Side-effect class: Read-only IO through the injected FsReadPort.
 */
import { parse as parseYaml } from "yaml";
import {
  err,
  FragmentFrontmatterSchema,
  ok,
  splitFrontmatter,
  type Fragment,
  type FsReadPort,
  type LoreError,
  type Result,
} from "@lore/core";

/** Every discovery failure is a VALIDATION_ERROR carrying the offending path(s) in `message`. */
export type DiscoverError = Extract<LoreError, { code: "VALIDATION_ERROR" }>;

/** The layer root directories to read. A layer left out is not read at all (no placeholder path reaches the fs port). */
export interface FragmentRoots {
  readonly shipped?: string;
  readonly user?: string;
  readonly project?: string;
}

/** Lowest to highest precedence: later layers override earlier ones by frontmatter id. */
const LAYER_ORDER = ["shipped", "user", "project"] as const;

/** Body marker that could forge a harness system message; refused in every layer. */
const FORBIDDEN_BODY_MARKER = "<system-reminder";

function fail(path: string, message: string): Result<never, DiscoverError> {
  return err({ code: "VALIDATION_ERROR", field: path, message: `${path}: ${message}`, rule: "BR-898" });
}

function joinPath(root: string, name: string): string {
  return `${root.endsWith("/") ? root.slice(0, -1) : root}/${name}`;
}

async function loadFragment(
  fs: FsReadPort,
  path: string,
  layer: Fragment["layer"],
): Promise<Result<Fragment, DiscoverError>> {
  const text = await fs.readFile(path);
  if (text === null) return fail(path, "fragment file could not be read");

  const split = splitFrontmatter(text.replace(/^﻿/, "").replace(/\r\n/g, "\n"), "strict");
  if (!split.ok) return fail(path, split.error);

  let raw: unknown;
  try {
    raw = parseYaml(split.frontmatter);
  } catch (e) {
    return fail(path, `frontmatter is not valid YAML (${e instanceof Error ? e.message : String(e)})`);
  }

  const parsed = FragmentFrontmatterSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return fail(path, `invalid fragment frontmatter (${detail})`);
  }

  if (split.body.includes(FORBIDDEN_BODY_MARKER)) {
    return fail(path, `fragment body must not contain '${FORBIDDEN_BODY_MARKER}'`);
  }

  // reason: the body's file line = frontmatter lines + the two `---` fences; expandFragments reports file:line from it.
  const bodyLineOffset = split.frontmatter.split("\n").length + 2;
  return ok({ frontmatter: parsed.data, body: split.body, layer, path, bodyLineOffset });
}

/**
 * Discover and merge fragments from the three layers.
 *
 * @returns ok(fragments) with one entry per id (highest layer wins), or err naming the
 *   offending file path(s).
 * @example
 *   const r = await discoverFragments(fs, { shipped: "assets/context", user: "~/.config/lore/context", project: ".lore/context" });
 */
export async function discoverFragments(
  fs: FsReadPort,
  roots: FragmentRoots,
): Promise<Result<Fragment[], DiscoverError>> {
  const byId = new Map<string, Fragment>();

  for (const layer of LAYER_ORDER) {
    const root = roots[layer];
    if (root === undefined) continue;
    const names = (await fs.listDir(root)).filter((n) => n.endsWith(".md")).sort();
    const seenInLayer = new Map<string, string>();

    for (const name of names) {
      const path = joinPath(root, name);
      const loaded = await loadFragment(fs, path, layer);
      if (!loaded.ok) return loaded;

      const id = loaded.value.frontmatter.id;
      const first = seenInLayer.get(id);
      if (first !== undefined) {
        return fail(path, `duplicate fragment id '${id}' in the ${layer} layer (also defined in ${first})`);
      }
      seenInLayer.set(id, path);
      byId.set(id, loaded.value);
    }
  }

  return ok([...byId.values()]);
}
