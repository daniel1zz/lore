/**
 * Test fixture: a throwaway corpus (mkdtemp + `lore init`, never the repository's own `.lore/`) holding an APPROVED
 * baseline leaf, driven through the real CLI in-process, for the per-item approval suites
 * (spec-baseline-approval-is-per-item-an-edit-adds-a-pending: AC-BIA-1..5).
 *
 * Purpose: those suites share one setup — PRD, baseline root > branch > leaf, one approved rule `BR-1`, the leaf reviewed
 * and approved — and the same reads (stored `extra`, status, registry lifecycle, straight from the corpus file).
 * Public surface: {@link createItemsCorpus}, {@link ItemsCorpus}, {@link LoreResult}, {@link RULE_ARGS}.
 * Invariants:
 *   - The AI behind `lore review` is a shell-script test double wired through `ai.provider.command` (always `approve`);
 *     no real provider is called.
 *   - Stored rows are read read-only from `<dir>/.lore/lore.db`, so an assertion about what was written never depends on
 *     a lore command.
 *   - Every failing fixture command throws (a fixture fault), so a suite never builds on a half-made corpus.
 * Side-effect class: IO (a temp directory, one SQLite file read, in-process CLI runs).
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@lore/core/node";
import { runLoreInProcess } from "./run-lore-in-process";

/** What one `lore` run produced. */
export interface LoreResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** A stored baseline node, as the corpus file holds it. */
export interface StoredNode {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly content: string;
  readonly status: string;
  readonly version: number;
  readonly extra: Record<string, unknown> & {
    rules?: Array<Record<string, unknown>>;
    pending?: { rules?: Record<string, { revision_id: string; rule: Record<string, unknown>; move_to?: string }>; node?: Record<string, unknown> };
  };
}

/** A throwaway corpus holding one approved leaf. */
export interface ItemsCorpus {
  readonly dir: string;
  /** Slug of the approved leaf (it holds the approved rule BR-1). */
  readonly leaf: string;
  /** Slug of the branch the leaf hangs under (a second leaf can be added there). */
  readonly branch: string;
  /** `lore <args>` in the corpus as the default test run, or as `session` (a second agent session). */
  lore(args: readonly string[], session?: string): Promise<LoreResult>;
  /** `lore <args>`; throws when the exit code is not 0. */
  must(args: readonly string[], session?: string): Promise<LoreResult>;
  /** The stored node `slug`. */
  node(slug: string): StoredNode;
  /** The registry's lifecycle for a rule id (`undefined` when the registry has no such id). */
  registryState(ruleId: string): string | undefined;
  /** `lore review <slug>` then `lore approve <slug>`: promotes every pending revision (what the review saw). */
  approveAll(slug: string): Promise<void>;
  /** A new, approved leaf under the branch (no rules). */
  addLeaf(title: string): Promise<string>;
  cleanup(): void;
}

/** The flags of a valid `rule add`/`rule set` (everything but the statement). */
export const RULE_ARGS = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "an example"] as const;

/** The statement the fixture's approved BR-1 carries. */
export const APPROVED_STATEMENT = "The approved statement of the first rule.";

function writeAiDouble(dir: string): string {
  const scriptPath = join(dir, "fake-ai.sh");
  const body = JSON.stringify({
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "looks fine" }],
    blocking_questions: [],
  });
  writeFileSync(scriptPath, `#!/bin/sh\ncat > /dev/null\ncat <<'JSONEOF'\n${body}\nJSONEOF\n`, { mode: 0o755 });
  return scriptPath;
}

/**
 * Build the corpus: PRD, baseline root > branch > leaf, BR-1 added, the leaf reviewed and approved.
 *
 * @param prefix - temp directory name prefix
 * @throws Error when any fixture command fails
 */
export async function createItemsCorpus(prefix: string): Promise<ItemsCorpus> {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const run = (args: readonly string[], session?: string): Promise<LoreResult> =>
    runLoreInProcess([...args], {
      cwd: dir,
      home: dir,
      env: { ...process.env, HOME: dir, EDITOR: "true", ...(session !== undefined ? { CLAUDE_CODE_SESSION_ID: session } : {}) },
    });
  const must = async (args: readonly string[], session?: string): Promise<LoreResult> => {
    const result = await run(args, session);
    if (result.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${result.exitCode}): ${result.stderr}${result.stdout}`);
    return result;
  };
  const slugOf = (result: LoreResult): string => {
    const match = result.stdout.match(/Created baseline \w+ (\S+) \(/) ?? result.stdout.match(/Slug:\s+(\S+)/);
    if (match?.[1] === undefined) throw new Error(`no slug in: ${result.stdout}`);
    return match[1];
  };
  const database = (): Database => new Database(join(dir, ".lore", "lore.db"), { readonly: true });

  await must(["init"]);
  saveConfig(dir, {
    project: { name: "baseline-items", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command: writeAiDouble(dir), args: [], timeout_ms: 5000 } },
      templates: {},
      telemetry: false,
    },
  } as never);

  const prd = slugOf(await must(["create", "prd", "--title", "Items fixture product", "--no-ai", "--content", "# Items fixture\n\nA product.\n"]));
  const root = slugOf(await must(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "Items root"]));
  const branch = slugOf(await must(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "Items branch"]));
  // a node is born draft (its own part awaits a first approval); the ancestors are approved so the suites start from an approved tree
  for (const node of [root, branch]) {
    await must(["review", node]);
    await must(["approve", node]);
  }

  const corpus: ItemsCorpus = {
    dir,
    leaf: "",
    branch,
    lore: run,
    must,
    node(slug) {
      const db = database();
      try {
        const row = db.query("SELECT id, slug, title, content, status, version, extra FROM docs WHERE slug = ?").get(slug) as
          | { id: string; slug: string; title: string; content: string; status: string; version: number; extra: string }
          | null;
        if (row === null) throw new Error(`no baseline node ${slug}`);
        return { ...row, extra: JSON.parse(row.extra) as StoredNode["extra"] };
      } finally {
        db.close();
      }
    },
    registryState(ruleId) {
      const db = database();
      try {
        return (db.query("SELECT lifecycle FROM rule_registry WHERE id = ?").get(ruleId) as { lifecycle: string } | null)?.lifecycle;
      } finally {
        db.close();
      }
    },
    async approveAll(slug) {
      await must(["review", slug]);
      await must(["approve", slug]);
    },
    async addLeaf(title) {
      const slug = slugOf(await must(["baseline", "add", branch, "--node", "leaf", "--label", title, "--title", title]));
      await corpus.approveAll(slug);
      return slug;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };

  const leaf = slugOf(await must(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "Items leaf"]));
  await must(["rule", "add", leaf, "--statement", APPROVED_STATEMENT, ...RULE_ARGS]);
  await corpus.approveAll(leaf);
  return { ...corpus, leaf };
}
