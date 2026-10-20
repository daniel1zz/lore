/**
 * Test fixture for in-process `createApp` tests: one live business rule in the corpus behind `app`,
 * cited by a spec's criterion so that approving the spec is accepted (BR-1007).
 *
 * Purpose: shared setup for tests that approve a spec as a preparation step, not as the behaviour
 *   under test (the citation requirement itself is tested in spec-approve-requires-citation).
 * Public surface: {@link citeSpecWithLiveRule}.
 * Invariants: the baseline root -> branch -> leaf + rule are created once per corpus (found again by
 *   their fixture title on later calls); every failing service call throws (a fixture fault).
 * Side-effect class: writes the corpus behind `app` (always a throwaway test corpus).
 */

import type { App } from "../../src/app.js";

const LEAF_TITLE = "Fixture Live Rule Leaf";

async function ensureLeaf(app: App): Promise<{ leafSlug: string; ruleId: string }> {
  const rules = app.ruleService;
  if (rules === undefined) throw new Error("RuleService not wired");
  const existing = await app.corpusService.list({ type: "baseline" });
  if (!existing.ok) throw new Error(`list baseline failed: ${JSON.stringify(existing.error)}`);
  const leaf = existing.value.docs.find((d) => d.title === LEAF_TITLE);
  if (leaf !== undefined) {
    const shown = await app.corpusService.get(leaf.slug);
    if (!shown.ok) throw new Error(`get leaf failed: ${JSON.stringify(shown.error)}`);
    const rule = (shown.value.doc.extra["rules"] as Array<{ id: string }> | undefined)?.[0];
    if (rule === undefined) throw new Error("fixture leaf holds no rule");
    return { leafSlug: leaf.slug, ruleId: rule.id };
  }
  const prds = await app.corpusService.list({ type: "prd" });
  if (!prds.ok || prds.value.docs[0] === undefined) throw new Error("live-rule fixture needs a PRD in the corpus");
  const node = async (parent: string, kind: "root" | "branch" | "leaf", title: string): Promise<string> => {
    const made = await rules.addNode(parent, { node: kind, label: title, title, content: title });
    if (!made.ok) throw new Error(`addNode ${kind} failed: ${JSON.stringify(made.error)}`);
    return made.value.slug;
  };
  const root = await node(prds.value.docs[0].slug, "root", "Fixture Live Rule Root");
  const branch = await node(root, "branch", "Fixture Live Rule Branch");
  const leafSlug = await node(branch, "leaf", LEAF_TITLE);
  const added = await rules.addRule(leafSlug, {
    statement: "a live rule the fixture specs cite",
    confidence: "established",
    enforced_by: "guaranteed",
    examples: ["example one"],
  });
  if (!added.ok) throw new Error(`addRule failed: ${JSON.stringify(added.error)}`);
  // reason: a direct add is a PENDING add and a new node is born draft (BR-626/BR-1339): the rule is live only once approved.
  // An approval promotes what a review saw, so the fixture records an approving review judgment, then approves — the same
  // two steps `lore review` and `lore approve` take, with no AI call.
  for (const slug of [root, branch, leafSlug]) await reviewAndApprove(app, slug);
  return { leafSlug, ruleId: added.value.ruleId };
}

async function reviewAndApprove(app: App, slug: string): Promise<void> {
  const shown = await app.corpusService.get(slug);
  if (!shown.ok) throw new Error(`get ${slug} failed: ${JSON.stringify(shown.error)}`);
  const recorded = await app.judgmentService.record({
    doc_id: shown.value.doc.id,
    doc_version: shown.value.doc.version,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "fixture review" }],
    checks: [],
    blocking_questions: [],
    judge: { provider: "fixture", model: "n/a", prompt_version: "v6" },
  });
  if (!recorded.ok) throw new Error(`recording a review of ${slug} failed: ${JSON.stringify(recorded.error)}`);
  const approved = await app.reviewService.approve(slug);
  if (!approved.ok) throw new Error(`approving ${slug} failed: ${JSON.stringify(approved.error)}`);
}

/**
 * Makes `specId` approvable: ensures the corpus's live fixture rule exists and cites it on criterion `acId`.
 *
 * @param app - the app over the throwaway corpus (needs `ruleService`, `acService`, and one PRD)
 * @param specId - id or slug of a spec that already carries criterion `acId`
 * @param acId - an existing criterion id on that spec
 * @throws Error when any fixture step fails
 */
export async function citeSpecWithLiveRule(app: App, specId: string, acId: string): Promise<void> {
  if (app.acService === undefined) throw new Error("AcService not wired");
  const { ruleId } = await ensureLeaf(app);
  const cited = await app.acService.citeCriterion(specId, acId, [ruleId]);
  if (!cited.ok) throw new Error(`citeCriterion failed: ${JSON.stringify(cited.error)}`);
}
