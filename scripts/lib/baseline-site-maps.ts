/**
 * Read edge shared by the site-map excuse scripts (`strip-site-map-excuses.ts`, `count-site-map-excuses.ts`): lists every
 * baseline node of the corpus in the caller's cwd, with its stored `site_map` and its rules' lifecycle, through the `lore` CLI.
 *
 * Public surface: {@link LoreCommand}, {@link parseLoreCommand}, {@link runLoreCommand}, {@link readBaselineSiteMaps},
 *   {@link isRuleId}, {@link SiteMapReadError}, {@link BaselineSiteMapNode}.
 * Invariants: architecture-tree nodes (`tree === "architecture"`) are never returned (they hold no site map); a malformed CLI
 *   payload fails loud, never reads as "no site map".
 * Side-effect class: IO (spawns `lore`; read verbs only — `runLoreCommand` is also the write edge of the strip script).
 */
import { spawnSync } from "node:child_process";
import { z } from "zod";

/** A runnable lore invocation prefix, e.g. `["lore"]` or `["bun", "packages/lore/src/index.ts"]`. */
export type LoreCommand = readonly string[];

/** A stored site_map value the write path accepts: a business rule id. */
const RULE_ID = /^BR-\d+$/;

/** True when `value` is a BR-n rule id (the only lawful site_map value). */
export function isRuleId(value: string): boolean {
  return RULE_ID.test(value);
}

/** The lore CLI failed or printed something this script cannot read. */
export class SiteMapReadError extends Error {
  constructor(
    readonly command: string,
    readonly reason: string,
  ) {
    super(`${command}: ${reason}`);
    this.name = "SiteMapReadError";
  }
}

/** Split a `--lore` value into an argv prefix (whitespace separated; no quoting). @throws SiteMapReadError when blank. */
export function parseLoreCommand(raw: string): LoreCommand {
  const parts = raw.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) throw new SiteMapReadError("--lore", "the lore command is blank");
  return parts;
}

/** Run `<lore> <args>` in `cwd`; returns the exit status and both streams. @throws SiteMapReadError on a spawn failure. */
export function runLoreCommand(lore: LoreCommand, args: readonly string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const [bin, ...prefix] = lore;
  const res = spawnSync(bin as string, [...prefix, ...args], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (res.error) throw new SiteMapReadError(`lore ${args.join(" ")}`, `spawn failed: ${res.error.message}`);
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

const TreeSchema = z.object({
  data: z.array(z.object({ slug: z.string(), node: z.string(), tree: z.string().optional() })),
});

const NodeSchema = z.object({
  data: z.object({
    doc: z.object({
      extra: z.object({
        site_map: z.record(z.string(), z.array(z.string())).optional(),
        rules: z.array(z.object({ id: z.string(), lifecycle: z.string() })).optional(),
      }),
    }),
  }),
});

/** One baseline node with the facts the excuse scripts need. */
export interface BaselineSiteMapNode {
  readonly slug: string;
  /** Node kind (`leaf`, `branch`, `root`, ...). Only a leaf can be written by `lore baseline map`. */
  readonly kind: string;
  readonly siteMap: Readonly<Record<string, readonly string[]>>;
  /** Ids of this node's rules that are not retired (the values a site map may keep). */
  readonly unretiredRuleIds: ReadonlySet<string>;
}

function readJson<T>(lore: LoreCommand, args: string[], cwd: string, schema: z.ZodType<T>): T {
  const label = `lore ${args.join(" ")}`;
  const r = runLoreCommand(lore, args, cwd);
  if (r.status !== 0) throw new SiteMapReadError(label, `exit ${r.status}: ${r.stderr.slice(0, 300)}`);
  let raw: unknown;
  try {
    raw = JSON.parse(r.stdout);
  } catch (cause) {
    throw new SiteMapReadError(label, `unparsable JSON: ${String(cause)}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new SiteMapReadError(label, `unexpected payload: ${parsed.error.message.slice(0, 300)}`);
  return parsed.data;
}

/**
 * Every non-architecture baseline node of the corpus in `cwd`, with its stored site map.
 *
 * @throws SiteMapReadError when a read verb fails or prints an unreadable payload.
 */
export function readBaselineSiteMaps(lore: LoreCommand, cwd: string): BaselineSiteMapNode[] {
  const tree = readJson(lore, ["baseline", "tree", "--json"], cwd, TreeSchema);
  return tree.data
    .filter((n) => n.tree !== "architecture")
    .map((n) => {
      const extra = readJson(lore, ["get", n.slug, "--json"], cwd, NodeSchema).data.doc.extra;
      return {
        slug: n.slug,
        kind: n.node,
        siteMap: extra.site_map ?? {},
        unretiredRuleIds: new Set((extra.rules ?? []).filter((r) => r.lifecycle !== "retired").map((r) => r.id)),
      };
    });
}
