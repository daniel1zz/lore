/**
 * `lore fragments pointers` flow — the slim project-pointer lines a subagent start appends.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D6, POINTER_CEILING).
 *
 * Reproduces `assets/hooks/subagent-context.mjs` `buildProjectContext` (F13): when the cwd
 * owns a `.lore/` corpus, summarise `lore bootstrap --json` as a few pointer lines. The hook
 * file is NOT edited here; a later task deletes its copy and calls this verb instead.
 *
 * Public surface: buildProjectPointers(deps), truncateAtLineBoundary(text, ceiling), PointersDeps, PointersResult.
 *
 * Invariants:
 *   - Output is at most POINTER_CEILING chars, cut at a line boundary (whole lines only; if even
 *     the first line is over the ceiling it is hard-cut to the ceiling so the result is never empty
 *     for a non-empty input).
 *   - Absent corpus -> `text: ""` with `skipped: "no-corpus"`; a failed/garbled bootstrap -> `text: ""`
 *     with a `skipped` reason the adapter prints on stderr (the hook path must never block start, D12,
 *     but the reason is not swallowed).
 *
 * Side-effect class: pure given the injected `hasCorpus` / `runBootstrap` ports.
 */
import { z } from "zod";
import { POINTER_CEILING } from "@lore/core";

/** Ports the adapter supplies. */
export interface PointersDeps {
  /** True when the project root owns a `.lore/` directory. */
  readonly hasCorpus: () => boolean;
  /** Runs `lore bootstrap --json`; `status` is the exit code (null when killed/timed out). */
  readonly runBootstrap: () => Promise<{ readonly status: number | null; readonly stdout: string }>;
}

export interface PointersResult {
  readonly text: string;
  /** Why `text` is empty, when it is. */
  readonly skipped?: "no-corpus" | "bootstrap-failed" | "bootstrap-unparseable" | "nothing-to-report";
}

// reason: real `lore bootstrap --json` emits `root: null` on a corpus with no root PRD yet; the
// hook's optional chaining tolerated null everywhere, so every optional field here is nullish too.
const BootstrapSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    root: z.object({ title: z.string().nullish(), slug: z.string().nullish() }).nullish(),
    active_plans: z
      .array(
        z.object({
          title: z.string().nullish(),
          slug: z.string().nullish(),
          task_counts: z
            .object({ ready: z.number().nullish(), claimed: z.number().nullish(), done: z.number().nullish() })
            .nullish(),
        }),
      )
      .nullish(),
    pending_reviews: z.object({ count: z.number().nullish() }).nullish(),
  }),
});

/**
 * Keep whole lines while the joined text stays within `ceiling`.
 *
 * @param text Text to bound.
 * @param ceiling Maximum characters of the result.
 */
export function truncateAtLineBoundary(text: string, ceiling: number): string {
  if (text.length <= ceiling) return text;
  const kept: string[] = [];
  let length = 0;
  for (const line of text.split("\n")) {
    const next = length + (kept.length > 0 ? 1 : 0) + line.length;
    if (next > ceiling) break;
    kept.push(line);
    length = next;
  }
  return kept.length > 0 ? kept.join("\n") : text.slice(0, ceiling);
}

/**
 * Build the project pointer block.
 *
 * @returns the (possibly empty) pointer text plus why it is empty, if it is.
 */
export async function buildProjectPointers(deps: PointersDeps): Promise<PointersResult> {
  if (!deps.hasCorpus()) return { text: "", skipped: "no-corpus" };

  const run = await deps.runBootstrap();
  if (run.status !== 0 || run.stdout.length === 0) return { text: "", skipped: "bootstrap-failed" };

  let json: unknown;
  try {
    json = JSON.parse(run.stdout);
  } catch {
    return { text: "", skipped: "bootstrap-unparseable" };
  }
  const parsed = BootstrapSchema.safeParse(json);
  if (!parsed.success) return { text: "", skipped: "bootstrap-unparseable" };

  const { root, active_plans: plans, pending_reviews: pending } = parsed.data.data;
  const lines: string[] = [];
  if (root?.title) lines.push(`Corpus root: ${root.title} (${root.slug ?? ""})`);
  const plan = plans?.[0];
  if (plan !== undefined) {
    const counts = plan.task_counts;
    const stats = counts ? ` (ready ${counts.ready ?? 0} / claimed ${counts.claimed ?? 0} / done ${counts.done ?? 0})` : "";
    lines.push(`Plan: ${plan.title || plan.slug || ""}${stats}`);
  }
  if ((pending?.count ?? 0) > 0) lines.push(`Pending reviews: ${pending?.count}`);
  if (lines.length === 0) return { text: "", skipped: "nothing-to-report" };

  const full =
    `## Project Context (lore)\n${lines.join("\n")}\n` +
    "Deep-dive: `lore get <slug>` / `lore tree <plan>` / `lore ready <plan> --json`";
  return { text: truncateAtLineBoundary(full, POINTER_CEILING) };
}
