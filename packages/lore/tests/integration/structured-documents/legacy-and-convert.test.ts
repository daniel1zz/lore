// @reads assets/project/lore-config-template.yaml
// @spawns-external git builds a throwaway git repository the test runs against
/**
 * spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-7: LEGACY FROZEN, OPEN CONVERTED ONCE.
 *
 * Over a throwaway corpus (mkdtemp + `lore init`, never the repo's `.lore/`) holding completed and open documents of the
 * templated types: the classification (`lore convert --classify`) freezes the completed ones (an archived and a deprecated
 * spec, a locked spec with every implementing plan archived, an archived plan, an archived knowledge record) and lists the
 * rest (a locked spec with NO plan, a draft spec, a locked spec with an open plan, that open plan and its task, an open
 * knowledge record, a baseline node) in `lore convert --list` by type and owner. Before conversion an open document takes
 * the same writes as today; a frozen one refuses set, ac add and anchor writes but still takes invalidate and deprecate;
 * `lore convert` drafts fields and dimensions (a shell-script stub provider, no real AI), validates, renders, and leaves a
 * new version (a locked record through correction); afterwards a set --content is refused; two concurrent converts end
 * with one success and one stale-version refusal; once every listed document is converted the list is empty.
 *
 * Coverage:
 *   HAPPY:      classify, list, convert a draft, a locked record (correction) and the rest down to an empty list
 *   NEGATIVE:   frozen docs refuse set/ac add/anchor writes; converting a completed doc fails; an invalid, malformed or
 *               failed AI draft writes nothing
 *   BOUNDARY:   a locked spec with no plan is OPEN; one with an open plan is OPEN; a second classify writes nothing
 *   STATE:      version numbers before/after each write; the legacy marker; the rendered body after conversion
 *   ERROR:      provider failure exits 6; the concurrent loser exits 5
 *   REGRESSION: old-format writes (set --content, --correction, ac add, anchors) still work for unconverted open docs
 *
 * False green guarded: freezing the no-plan locked spec freezes live work (asserted open); converting a completed doc
 * fails (asserted exit 4); any refusal for an unconverted open doc fails (asserted exit 0 on each old-format write).
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { Database } from "bun:sqlite";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DECIDED_FLAGS } from "../../helpers/decision-flags.js";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { createStructuredRig, installTemplate, type StructuredRig } from "../../helpers/structured-corpus.js";

const SPEC = "spec-every-document-is-stored-as-structured-fields-validated-by";
const AC_ID = `${SPEC}#AC-ST-7`;

let rig: StructuredRig;
let counter = 0;

const slugs: Record<string, string> = {};

/** A template of one slot: one required `summary` field and one `scope` dimension. */
function slotTemplate(docType: string, kind?: string): Record<string, unknown> {
  return {
    doc_type: docType,
    ...(kind !== undefined ? { kind } : {}),
    version: 1,
    fields: { type: "object", required: ["summary"], properties: { summary: { type: "string", minLength: 1 } } },
    dimensions: [{ id: "scope", question: "What does it cover?" }],
    checks: [],
    render: [{ heading: "Summary", fields: ["summary"] }],
  };
}

const GOOD_DRAFT = {
  fields: { summary: "converted summary text" },
  dimensions: [{ id: "scope", status: "handled", answer: "as the old body says", refs: [] }],
};

const answerFile = (): string => join(rig.dir, "draft-answer.txt");
const failFile = (): string => join(rig.dir, "draft-fail");
const delayFile = (): string => join(rig.dir, "draft-delay");

function answerWith(text: string): void {
  writeFileSync(answerFile(), text);
}

/** The stub provider: fail when `draft-fail` exists, else wait a moment (so concurrent converts overlap) and print the answer file. */
function writeStubProvider(): string {
  const path = join(rig.dir, "stub-draft.sh");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      "cat > /dev/null",
      `if [ -e "${failFile()}" ]; then echo "stub provider failure" >&2; exit 1; fi`,
      `if [ -e "${delayFile()}" ]; then sleep "$(cat "${delayFile()}")"; fi`,
      `cat "${answerFile()}"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return path;
}

function sql<T>(query: string, ...params: string[]): T[] {
  const db = new Database(rig.dbPath);
  try {
    return db.query(query).all(...params) as T[];
  } finally {
    db.close();
  }
}

function setStatus(slug: string, status: string): void {
  sql("UPDATE docs SET status = ? WHERE slug = ? RETURNING id", status, slug);
}

interface StoredDoc {
  slug: string;
  id: string;
  version: number;
  status: string;
  content: string;
  extra: Record<string, unknown>;
}

async function stored(slug: string): Promise<StoredDoc> {
  const result = await rig.lore(["get", slug, "--json"]);
  expect(result.exitCode, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { data: { doc: StoredDoc } }).data.doc;
}

async function created(args: string[]): Promise<string> {
  counter += 1;
  const result = await rig.lore([...args, "--no-ai", "--json"]);
  expect(result.exitCode, `${args.join(" ")}: ${result.stderr}${result.stdout}`).toBe(0);
  return (JSON.parse(result.stdout) as { data: { slug: string } }).data.slug;
}

async function createLegacySpec(label: string): Promise<string> {
  return await created(["create", "spec", "--kind", "tech", "--title", `${label} ${String(counter)}`, "--content", "## Goal\n\nthe old free body"]);
}

interface OpenRow {
  slug: string;
  type: string;
  owner: string;
  status: string;
}

async function openList(): Promise<OpenRow[]> {
  const result = await rig.lore(["convert", "--list", "--json"]);
  expect(result.exitCode, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { data: { open: OpenRow[] } }).data.open;
}

const versionTotal = (): number => sql<{ n: number }>("SELECT COUNT(*) AS n FROM versions")[0]!.n;

beforeAll(async () => {
  rig = await createStructuredRig("lore-legacy-convert", { templates: "none" });
  patchLoreConfig(rig.dir, {
    workflow: { review: { judgment_required_types: [] } },
    ai: { provider: "claude-cli", providers: { "claude-cli": { command: writeStubProvider(), args: [], timeout_ms: 30_000 } } },
  });
  answerWith(JSON.stringify(GOOD_DRAFT));

  const prd = await created(["create", "prd", "--title", "Legacy PRD", "--content", "root"]);
  slugs["prd"] = prd;

  // completed
  slugs["archivedSpec"] = await createLegacySpec("Archived spec");
  setStatus(slugs["archivedSpec"], "archived");
  slugs["deprecatedSpec"] = await createLegacySpec("Deprecated spec");
  setStatus(slugs["deprecatedSpec"], "deprecated");
  slugs["lockedDone"] = await createLegacySpec("Locked spec done");
  setStatus(slugs["lockedDone"], "approved");
  slugs["donePlan"] = await created(["create", "plan", "--title", "Done plan", "--parent", slugs["lockedDone"], "--content", "x"]);
  setStatus(slugs["donePlan"], "archived");
  slugs["archivedKnowledge"] = await created(["create", "knowledge", "--sub-type", "reference", "--title", "Old reference", "--parent", prd, "--content", "old"]);
  setStatus(slugs["archivedKnowledge"], "archived");

  // open
  slugs["lockedNoPlan"] = await createLegacySpec("Locked spec no plan");
  setStatus(slugs["lockedNoPlan"], "approved");
  slugs["draftSpec"] = await createLegacySpec("Draft spec");
  slugs["lockedOpenPlan"] = await createLegacySpec("Locked spec open plan");
  setStatus(slugs["lockedOpenPlan"], "approved");
  slugs["openPlan"] = await created(["create", "plan", "--title", "Open plan", "--parent", slugs["lockedOpenPlan"], "--content", "x"]);
  slugs["openTask"] = await created(["create", "task", "--kind", "code", "--title", "Open task", "--parent", slugs["openPlan"], "--plan-id", slugs["openPlan"], "--content", "x"]);
  slugs["openKnowledge"] = await created(["create", "knowledge", "--sub-type", "reference", "--title", "Open reference", "--parent", prd, "--content", "live notes"]);
  const node = await rig.lore(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "Legacy Root"]);
  expect(node.exitCode, node.stderr).toBe(0);
  slugs["baselineNode"] = node.stdout.match(/Created baseline \w+ (\S+) \(/)?.[1] ?? "";
  expect(slugs["baselineNode"]).not.toBe("");

  await installTemplate(rig, "Spec tech template", slotTemplate("spec", "tech"));
  await installTemplate(rig, "Plan template", slotTemplate("plan"));
  await installTemplate(rig, "Task template", slotTemplate("task"));
  await installTemplate(rig, "Knowledge reference template", slotTemplate("knowledge", "reference"));
  await installTemplate(rig, "Baseline root template", slotTemplate("baseline", "root"));
}, 240_000);

afterAll(() => {
  rig.cleanup();
});

const FROZEN = ["archivedSpec", "deprecatedSpec", "lockedDone", "donePlan", "archivedKnowledge"] as const;
const OPEN = ["lockedNoPlan", "draftSpec", "lockedOpenPlan", "openPlan", "openTask", "openKnowledge", "baselineNode"] as const;

describe(`${AC_ID} before classification an open document takes the old-format writes`, () => {
  it("set --content, set --correction on a locked record, ac add and anchor add all succeed (nothing is refused)", async () => {
    const draft = await rig.lore(["set", slugs["draftSpec"]!, "--content", "## Goal\n\nthe old free body, edited"]);
    expect(draft.exitCode, draft.stderr).toBe(0);
    const locked = await rig.lore(["set", slugs["lockedNoPlan"]!, "--content", "## Goal\n\ncorrected body", "--correction", "typo", ...DECIDED_FLAGS]);
    expect(locked.exitCode, locked.stderr).toBe(0);
    const ac = await rig.lore(["ac", "add", slugs["draftSpec"]!, "AC-OLD-1", "--statement", "an old-format criterion", "--mode", "human", "--note", "n"]);
    expect(ac.exitCode, ac.stderr).toBe(0);
    const anchor = await rig.lore(["anchor", "add", slugs["draftSpec"]!, "src/old.ts#Old"]);
    expect(anchor.exitCode, anchor.stderr).toBe(0);
    const taskAnchor = await rig.lore(["anchor", "add", slugs["openTask"]!, "src/old-task.ts"]);
    expect(taskAnchor.exitCode, taskAnchor.stderr).toBe(0);
    expect((await stored(slugs["draftSpec"]!)).extra["template_ref"]).toBeUndefined();
  });
});

describe(`${AC_ID} classification freezes the completed documents and lists the rest`, () => {
  it("a preview writes nothing and names every completed document", async () => {
    const before = versionTotal();
    const preview = await rig.lore(["convert", "--classify", "--json"]);
    expect(preview.exitCode, preview.stderr).toBe(0);
    const data = (JSON.parse(preview.stdout) as { data: { applied: boolean; frozen: { slug: string }[]; open: OpenRow[] } }).data;
    expect(data.applied).toBe(false);
    expect(data.frozen.map((row) => row.slug).sort()).toEqual(FROZEN.map((key) => slugs[key]!).sort());
    expect(versionTotal()).toBe(before);
  });

  it("--apply stores the legacy marker on exactly the completed documents; a second --apply writes nothing", async () => {
    const applied = await rig.lore(["convert", "--classify", "--apply", "--json"]);
    expect(applied.exitCode, applied.stderr).toBe(0);
    for (const key of FROZEN) {
      const doc = await stored(slugs[key]!);
      expect(doc.extra["legacy"], key).toMatchObject({ reason: "completed before structured templates" });
    }
    for (const key of OPEN) {
      expect((await stored(slugs[key]!)).extra["legacy"], `${key} must stay open`).toBeUndefined();
    }
    const before = versionTotal();
    const again = await rig.lore(["convert", "--classify", "--apply", "--json"]);
    expect(again.exitCode, again.stderr).toBe(0);
    expect((JSON.parse(again.stdout) as { data: { frozen: unknown[] } }).data.frozen).toEqual([]);
    expect(versionTotal()).toBe(before);
  });

  it("lore convert --list names every open document by type and owner, and no frozen one", async () => {
    const open = await openList();
    expect(open.map((row) => row.slug).sort()).toEqual(OPEN.map((key) => slugs[key]!).sort());
    for (const row of open) {
      expect(row.owner, row.slug).not.toBe("");
      expect(row.type, row.slug).not.toBe("");
    }
    // false green: the locked spec with no plan is OPEN (its work has not started), and so is the one with an open plan.
    expect(open.some((row) => row.slug === slugs["lockedNoPlan"])).toBe(true);
    expect(open.some((row) => row.slug === slugs["lockedOpenPlan"])).toBe(true);
    const human = await rig.lore(["convert", "--list"]);
    expect(human.stdout).toContain(slugs["draftSpec"]!);
  });
});

describe(`${AC_ID} a frozen document refuses authoring writes and keeps its lifecycle`, () => {
  it("set --content, ac add and anchor add exit 4 naming the freeze; get and search are unchanged", async () => {
    for (const key of ["archivedSpec", "deprecatedSpec", "lockedDone"] as const) {
      const before = await stored(slugs[key]!);
      const set = await rig.lore(["set", slugs[key]!, "--content", "## Goal\n\nrewritten", "--correction", "x", ...DECIDED_FLAGS]);
      expect(set.exitCode, `${key}: ${set.stderr}`).toBe(4);
      expect(set.stderr, key).toContain("legacy-frozen");
      expect((await stored(slugs[key]!)).version, key).toBe(before.version);
    }
    const ac = await rig.lore(["ac", "add", slugs["deprecatedSpec"]!, "AC-NEW-1", "--statement", "s", "--mode", "human", "--note", "n", ...DECIDED_FLAGS]);
    expect(ac.exitCode, ac.stderr).toBe(4);
    expect(ac.stderr).toContain("legacy-frozen");
    const anchor = await rig.lore(["anchor", "add", slugs["deprecatedSpec"]!, "src/new.ts#New"]);
    expect(anchor.exitCode, anchor.stderr).toBe(4);
    expect(anchor.stderr).toContain("legacy-frozen");
    const read = await rig.lore(["get", slugs["archivedSpec"]!]);
    expect(read.exitCode, read.stderr).toBe(0);
    expect(read.stdout).toContain("the old free body");
    const found = await rig.lore(["search", "free body"]);
    expect(found.exitCode, found.stderr).toBe(0);
    expect(found.stdout).toContain("Archived spec");
  });

  it("invalidate (a lifecycle transition) still works on a frozen document", async () => {
    const result = await rig.lore(["invalidate", slugs["archivedKnowledge"]!, "--reason", "no longer true"]);
    expect(result.exitCode, result.stderr).toBe(0);
    const doc = await stored(slugs["archivedKnowledge"]!);
    expect(doc.extra["legacy"]).toBeDefined();
    expect(doc.extra["validity"]).toBeDefined();
  });

  it("converting a completed or frozen document fails and writes nothing", async () => {
    const before = versionTotal();
    for (const key of ["archivedSpec", "lockedDone", "donePlan"] as const) {
      const result = await rig.lore(["convert", slugs[key]!, ...DECIDED_FLAGS]);
      expect(result.exitCode, `${key}: ${result.stderr}`).toBe(4);
      expect(result.stderr, key).toContain("legacy");
    }
    expect(versionTotal()).toBe(before);
  });
});

describe(`${AC_ID} lore convert builds, validates and renders; a bad draft writes nothing`, () => {
  it("a provider failure exits 6, a non-JSON draft and an incomplete draft exit 4, each writing nothing", async () => {
    const target = slugs["draftSpec"]!;
    const before = await stored(target);

    writeFileSync(failFile(), "x");
    const failed = await rig.lore(["convert", target]);
    rmSync(failFile());
    expect(failed.exitCode, failed.stderr).toBe(6);

    answerWith("I could not convert this document");
    const prose = await rig.lore(["convert", target]);
    expect(prose.exitCode, prose.stderr).toBe(4);

    answerWith(JSON.stringify({ fields: { summary: "only a summary" }, dimensions: [] }));
    const incomplete = await rig.lore(["convert", target]);
    expect(incomplete.exitCode, incomplete.stderr).toBe(4);
    expect(incomplete.stderr).toContain("scope");

    answerWith(JSON.stringify(GOOD_DRAFT));
    const after = await stored(target);
    expect(after.version).toBe(before.version);
    expect(after.extra["template_ref"]).toBeUndefined();
    expect(after.content).toBe(before.content);
  });

  it("a draft document converts: template pinned, fields and dimensions stored, body rendered, new version, then set --content is refused", async () => {
    const target = slugs["draftSpec"]!;
    const before = await stored(target);
    const result = await rig.lore(["convert", target, "--json"]);
    expect(result.exitCode, result.stderr).toBe(0);
    const outcome = (JSON.parse(result.stdout) as { data: { template_ref: string; correction: boolean } }).data;
    expect(outcome.template_ref).toBe("template-spec-tech-template@1");
    expect(outcome.correction).toBe(false);
    const after = await stored(target);
    expect(after.version).toBe(before.version + 1);
    expect(after.status).toBe("draft");
    expect(after.extra["template_ref"]).toBe("template-spec-tech-template@1");
    expect(after.extra["fields"]).toEqual(GOOD_DRAFT.fields);
    expect(after.content).toContain("converted summary text");
    expect(after.extra["acceptance_criteria"], "the old criterion survives conversion").toBeDefined();
    const refused = await rig.lore(["set", target, "--content", "hand written"]);
    expect(refused.exitCode, refused.stderr).toBe(4);
    expect(refused.stderr).toContain("--fields-file");
    expect((await rig.lore(["convert", target])).exitCode, "already converted").toBe(4);
  });

  it("a locked record converts through a correction and stays approved", async () => {
    const target = slugs["lockedNoPlan"]!;
    const before = await stored(target);
    expect(before.status).toBe("approved");
    const result = await rig.lore(["convert", target, "--json", ...DECIDED_FLAGS]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect((JSON.parse(result.stdout) as { data: { correction: boolean } }).data.correction).toBe(true);
    const after = await stored(target);
    expect(after.version).toBe(before.version + 1);
    expect(after.status).toBe("approved");
    expect(after.extra["template_ref"]).toBe("template-spec-tech-template@1");
    expect(after.content).toContain("converted summary text");
    const refused = await rig.lore(["set", target, "--content", "hand written", "--correction", "x", ...DECIDED_FLAGS]);
    expect(refused.exitCode, refused.stderr).toBe(4);
  });

  it("two concurrent converts of one document end with one success and one stale-version refusal", async () => {
    const target = slugs["lockedOpenPlan"]!;
    const before = await stored(target);
    // reason: both converts must read the document BEFORE either writes; the stub provider holds each draft for 6 s so the
    // slower process start of the second one cannot land after the first one's write (that would be "already converted").
    writeFileSync(delayFile(), "6");
    const [a, b] = await Promise.all([rig.lore(["convert", target, ...DECIDED_FLAGS]), rig.lore(["convert", target, ...DECIDED_FLAGS])]);
    rmSync(delayFile());
    expect([a.exitCode, b.exitCode].sort(), `${a.stderr}\n${b.stderr}`).toEqual([0, 5]);
    const loser = a.exitCode === 5 ? a : b;
    expect(loser.stderr.toLowerCase()).toMatch(/stale|version/);
    const after = await stored(target);
    expect(after.version).toBe(before.version + 1);
    expect(after.extra["template_ref"]).toBe("template-spec-tech-template@1");
  });

  it("converting every remaining listed document leaves lore convert --list empty", async () => {
    for (const row of await openList()) {
      const result = await rig.lore(["convert", row.slug, ...DECIDED_FLAGS]);
      expect(result.exitCode, `${row.slug}: ${result.stderr}`).toBe(0);
    }
    expect(await openList()).toEqual([]);
    const human = await rig.lore(["convert", "--list"]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("No open legacy documents");
    // every converted open document is templated; every frozen one is still in its old form
    for (const key of OPEN) expect((await stored(slugs[key]!)).extra["template_ref"], key).toBeDefined();
    for (const key of FROZEN) expect((await stored(slugs[key]!)).extra["template_ref"], key).toBeUndefined();
    expect(existsSync(answerFile())).toBe(true);
  });
});
