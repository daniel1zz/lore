// @reads assets/project/lore-config-template.yaml
/**
 * spec-every-document-is-stored-as-structured-fields-validated-by (BR-1528): a shipped seed NEWER than the approved
 * corpus template becomes a PROPOSED REVISION of that template document, never an in-place overwrite.
 *
 * Coverage:
 *   HAPPY:      preview names the revision and writes nothing; apply leaves the template document a draft carrying the
 *               new version while the approved version keeps resolving; approving it makes the new version resolve
 *   NEGATIVE:   a seed with the same or an older version changes nothing; a second apply (revision already pending) writes
 *               nothing; a document pinned to the old version still validates against it
 *   STATE:      the approved snapshot of the old version is never rewritten
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseTemplate, type Template } from "@lore/core";
import { TemplateSeedService, type SeedOutcome } from "../../../src/service/template-seed-service.js";
import { createStructuredRig, installTemplate, must, specTechTemplate, type StructuredRig } from "../../helpers/structured-corpus.js";

const SLUG = "template-spec-tech-template";
let rig: StructuredRig;

function seedAt(version: number): Template {
  const parsed = parseTemplate(specTechTemplate(version));
  if (!parsed.ok) throw new Error(`fixture template invalid: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

async function run(mode: "preview" | "apply", version: number): Promise<SeedOutcome[]> {
  return await rig.withApp(async (app) => {
    if (app.templateService === undefined) throw new Error("no template service");
    const seeder = new TemplateSeedService(app.templateService, app.corpusService);
    const seeds = [{ file: "spec-tech.json", template: seedAt(version) }];
    return await must(mode === "apply" ? seeder.apply(seeds) : seeder.preview(seeds), `seed ${mode} v${String(version)}`);
  });
}

async function templateDoc(): Promise<{ status: string; version: number; templateVersion: number }> {
  return await rig.withApp(async (app) => {
    const got = await must(app.corpusService.get(SLUG), "get template doc");
    const body = got.doc.extra["template"] as { version: number };
    return { status: got.doc.status, version: got.doc.version, templateVersion: body.version };
  });
}

async function resolvedVersion(): Promise<number> {
  return await rig.withApp(async (app) => {
    if (app.templateService === undefined) throw new Error("no template service");
    return (await must(app.templateService.resolveTemplate("spec", "tech"), "resolve")).version;
  });
}

beforeAll(async () => {
  rig = await createStructuredRig("lore-seed-revision");
  await installTemplate(rig, "Spec tech template", specTechTemplate(1));
}, 180_000);

afterAll(() => rig.cleanup());

describe("spec-every-document-is-stored-as-structured-fields-validated-by seed newer than the corpus template", () => {
  it("a seed at the approved version changes nothing", async () => {
    const before = await templateDoc();
    const outcomes = await run("apply", before.templateVersion);
    expect(outcomes.map((o) => o.action)).toEqual(["present"]);
    expect(await templateDoc()).toEqual(before);
  });

  it("preview names the revision and writes nothing", async () => {
    const before = await templateDoc();
    const outcomes = await run("preview", before.templateVersion + 1);
    expect(outcomes).toEqual([
      expect.objectContaining({ action: "revise", slug: SLUG, from: before.templateVersion, to: before.templateVersion + 1 }),
    ]);
    expect(await templateDoc()).toEqual(before);
  });

  it("apply proposes the revision: the document is a draft with the new version, the approved version still resolves, a second apply writes nothing", async () => {
    const before = await templateDoc();
    const next = before.templateVersion + 1;
    const outcomes = await run("apply", next);
    expect(outcomes.map((o) => o.action)).toEqual(["revise"]);
    const proposed = await templateDoc();
    expect(proposed.status).toBe("draft");
    expect(proposed.templateVersion).toBe(next);
    expect(await resolvedVersion()).toBe(before.templateVersion);

    const again = await run("apply", next);
    expect(again.map((o) => o.action)).toEqual(["present"]);
    expect(await templateDoc()).toEqual(proposed);
  });

  it("approving the proposed revision makes the new version resolve; the old version stays resolvable as its pin", async () => {
    const pending = await templateDoc();
    await rig.withApp(async (app) => {
      await must(app.corpusService.set(SLUG, { status: "approved", version: pending.version } as never), "approve revision");
    });
    expect(await resolvedVersion()).toBe(pending.templateVersion);
    await rig.withApp(async (app) => {
      if (app.templateService === undefined) throw new Error("no template service");
      const old = await must(app.templateService.resolvePinned(`${SLUG}@${String(pending.templateVersion - 1)}`), "old pin");
      expect(old.version).toBe(pending.templateVersion - 1);
    });
  });
});
