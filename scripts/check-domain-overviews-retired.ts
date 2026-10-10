#!/usr/bin/env bun
/**
 * Read-only checker for AC-BLS3B-10 (spec-baseline-slice-3b-specs-belong-to-the-trees-through, D8).
 *
 * The 4 domain overviews that have no business branch must be retired into the
 * architecture tree: each overview is `deprecated`, and an architecture-tree
 * baseline node (extra.tree === "architecture", not deleted) holds a
 * `supersedes` link to it. The script prints each overview and its destination
 * and exits 1 naming every overview that fails either condition.
 *
 * Reads the live corpus only through `lore get <slug> --json` (the accessor a
 * human uses); it never writes.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_TS = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

export const OVERVIEW_SLUGS: readonly string[] = [
  "spec-domain-overview-dashboard-console-admin-console-evolution-adjudication-workbench-first",
  "spec-domain-overview-dashboard-multi-project-single-instance-switcher-over-the-machine-s-registered-corpora",
  "spec-domain-overview-output-contract-document-taxonomy",
  "spec-domain-overview-extension-hooks-system-direction-pointer-only-no-commitment",
];

interface RelatedEntry {
  slug: string;
  type: string;
  link_type: string;
  direction?: string;
}
interface DocView {
  slug: string;
  type: string;
  status: string;
  deleted_at: string | null;
  extra: Record<string, unknown>;
  related: RelatedEntry[];
}

/** Fail loud: any non-zero exit, unparseable JSON, or missing field throws. */
function readDoc(slug: string): DocView {
  const argv = [INDEX_TS, "get", slug, "--json"];
  const r = spawnSync("bun", ["run", ...argv], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: "1" },
  });
  if (r.error) throw new Error(`lore get ${slug}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`lore get ${slug} exited ${r.status}: ${r.stderr || r.stdout}`);
  const j = JSON.parse(r.stdout) as {
    data?: { doc?: Record<string, unknown>; navigation?: { related?: RelatedEntry[] } };
  };
  const doc = j.data?.doc;
  const related = j.data?.navigation?.related;
  if (!doc || typeof doc.slug !== "string" || typeof doc.status !== "string" || !Array.isArray(related)) {
    throw new Error(`lore get ${slug}: unexpected response shape`);
  }
  return {
    slug: doc.slug,
    type: String(doc.type),
    status: doc.status,
    deleted_at: (doc.deleted_at as string | null) ?? null,
    extra: (doc.extra as Record<string, unknown>) ?? {},
    related,
  };
}

export interface OverviewVerdict {
  overview: string;
  status: string;
  destinations: string[];
  problems: string[];
}

export function judge(overview: DocView, readNode: (slug: string) => DocView): OverviewVerdict {
  const problems: string[] = [];
  if (overview.status !== "deprecated") problems.push(`status is "${overview.status}", not deprecated`);
  const destinations: string[] = [];
  for (const rel of overview.related) {
    if (rel.link_type !== "supersedes" || rel.type !== "baseline") continue;
    const node = readNode(rel.slug);
    if (node.deleted_at === null && node.extra.tree === "architecture") destinations.push(node.slug);
  }
  if (destinations.length === 0) {
    problems.push("no live architecture-tree node holds a supersedes link to it");
  }
  return { overview: overview.slug, status: overview.status, destinations, problems };
}

function main(): number {
  const verdicts = OVERVIEW_SLUGS.map((slug) => judge(readDoc(slug), readDoc));
  for (const v of verdicts) {
    console.log(`${v.overview} [${v.status}] -> ${v.destinations.length > 0 ? v.destinations.join(", ") : "(no destination)"}`);
  }
  const bad = verdicts.filter((v) => v.problems.length > 0);
  for (const v of bad) {
    console.error(`FAIL ${v.overview}: ${v.problems.join("; ")}`);
  }
  return bad.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(`check-domain-overviews-retired: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
