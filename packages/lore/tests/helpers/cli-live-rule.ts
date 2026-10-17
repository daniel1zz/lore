/**
 * Test fixture for CLI-driven tests: give a throwaway corpus one live business rule and let a spec
 * cite it, so `lore approve` / `lore set --status approved` on that spec is accepted (BR-1007).
 *
 * Purpose: shared setup for tests that approve a spec as a preparation step, not as the behaviour
 *   under test (the citation requirement itself is tested in spec-approve-requires-citation).
 * Public surface: {@link LoreRunner}, {@link ensureLiveRuleViaCli}, {@link citeSpecViaCli}.
 * Invariants: one baseline root/branch/leaf + rule per corpus (keyed by `corpusKey`), created on the
 *   first call and reused after; a failing `lore` command throws (the runner's contract).
 * Side-effect class: runs `lore` through the caller's runner, so it writes only the corpus that
 *   runner points at.
 */

/** Runs `lore <args>` in the corpus under test; returns stdout; throws when the command fails. */
export type LoreRunner = (args: string[]) => string;

const ruleByCorpus = new Map<string, string>();

/**
 * Adapts a test file's own `runLore(args, cwd) -> {exitCode, stdout, stderr}` into a {@link LoreRunner}
 * for one corpus directory: stdout on success, a thrown Error carrying stderr on failure.
 */
export function loreRunnerFor(
  run: (args: string[], cwd: string) => { exitCode: number; stdout: string; stderr: string },
  cwd: string,
): LoreRunner {
  return (args) => {
    const result = run(args, cwd);
    if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${result.exitCode}): ${result.stderr}${result.stdout}`);
    return result.stdout;
  };
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

function firstPrdSlug(lore: LoreRunner): string {
  const parsed = JSON.parse(lore(["list", "--type", "prd", "--json", "--limit", "1"])) as {
    data?: { docs?: Array<{ slug: string }> };
  };
  const slug = parsed.data?.docs?.[0]?.slug;
  if (slug === undefined) throw new Error("live-rule fixture needs a PRD in the corpus and found none");
  return slug;
}

/**
 * Creates (once per corpus) a baseline root -> branch -> leaf under `prdSlug` holding one live rule.
 *
 * @param lore - runner for the corpus under test
 * @param corpusKey - any string unique to that corpus (its directory), used to create the rule once
 * @param prdSlug - slug of a PRD in that corpus (the baseline root's parent); omitted -> the corpus's
 *   first PRD, which must exist
 * @returns the rule id (`BR-n`) to cite
 * @throws Error when a fixture command fails or prints no rule id
 */
export function ensureLiveRuleViaCli(lore: LoreRunner, corpusKey: string, prdSlug?: string): string {
  const known = ruleByCorpus.get(corpusKey);
  if (known !== undefined) return known;
  prdSlug ??= firstPrdSlug(lore);
  const root = slugOf(lore(["baseline", "add", prdSlug, "--node", "root", "--label", "Root", "--title", "Fixture Root"]));
  const branch = slugOf(lore(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "Fixture Branch"]));
  const leaf = slugOf(lore(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "Fixture Leaf"]));
  const out = lore([
    "rule", "add", leaf, "--statement", "a live rule the fixture specs cite",
    "--confidence", "established", "--enforced-by", "guaranteed", "--example", "example one",
  ]);
  const ruleId = out.match(/\bBR-\d+\b/)?.[0];
  if (ruleId === undefined) throw new Error(`no rule id in: ${out}`);
  ruleByCorpus.set(corpusKey, ruleId);
  return ruleId;
}

/**
 * Makes `specSlug` approvable: cites the corpus's live rule on criterion `acId` (which must exist).
 *
 * @param lore - runner for the corpus under test
 * @param corpusKey - the same key given to {@link ensureLiveRuleViaCli}
 * @param prdSlug - a PRD slug in that corpus, used only if the rule has to be created now (undefined -> first PRD)
 * @param specSlug - the spec to make approvable
 * @param acId - an existing criterion id on that spec
 */
export function citeSpecViaCli(lore: LoreRunner, corpusKey: string, prdSlug: string | undefined, specSlug: string, acId: string): void {
  const ruleId = ensureLiveRuleViaCli(lore, corpusKey, prdSlug);
  lore(["ac", "cite", specSlug, acId, ruleId]);
}

// ── Async variants (tg-25) ──────────────────────────────────────────────────────────────────────
// A test that runs `lore` in-process (tests/helpers/run-lore-in-process.ts) cannot be synchronous: the command is
// async. These mirror the three functions above one for one and share their `ruleByCorpus` cache and parsing.
// reason: kept beside the sync set, not in place of it, because files that still spawn `dist/lore` use the sync set;
// the sync set goes when the last of those files is migrated (task tg-26).

/** Async twin of {@link LoreRunner}. */
export type AsyncLoreRunner = (args: string[]) => Promise<string>;

/** Async twin of {@link loreRunnerFor}: adapts `runLore(args, cwd) -> Promise<{exitCode, stdout, stderr}>`. */
export function asyncLoreRunnerFor(
  run: (args: string[], cwd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
  cwd: string,
): AsyncLoreRunner {
  return async (args) => {
    const result = await run(args, cwd);
    if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${result.exitCode}): ${result.stderr}${result.stdout}`);
    return result.stdout;
  };
}

/** Async twin of {@link ensureLiveRuleViaCli}. */
export async function ensureLiveRuleViaAsyncCli(lore: AsyncLoreRunner, corpusKey: string, prdSlug?: string): Promise<string> {
  const known = ruleByCorpus.get(corpusKey);
  if (known !== undefined) return known;
  if (prdSlug === undefined) {
    const parsed = JSON.parse(await lore(["list", "--type", "prd", "--json", "--limit", "1"])) as {
      data?: { docs?: Array<{ slug: string }> };
    };
    prdSlug = parsed.data?.docs?.[0]?.slug;
    if (prdSlug === undefined) throw new Error("live-rule fixture needs a PRD in the corpus and found none");
  }
  const root = slugOf(await lore(["baseline", "add", prdSlug, "--node", "root", "--label", "Root", "--title", "Fixture Root"]));
  const branch = slugOf(await lore(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "Fixture Branch"]));
  const leaf = slugOf(await lore(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "Fixture Leaf"]));
  const out = await lore([
    "rule", "add", leaf, "--statement", "a live rule the fixture specs cite",
    "--confidence", "established", "--enforced-by", "guaranteed", "--example", "example one",
  ]);
  const ruleId = out.match(/\bBR-\d+\b/)?.[0];
  if (ruleId === undefined) throw new Error(`no rule id in: ${out}`);
  ruleByCorpus.set(corpusKey, ruleId);
  return ruleId;
}

/** Async twin of {@link citeSpecViaCli}. */
export async function citeSpecViaAsyncCli(lore: AsyncLoreRunner, corpusKey: string, prdSlug: string | undefined, specSlug: string, acId: string): Promise<void> {
  const ruleId = await ensureLiveRuleViaAsyncCli(lore, corpusKey, prdSlug);
  await lore(["ac", "cite", specSlug, acId, ruleId]);
}
