/**
 * AC-JR-5 replay (BR-1535): a cold and a warm milestone review of one plan with the REAL judge, for `lore verify` to judge.
 *
 * Purpose: show that per-unit reuse keeps the findings. Cold: an empty verdict store, every unit is asked. Warm: the cold verdicts
 *   are in the store and ONE file's diff changed (a real one-line change to the plan's `assess.ts` hunk), so that file is asked again
 *   and every other file's verdict is reused; the warm review must still report the cross-file flow from assess.ts `claimedSource`
 *   to gate-acceptance-service `humanPartyOf`. This script grades nothing; it prints what each review found.
 * Usage: `[REPLAY_MODEL=<full model id>] bun scripts/replay-judge-reuse.ts [plan-slug] [task-slug] [spec-slug]`
 *   (defaults: the AC-JR-5 plan, its task and its spec). Without REPLAY_MODEL the judge is the claude CLI's default model, whose full id
 *   is read from the CLI itself; the judge runs as `claude -p --model <that id> --output-format json`.
 * Safety: nothing here writes the live corpus. The plan, task and spec are READ with `lore get --json`; the verdict store is a
 *   throwaway SQLite file under `mktemp -d`; the review documents go to an in-memory stub that only prints. `lore assess` itself has
 *   no diff override and derives the diff from fixed landing ranges, which is why the warm change is made on the diff text here.
 * Side-effect class: IO (spawns `lore`, `git` and the judge; writes a temp directory it removes).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NoOpTelemetry, ok, renderUnitCounts, type DocRecord, type MilestoneReview } from "@lore/core";
import { ClaudeCliProvider } from "../packages/lore/src/ai/claude-cli-provider.js";
import { parseClaudeJsonReply } from "../packages/lore/src/ai/hermetic-spawn.js";
import { AIProviderService } from "../packages/lore/src/service/ai-provider-service.js";
import { MilestoneReviewService } from "../packages/lore/src/service/milestone-review-service.js";
import { SQLiteStore } from "../packages/lore/src/store/sqlite-store.js";

const PLAN = process.argv[2] ?? "plan-an-agent-s-gate-acceptance-waits-for-a-human-decision";
const TASK = process.argv[3] ?? "task-agent-accept-gate-creates-a-pending-human-decision-readers";
const SPEC = process.argv[4] ?? "spec-an-agent-s-gate-acceptance-waits-for-a-human-decision";
/**
 * The FULL model id the replay keys verdicts by. `REPLAY_MODEL` (a full id, never an alias: an alias never matches an answering model,
 * so nothing would be reused) or, when unset, the claude CLI's own default model, read from one trivial `claude -p` call's JSON reply.
 */
function resolveModel(): string {
  const given = process.env["REPLAY_MODEL"];
  if (given !== undefined && given.trim() !== "") return given;
  const probe = spawnSync("claude", ["-p", "--output-format", "json", "--setting-sources", ""], { input: "Reply with the word ok.", encoding: "utf8" });
  const parsed = probe.status === 0 ? parseClaudeJsonReply(probe.stdout) : undefined;
  if (parsed === undefined || !parsed.ok || parsed.value.model === undefined) {
    throw new Error("could not read the claude default model from `claude -p --output-format json`; set REPLAY_MODEL to a full model id");
  }
  return parsed.value.model;
}
const MODEL = resolveModel();
const WARM_FILE = "packages/lore/src/adapters/cli/commands/assess.ts";

function run(command: string, args: string[]): string {
  const out = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${out.stderr}`);
  return out.stdout;
}

function readDoc(slug: string): DocRecord {
  return (JSON.parse(run("lore", ["get", slug, "--json"])) as { data: { doc: DocRecord } }).data.doc;
}

/** The same diff with one line added inside `file`'s hunk: a real one-file change. */
function changeOneFile(diff: string, file: string): string {
  const marker = `diff --git a/${file} b/${file}`;
  const at = diff.indexOf(marker);
  if (at < 0) throw new Error(`${file} is not in the plan's diff`);
  const hunk = diff.indexOf("\n@@", at);
  const bodyStart = diff.indexOf("\n", hunk + 1) + 1;
  return `${diff.slice(0, bodyStart)}+// warm replay: one line changed in this file\n${diff.slice(bodyStart)}`;
}

function describe(label: string, review: MilestoneReview): void {
  const j = review.judgment;
  console.log(`\n== ${label}: calls=${String(j?.calls)} reuse=${JSON.stringify(j?.reuse)} judge=${JSON.stringify(j?.judge)}`);
  console.log(renderUnitCounts(review));
  for (const u of j?.units ?? []) console.log(`  ${u.source.padEnd(6)} ${u.kind} ${u.id} (first review ${u.first_review}) ${JSON.stringify(u.verdicts)}`);
  for (const d of ["security", "concurrency_safety"] as const) {
    const x = review.dimensions[d];
    console.log(`  ${d}: ${x.verdict} cites=${JSON.stringify(x.cites ?? [])}\n    ${x.reason.slice(0, 400)}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "lore-replay-judge-reuse-"));
const store = new SQLiteStore(join(dir, "verdicts.db"));
try {
  const plan = readDoc(PLAN);
  const task = readDoc(TASK);
  const spec = readDoc(SPEC);
  const landing = (task.extra as { landing: { main_before: string; landing_commit: string } }).landing;
  const coldDiff = run("git", ["diff", landing.main_before, landing.landing_commit]);
  const warmDiff = changeOneFile(coldDiff, WARM_FILE);

  const provider = new ClaudeCliProvider("claude-cli", { command: "claude", args: ["-p"], timeout_ms: 900_000 }, { env: process.env, tmpDir: tmpdir() });
  const ai = new AIProviderService(new Map([[provider.name, provider]]), provider.name, {}, new NoOpTelemetry(), false, 8000, { max_diff_chars: 80_000, model: MODEL });
  let stored: MilestoneReview | undefined;
  const service = new MilestoneReviewService({
    getPlanBundle: async () => ok({ plan, tasks: [task], spec } as never),
    getCitedRuleStates: async () => ok([] as never),
    listDecisionLog: async () => ok([]),
    judge: ai.judgeMilestone.bind(ai),
    judgeMeasured: ai.judgeMilestoneMeasured.bind(ai),
    createReviewDoc: async (input) => {
      stored = (input.extra as { milestone_review: MilestoneReview }).milestone_review;
      return ok({ id: "R", slug: "replay-review", extra: input.extra } as unknown as DocRecord);
    },
    link: async () => ok(undefined),
    judgeVerdicts: store,
    judgeIdentity: () => ai.judgeIdentity(),
  });
  const review = async (label: string, diffText: string): Promise<void> => {
    const result = await service.review(plan.slug, { diffText, diffSource: `replay ${label}`, maxDiffChars: 80_000, facts: { assessed_commit: landing.landing_commit } });
    if (!result.ok) throw new Error(`${label} review failed: ${JSON.stringify(result.error)}`);
    describe(label, stored as MilestoneReview);
  };
  await review("cold (empty store)", coldDiff);
  await review(`warm (only ${WARM_FILE} changed)`, warmDiff);
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
