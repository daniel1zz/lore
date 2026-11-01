// @reads assets/project/lore-config-template.yaml
// @reads assets/templates/**
// @spawns-external git builds a throwaway git repository the test runs against
/**
 * spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-1: a templated document is validated at every
 * write (schema, every dimension answered, non-empty answers, refs present where a dimension needs them; refs are NOT
 * resolved at create), pins `template_ref`, validates against its PINNED version, and a type with no approved template
 * is refused. `lore migrate templates` seeds the missing templates and never overwrites an approved one.
 *
 * Throwaway corpus (mkdtemp + `lore init`, never the repo's own `.lore/`), driven through the real command tree.
 *
 * Coverage:
 *   HAPPY:      a valid create exits 0, pins slug@1 and renders the body; a create whose refs name a not-yet-declared AC
 *               succeeds; set --template-version latest after the new dimension is answered moves the pin to @2
 *   NEGATIVE:   (a) schema violation (b) missing dimension (c) n/a with an empty answer (d) needs_refs without refs
 *               (e) unknown dimension id: each exits exactly 4, names its field/dimension, and writes nothing
 *   BOUNDARY:   all five problems at once are named in ONE message; a kind with no template is refused naming it
 *   STATE:      after @2 the document still validates against @1; set --template-version latest refuses until the new
 *               dimension is answered and then writes nothing on the refusal
 *   REGRESSION: after init every slot is seeded (BR-807 as modified); lore migrate templates finds nothing to seed,
 *               leaves a newer approved corpus template untouched and is idempotent
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readShippedTemplateSeeds } from "../../../src/adapters/cli/template-seeds.js";

const SEED_COUNT = (() => {
  const seeds = readShippedTemplateSeeds();
  if (!seeds.ok) throw new Error(JSON.stringify(seeds.error));
  return seeds.value.length;
})();
import {
  createStructuredRig,
  installTemplate,
  reviseTemplate,
  specTechTemplate,
  validSpecFiles,
  writeFieldsFile,
  type StructuredRig,
} from "../../helpers/structured-corpus.js";

const SPEC = "spec-every-document-is-stored-as-structured-fields-validated-by";

let rig: StructuredRig;
let templateId: string;
let templateSlug: string;
let counter = 0;

function nextTitle(label: string): string {
  counter += 1;
  return `${label} ${String(counter)}`;
}

/** `lore create spec --kind tech` with the given fields file content. */
async function createTech(content: unknown, label = "Tech spec"): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const file = writeFieldsFile(rig, `fields-${String(++counter)}.yaml`, content);
  return await rig.lore(["create", "spec", "--kind", "tech", "--title", nextTitle(label), "--fields-file", file, "--json"]);
}

/** A refused create exits 4, names `needles`, and leaves the document count where it was. */
async function expectRefusedCreate(content: unknown, needles: string[]): Promise<void> {
  const before = await rig.countDocs();
  const result = await createTech(content, "Refused spec");
  expect(result.exitCode, result.stderr).toBe(4);
  for (const needle of needles) expect(result.stderr).toContain(needle);
  expect(await rig.countDocs()).toBe(before);
}

beforeAll(async () => {
  rig = await createStructuredRig("lore-validated-at-write", { templates: "none" });
  const installed = await installTemplate(rig, "Spec tech template", specTechTemplate(1));
  templateId = installed.id;
  templateSlug = installed.slug;
}, 180_000);

afterAll(() => {
  rig.cleanup();
});

describe(`${SPEC}#AC-ST-1 a create is validated against the latest approved template`, () => {
  it("(a) a schema violation exits 4 naming the field and writes nothing", async () => {
    const files = validSpecFiles();
    await expectRefusedCreate({ fields: { risks: ["x"] }, dimensions: files.dimensions }, ["summary"]);
  });

  it("(b) a missing dimension exits 4 naming it and writes nothing", async () => {
    const files = validSpecFiles();
    await expectRefusedCreate({ fields: files.fields, dimensions: files.dimensions.filter((d) => d["id"] !== "edge-cases") }, ["edge-cases"]);
  });

  it("(c) an n/a with an empty answer exits 4 naming the dimension and writes nothing", async () => {
    const files = validSpecFiles();
    const dimensions = files.dimensions.map((d) => (d["id"] === "failure-modes" ? { ...d, status: "na", answer: "  " } : d));
    await expectRefusedCreate({ fields: files.fields, dimensions }, ["failure-modes", "empty-answer"]);
  });

  it("(d) a needs_refs dimension with no refs exits 4 naming it and writes nothing", async () => {
    const files = validSpecFiles();
    const dimensions = files.dimensions.map((d) => (d["id"] === "evidence" ? { ...d, refs: [] } : d));
    await expectRefusedCreate({ fields: files.fields, dimensions }, ["evidence", "missing-refs"]);
  });

  it("(e) an unknown dimension id exits 4 naming it and writes nothing", async () => {
    const files = validSpecFiles();
    await expectRefusedCreate(
      { fields: files.fields, dimensions: [...files.dimensions, { id: "made-up", status: "handled", answer: "x", refs: [] }] },
      ["made-up", "unknown-dimension"],
    );
  });

  it("names every failing field and dimension in ONE message", async () => {
    const files = validSpecFiles();
    const dimensions = files.dimensions
      .filter((d) => d["id"] !== "edge-cases")
      .map((d) => (d["id"] === "evidence" ? { ...d, refs: [] } : d));
    await expectRefusedCreate({ fields: { risks: [] }, dimensions: [...dimensions, { id: "made-up", status: "handled", answer: "x", refs: [] }] }, [
      "summary",
      "edge-cases",
      "evidence",
      "made-up",
    ]);
  });

  it("a valid create exits 0, pins slug@1, renders the body, and does not resolve refs (the AC is declared later)", async () => {
    const files = validSpecFiles("Caching layers summary");
    const result = await createTech(files, "Valid spec");
    expect(result.exitCode, result.stderr).toBe(0);
    const doc = (JSON.parse(result.stdout) as { data: { extra: Record<string, unknown>; content: string } }).data;
    expect(doc.extra["template_ref"]).toBe(`${templateSlug}@1`);
    expect(doc.content).toContain("## Summary");
    expect(doc.content).toContain("Caching layers summary");
    expect(doc.extra["fields"]).toEqual(files.fields);
  });

  it("a kind with no approved template is refused naming spec/design, with the corpus unchanged", async () => {
    const before = await rig.countDocs();
    const file = writeFieldsFile(rig, "design-fields.yaml", validSpecFiles());
    const result = await rig.lore(["create", "spec", "--kind", "design", "--title", nextTitle("No template"), "--fields-file", file]);
    expect(result.exitCode, result.stderr).toBe(4);
    expect(result.stderr).toContain("spec/design");
    expect(await rig.countDocs()).toBe(before);
  });
});

describe(`${SPEC}#AC-ST-1 a document validates against its PINNED version`, () => {
  it("after the template is revised to @2 the document is still valid against @1; --template-version latest refuses until the new dimension is answered", async () => {
    const created = await createTech(validSpecFiles("Pinned spec"), "Pinned spec");
    expect(created.exitCode, created.stderr).toBe(0);
    const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;

    await reviseTemplate(rig, templateId, specTechTemplate(2, true));

    const check = await rig.lore(["template", "check", slug]);
    expect(check.exitCode, check.stdout + check.stderr).toBe(0);
    expect(check.stdout).toContain(`${templateSlug}@1`);

    const before = JSON.parse((await rig.lore(["get", slug, "--json"])).stdout) as { data: { doc: { version: number } } };
    const refused = await rig.lore(["set", slug, "--template-version", "latest"]);
    expect(refused.exitCode, refused.stderr).toBe(4);
    expect(refused.stderr).toContain("rollback");
    const after = JSON.parse((await rig.lore(["get", slug, "--json"])).stdout) as { data: { doc: { version: number; extra: Record<string, unknown> } } };
    expect(after.data.doc.version).toBe(before.data.doc.version);
    expect(after.data.doc.extra["template_ref"]).toBe(`${templateSlug}@1`);

    const answer = writeFieldsFile(rig, "rollback.yaml", {
      dimensions: [{ id: "rollback", status: "handled", answer: "revert the commit", refs: [] }],
    });
    const moved = await rig.lore(["set", slug, "--template-version", "latest", "--fields-file", answer]);
    expect(moved.exitCode, moved.stderr).toBe(0);
    const final = JSON.parse((await rig.lore(["get", slug, "--json"])).stdout) as { data: { doc: { extra: Record<string, unknown> } } };
    expect(final.data.doc.extra["template_ref"]).toBe(`${templateSlug}@2`);
  });
});

describe(`${SPEC}#AC-ST-1 lore migrate templates seeds what is missing and never overwrites an approved template`, () => {
  it("seeds a missing slot, leaves an approved corpus template untouched, and a second run writes nothing", async () => {
    const seedRig = await createStructuredRig("lore-seed-templates");
    try {
      // BR-807 as modified: `lore init` seeds one approved template per shipped seed, so a migrate finds every slot filled.
      const seeded = await seedRig.countDocs();
      expect(seeded).toBe(SEED_COUNT);

      const preview = await seedRig.lore(["migrate", "templates"]);
      expect(preview.exitCode, preview.stderr).toBe(0);
      expect(preview.stdout).not.toContain("would seed");
      expect(await seedRig.countDocs()).toBe(seeded);

      // an approved corpus template NEWER than the seed (v3 vs the seed's v2) is left untouched
      const custom = await installTemplate(seedRig, "Spec tech template", specTechTemplate(3));
      const applied = await seedRig.lore(["migrate", "templates", "--apply", "--json"]);
      expect(applied.exitCode, applied.stdout + applied.stderr).toBe(0);
      const outcomes = (JSON.parse(applied.stdout) as { data: { outcomes: { slot: string; action: string }[] } }).data.outcomes;
      expect(outcomes.every((o) => o.action === "present")).toBe(true);
      expect(outcomes).toHaveLength(SEED_COUNT);
      expect(await seedRig.countDocs()).toBe(seeded + 1);

      const tech = JSON.parse((await seedRig.lore(["template", "show", "spec", "--kind", "tech", "--json"])).stdout) as { data: { ref: string; dimensions: unknown[] } };
      expect(tech.data.ref).toBe(`${custom.slug}@3`);
      expect(tech.data.dimensions).toHaveLength(3);
      const task = await seedRig.lore(["template", "show", "task"]);
      expect(task.exitCode, task.stderr).toBe(0);

      const docsAfterFirst = await seedRig.countDocs();
      const again = await seedRig.lore(["migrate", "templates", "--apply", "--json"]);
      expect(again.exitCode, again.stderr).toBe(0);
      const secondOutcomes = (JSON.parse(again.stdout) as { data: { outcomes: { action: string }[] } }).data.outcomes;
      expect(secondOutcomes.some((o) => o.action === "seeded" || o.action === "revise")).toBe(false);
      expect(await seedRig.countDocs()).toBe(docsAfterFirst);
    } finally {
      seedRig.cleanup();
    }
  }, 180_000);
});
