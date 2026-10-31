// @reads assets/project/lore-config-template.yaml
// @spawns-external git builds a throwaway git repository the test runs against
/**
 * `lore template show <type> [--kind] [--blank] [--json]` and `lore template check <doc>` (structured-documents T2).
 *
 * Throwaway corpus (mkdtemp + `lore init`, never the repo's own .lore/): one approved knowledge/reference template
 * (a required summary, an optional note, a refusal list and a ref list, two dimensions one of which needs refs, checks
 * refusal-has-ac and refs-resolve), a draft-only task template, and templated documents pinned to it. Everything is
 * driven through the real command tree (`runLoreInProcess`).
 *
 * Coverage:
 *   HAPPY:      show prints ref, fields, dimension questions, checks and render sections; --json carries the same;
 *               --blank prints YAML with every required field and one entry per dimension; check on a clean doc exits 0
 *   NEGATIVE:   show of a type with no approved template (and of a draft-only template) exits 4 naming it; check with a
 *               schema violation, a missing dimension, a dangling ref or an uncited refusal exits 4 naming each;
 *               check of a document with no template_ref exits 4; an unknown document exits 3
 *   BOUNDARY:   --blank leaves optional fields out; a kind that has no template is refused naming type/kind
 *   STATE:      check writes nothing (document version, document count and audit entries unchanged);
 *               after a template revision to @2 a document pinned to @1 stays clean and show returns @2
 *   REGRESSION: show --blank --json and the YAML agree on the dimension ids
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createLiveApp } from "../../helpers/live-app.js";
import { runLoreInProcess } from "../../helpers/run-lore-in-process.js";
import type { App } from "../../../src/app.js";

let dir: string;
let home: string;
let dbPath: string;
let templateSlug: string;
let templateId: string;
let prdId: string;

function templateBody(version: number, extraDimension = false): Record<string, unknown> {
  return {
    doc_type: "knowledge",
    kind: "reference",
    version,
    fields: {
      type: "object",
      required: ["summary"],
      properties: {
        summary: { type: "string", minLength: 1, description: "One-paragraph summary" },
        note: { type: "string" },
        refusals: { type: "array", items: { type: "string" }, "x-refusal-list": true },
        sources: { type: "array", items: { type: "string" }, "x-ref-list": true },
      },
    },
    dimensions: [
      { id: "scope", question: "What does this reference cover?" },
      { id: "evidence", question: "What backs it?", needs_refs: true },
      ...(extraDimension ? [{ id: "rollback", question: "How is it undone?" }] : []),
    ],
    checks: ["refusal-has-ac", "refs-resolve"],
    render: [{ heading: "Summary", fields: ["summary"] }, { heading: "Sources", fields: ["sources"] }],
  };
}

async function lore(args: string[]) {
  return await runLoreInProcess(args, { cwd: dir, home });
}

async function withApp<T>(body: (app: App) => Promise<T>): Promise<T> {
  const app = createLiveApp(dbPath);
  try {
    return await body(app);
  } finally {
    app.close();
  }
}

async function must<T>(result: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>, what: string): Promise<T> {
  const done = await result;
  if (!done.ok) throw new Error(`${what}: ${JSON.stringify(done.error)}`);
  return done.value;
}

async function approve(app: App, id: string): Promise<void> {
  const current = await must(app.corpusService.get(id), "get for approve");
  await must(app.corpusService.set(id, { status: "approved", version: current.doc.version } as never), "approve");
}

const goodDimensions = [
  { id: "scope", status: "handled", answer: "the module", refs: [] },
  { id: "evidence", status: "handled", answer: "see the sources", refs: ["summary"] },
];

async function createDoc(title: string, extra: Record<string, unknown>): Promise<string> {
  return await withApp(async (app) => {
    const created = await must(
      app.corpusService.create({
        type: "knowledge",
        title,
        content: "x",
        parent_id: prdId,
        extra: { sub_type: "reference", template_ref: `${templateSlug}@1`, ...extra },
      } as never),
      `create ${title}`,
    );
    return created.slug;
  });
}

async function countDocsAndVersions(slug: string): Promise<{ docs: number; version: number; audit: number }> {
  return await withApp(async (app) => {
    const docs = await must(app.corpusService.list({} as never), "list");
    const doc = await must(app.corpusService.get(slug), "get");
    const audit = await must(app.auditService === undefined ? Promise.resolve({ ok: true as const, value: [] }) : app.auditService.query({} as never), "audit");
    return { docs: docs.total, version: doc.doc.version, audit: (audit as unknown[]).length };
  });
}

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-template-cli-")));
  home = realpathSync(mkdtempSync(join(tmpdir(), "lore-template-cli-home-")));
  const init = await lore(["init"]);
  if (init.exitCode !== 0) throw new Error(`init failed: ${init.stderr}`);
  dbPath = join(dir, ".lore", "lore.db");

  await withApp(async (app) => {
    prdId = (await must(app.corpusService.create({ type: "prd", title: "Template CLI PRD", content: "root" } as never), "prd")).id;
    const template = await must(
      app.corpusService.create({ type: "template", title: "Reference knowledge template", extra: { template: templateBody(1) } } as never),
      "template",
    );
    templateSlug = template.slug;
    templateId = template.id;
    await approve(app, template.id);
    // a draft-only template: never approved, so it must not resolve
    await must(
      app.corpusService.create({
        type: "template",
        title: "Draft task template",
        extra: {
          template: {
            doc_type: "task",
            version: 1,
            fields: { type: "object", properties: { goal: { type: "string" } } },
            dimensions: [{ id: "why", question: "Why?" }],
            checks: [],
            render: [{ heading: "Goal", fields: ["goal"] }],
          },
        },
      } as never),
      "draft template",
    );
  });
}, 120_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe("lore template show", () => {
  it("prints the ref, fields, dimension questions, checks and render sections (HAPPY)", async () => {
    const result = await lore(["template", "show", "knowledge", "--kind", "reference"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${templateSlug}@1`);
    expect(result.stdout).toContain("summary");
    expect(result.stdout).toContain("required");
    expect(result.stdout).toContain("x-refusal-list");
    expect(result.stdout).toContain("What does this reference cover?");
    expect(result.stdout).toContain("needs refs");
    expect(result.stdout).toContain("refusal-has-ac, refs-resolve");
    expect(result.stdout).toContain("Summary: summary");
  });

  it("--json carries the template parts (HAPPY)", async () => {
    const result = await lore(["template", "show", "knowledge", "--kind", "reference", "--json"]);
    expect(result.exitCode).toBe(0);
    const data = (JSON.parse(result.stdout) as { data: Record<string, unknown> }).data;
    expect(data["ref"]).toBe(`${templateSlug}@1`);
    expect(data["kind"]).toBe("reference");
    expect((data["dimensions"] as unknown[]).length).toBe(2);
    expect(data["checks"]).toEqual(["refusal-has-ac", "refs-resolve"]);
    expect(data["blank"]).toBeUndefined();
  });

  it("--blank prints a YAML skeleton with each required field and one entry per dimension (HAPPY, BOUNDARY)", async () => {
    const result = await lore(["template", "show", "knowledge", "--kind", "reference", "--blank"]);
    expect(result.exitCode).toBe(0);
    const skeleton = parseYaml(result.stdout) as { fields: Record<string, unknown>; dimensions: { id: string; status: string; answer: string; refs: unknown[] }[] };
    expect(Object.keys(skeleton.fields)).toEqual(["summary"]);
    expect(skeleton.dimensions.map((d) => d.id)).toEqual(["scope", "evidence"]);
    expect(skeleton.dimensions[0]).toEqual({ id: "scope", status: "handled", answer: "", refs: [] });
    expect(result.stdout).toContain("What backs it?");
    expect(result.stdout).toContain("REQUIRED");
  });

  it("--blank --json agrees with the YAML on the dimension ids (REGRESSION)", async () => {
    const yamlRun = await lore(["template", "show", "knowledge", "--kind", "reference", "--blank"]);
    const jsonRun = await lore(["template", "show", "knowledge", "--kind", "reference", "--blank", "--json"]);
    const fromYaml = (parseYaml(yamlRun.stdout) as { dimensions: { id: string }[] }).dimensions.map((d) => d.id);
    const blank = (JSON.parse(jsonRun.stdout) as { data: { blank: { dimensions: { id: string }[] } } }).data.blank;
    expect(blank.dimensions.map((d) => d.id)).toEqual(fromYaml);
  });

  it("refuses a type with no approved template, naming it (NEGATIVE)", async () => {
    const result = await lore(["template", "show", "nosuchtype"]);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("nosuchtype");
  });

  it("does not resolve a draft-only template (NEGATIVE)", async () => {
    const result = await lore(["template", "show", "task"]);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("no approved template for task");
  });

  it("refuses a kind that has no template, naming type/kind (BOUNDARY)", async () => {
    const result = await lore(["template", "show", "knowledge", "--kind", "retro"]);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("knowledge/retro");
  });
});

describe("lore template check", () => {
  it("exits 0 for a clean document and writes nothing (HAPPY, STATE)", async () => {
    const slug = await createDoc("Clean reference", {
      fields: { summary: "all good", sources: ["summary"] },
      dimensions: goodDimensions,
    });
    const before = await countDocsAndVersions(slug);
    const result = await lore(["template", "check", slug]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("clean");
    expect(await countDocsAndVersions(slug)).toEqual(before);
  });

  it("names a schema violation, a missing dimension, a dangling ref and an uncited refusal, exit 4 (NEGATIVE)", async () => {
    const slug = await createDoc("Broken reference", {
      fields: { refusals: ["refuse-x"], sources: ["no-such-doc-anywhere"] },
      dimensions: [{ id: "scope", status: "handled", answer: "the module", refs: [] }],
    });
    const before = await countDocsAndVersions(slug);
    const result = await lore(["template", "check", slug]);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("schema-violation");
    expect(result.stdout).toContain("summary");
    expect(result.stdout).toContain("missing-dimension");
    expect(result.stdout).toContain("evidence");
    expect(result.stdout).toContain("refs-resolve");
    expect(result.stdout).toContain("no-such-doc-anywhere");
    expect(result.stdout).toContain("refusal-has-ac");
    expect(result.stdout).toContain("refuse-x");
    expect(await countDocsAndVersions(slug)).toEqual(before);
  });

  it("--json reports problems and findings separately (HAPPY)", async () => {
    const slug = await createDoc("Json reference", {
      fields: { summary: "ok", refusals: ["refuse-y"] },
      dimensions: goodDimensions,
    });
    const result = await lore(["template", "check", slug, "--json"]);
    expect(result.exitCode).toBe(4);
    const data = (JSON.parse(result.stdout) as { data: { clean: boolean; problems: unknown[]; findings: { check: string }[] } }).data;
    expect(data.clean).toBe(false);
    expect(data.problems).toEqual([]);
    expect(data.findings.map((f) => f.check)).toEqual(["refusal-has-ac"]);
  });

  it("refuses a document with no template_ref (NEGATIVE)", async () => {
    const slug = await withApp(async (app) => {
      const created = await must(
        app.corpusService.create({ type: "knowledge", title: "Unpinned", content: "x", parent_id: prdId, extra: { sub_type: "reference" } } as never),
        "unpinned",
      );
      return created.slug;
    });
    const result = await lore(["template", "check", slug]);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("template_ref");
  });

  it("exits 3 for an unknown document (NEGATIVE)", async () => {
    const result = await lore(["template", "check", "no-such-document"]);
    expect(result.exitCode).toBe(3);
  });

  it("keeps a document clean against its pinned @1 after the template is revised to @2 (STATE)", async () => {
    const slug = await createDoc("Pinned reference", {
      fields: { summary: "pinned", sources: ["summary"] },
      dimensions: goodDimensions,
    });
    await withApp(async (app) => {
      const current = await must(app.corpusService.get(templateId), "get template");
      await must(app.corpusService.set(templateId, { extra: { template: templateBody(2, true) }, version: current.doc.version } as never), "revise");
      await approve(app, templateId);
    });
    const pinned = await lore(["template", "check", slug]);
    expect(pinned.exitCode).toBe(0);
    const shown = await lore(["template", "show", "knowledge", "--kind", "reference", "--json"]);
    const data = (JSON.parse(shown.stdout) as { data: { ref: string; dimensions: unknown[] } }).data;
    expect(data.ref).toBe(`${templateSlug}@2`);
    expect(data.dimensions.length).toBe(3);
  });
});
