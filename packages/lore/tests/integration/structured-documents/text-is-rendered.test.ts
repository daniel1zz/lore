// @reads assets/project/lore-config-template.yaml
// @spawns-external git builds a throwaway git repository the test runs against
/**
 * spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-2: a templated document's text is rendered from
 * its fields. A supplied body is refused on every write surface (CLI --content / --content-file, HTTP PATCH,
 * CorpusService.update) naming --fields-file; set --fields-file merges partially, revalidates and re-renders; the
 * rendered body is byte-identical for identical fields; search finds a word that exists only in a field; the mirror
 * export writes the rendered body.
 *
 * The MCP surface named in the AC statement is retired (adr-retire-the-lore-mcp-server-the-cli-and-http-are-th), so the
 * "one case each" for a stored body covers the surfaces that exist: CLI, HTTP and CorpusService.
 *
 * Coverage:
 *   HAPPY:      partial set --fields-file keeps the untouched fields and dimensions and re-renders; identical fields
 *               render byte-identically; search finds a field-only word; the export file carries the rendered body
 *   NEGATIVE:   --content and --content-file exit 4 naming --fields-file, version unchanged; HTTP PATCH content is
 *               refused; CorpusService.set content is refused (each changes nothing)
 *   BOUNDARY:   a resend of the stored body is not an edit (the dashboard resends whole forms); an invalid partial
 *               merge exits 4 and the stored document is unchanged
 *   REGRESSION: a legacy document (no template_ref) still takes --content
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHttpServer } from "../../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../../src/adapters/http/machine-auth.js";
import type { App } from "../../../src/app.js";
import { createLiveApp } from "../../helpers/live-app.js";
import { liveIo } from "../../live-invocation.js";
import {
  createStructuredRig,
  installTemplate,
  must,
  specTechTemplate,
  validSpecFiles,
  writeFieldsFile,
  type StructuredRig,
} from "../../helpers/structured-corpus.js";

const SPEC = "spec-every-document-is-stored-as-structured-fields-validated-by";

let rig: StructuredRig;
let httpApp: App;
let machineAuth: MachineAuthStores;
let machineDir: string;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let bearer: string;
let counter = 0;

interface StoredDoc {
  slug: string;
  id: string;
  version: number;
  content: string;
  extra: Record<string, unknown>;
}

async function createTemplated(label: string, summary: string, risks: string[] = ["stale reads"]): Promise<StoredDoc> {
  counter += 1;
  const files = validSpecFiles(summary);
  const file = writeFieldsFile(rig, `create-${String(counter)}.yaml`, { fields: { ...files.fields, risks }, dimensions: files.dimensions });
  const result = await rig.lore(["create", "spec", "--kind", "tech", "--title", `${label} ${String(counter)}`, "--fields-file", file, "--json"]);
  expect(result.exitCode, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { data: StoredDoc }).data;
}

async function stored(slug: string): Promise<StoredDoc> {
  const result = await rig.lore(["get", slug, "--json"]);
  return (JSON.parse(result.stdout) as { data: { doc: StoredDoc } }).data.doc;
}

beforeAll(async () => {
  rig = await createStructuredRig("lore-text-rendered");
  await installTemplate(rig, "Spec tech template", specTechTemplate(1));
  httpApp = createLiveApp(rig.dbPath);
  machineDir = mkdtempSync(join(tmpdir(), "lore-text-rendered-machine-"));
  machineAuth = createMachineAuthStores({ baseDir: machineDir });
  const key = await httpApp.apiKeyStore.create("agent-key", "agent");
  if (!key.ok) throw new Error("bearer key creation failed");
  bearer = key.value.rawKey;
  server = startHttpServer(httpApp, { io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
  baseUrl = `http://127.0.0.1:${String(server.port)}`;
}, 180_000);

afterAll(() => {
  server.stop(true);
  httpApp.close();
  machineAuth.db.close();
  rmSync(machineDir, { recursive: true, force: true });
  rig.cleanup();
});

describe(`${SPEC}#AC-ST-2 a supplied body is refused naming --fields-file`, () => {
  it("lore set --content exits 4 naming --fields-file and changes nothing", async () => {
    const doc = await createTemplated("Body refused", "content refusal summary");
    const result = await rig.lore(["set", doc.slug, "--content", "hand written text"]);
    expect(result.exitCode, result.stderr).toBe(4);
    expect(result.stderr).toContain("--fields-file");
    const after = await stored(doc.slug);
    expect(after.version).toBe(doc.version);
    expect(after.content).toBe(doc.content);
  });

  it("lore set --content-file exits 4 naming --fields-file and changes nothing", async () => {
    const doc = await createTemplated("Body file refused", "content file refusal summary");
    const path = join(rig.dir, "body.md");
    writeFileSync(path, "## Hand written\n\ntext\n");
    const result = await rig.lore(["set", doc.slug, "--content-file", path]);
    expect(result.exitCode, result.stderr).toBe(4);
    expect(result.stderr).toContain("--fields-file");
    expect((await stored(doc.slug)).version).toBe(doc.version);
  });

  it("HTTP PATCH with a content body is refused and changes nothing", async () => {
    const doc = await createTemplated("Http refused", "http refusal summary");
    const res = await fetch(`${baseUrl}/api/docs/${doc.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "## Hand written\n\nvia http\n" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(await res.json())).toContain("--fields-file");
    const after = await stored(doc.slug);
    expect(after.version).toBe(doc.version);
    expect(after.content).toBe(doc.content);
  });

  it("CorpusService.set with a content body is refused and changes nothing", async () => {
    const doc = await createTemplated("Service refused", "service refusal summary");
    const refused = await rig.withApp((app) => app.corpusService.set(doc.id, { content: "## Hand written\n\nvia service\n" } as never));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(refused.error)).toContain("--fields-file");
    }
    expect((await stored(doc.slug)).version).toBe(doc.version);
  });

  it("a resend of the stored body is not an edit (the dashboard and HTTP clients resend whole forms)", async () => {
    const doc = await createTemplated("Resend", "resend summary");
    const res = await fetch(`${baseUrl}/api/docs/${doc.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: doc.content, tags: ["resent"] }),
    });
    expect(res.status).toBe(200);
    expect((await stored(doc.slug)).content).toBe(doc.content);
  });

  it("a legacy document (no template_ref) still takes --content", async () => {
    const legacy = await rig.withApp((app) => must(app.corpusService.create({ type: "spec", title: "Legacy spec", content: "## Overview\n\nold\n" } as never), "legacy"));
    const result = await rig.lore(["set", legacy.slug, "--content", "## Overview\n\nedited\n"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect((await stored(legacy.slug)).content).toContain("edited");
  });
});

describe(`${SPEC}#AC-ST-2 set --fields-file merges, revalidates and re-renders`, () => {
  it("a partial update keeps the other fields and dimensions and re-renders the body", async () => {
    const doc = await createTemplated("Partial", "original summary text");
    const patch = writeFieldsFile(rig, "partial.yaml", { fields: { summary: "replacement summary text" } });
    const result = await rig.lore(["set", doc.slug, "--fields-file", patch]);
    expect(result.exitCode, result.stderr).toBe(0);
    const after = await stored(doc.slug);
    const fields = after.extra["fields"] as Record<string, unknown>;
    expect(fields["summary"]).toBe("replacement summary text");
    expect(fields["risks"]).toEqual(["stale reads"]);
    expect(after.extra["dimensions"]).toEqual(doc.extra["dimensions"]);
    expect(after.content).toContain("replacement summary text");
    expect(after.content).not.toContain("original summary text");
    expect(after.content).toContain("stale reads");
    expect(after.version).toBe(doc.version + 1);
  });

  it("a dimension in the patch replaces that id only", async () => {
    const doc = await createTemplated("Dimension merge", "dimension merge summary");
    const patch = writeFieldsFile(rig, "dimension.yaml", { dimensions: [{ id: "edge-cases", status: "handled", answer: "now with a new answer", refs: [] }] });
    const result = await rig.lore(["set", doc.slug, "--fields-file", patch]);
    expect(result.exitCode, result.stderr).toBe(0);
    const dims = (await stored(doc.slug)).extra["dimensions"] as { id: string; answer: string }[];
    expect(dims).toHaveLength(3);
    expect(dims.find((d) => d.id === "edge-cases")?.answer).toBe("now with a new answer");
    expect(dims.find((d) => d.id === "evidence")?.answer).toBe("the criterion proves it");
  });

  it("an invalid partial merge exits 4 naming the field and leaves the document unchanged", async () => {
    const doc = await createTemplated("Invalid merge", "invalid merge summary");
    const patch = writeFieldsFile(rig, "invalid.yaml", { fields: { summary: "" } });
    const result = await rig.lore(["set", doc.slug, "--fields-file", patch]);
    expect(result.exitCode, result.stderr).toBe(4);
    expect(result.stderr).toContain("summary");
    const after = await stored(doc.slug);
    expect(after.version).toBe(doc.version);
    expect(after.content).toBe(doc.content);
  });

  it("--fields-file on a legacy document is refused (it is converted, not patched)", async () => {
    const legacy = await rig.withApp((app) => must(app.corpusService.create({ type: "spec", title: "Legacy fields", content: "## Overview\n\nold\n" } as never), "legacy"));
    const patch = writeFieldsFile(rig, "legacy.yaml", { fields: { summary: "x" } });
    const result = await rig.lore(["set", legacy.slug, "--fields-file", patch]);
    expect(result.exitCode, result.stderr).toBe(4);
    expect(result.stderr).toContain("template_ref");
  });
});

describe(`${SPEC}#AC-ST-2 the body is a deterministic projection of the fields`, () => {
  it("identical fields render byte-identical bodies", async () => {
    const first = await createTemplated("Identical A", "identical summary text", ["risk one", "risk two"]);
    const second = await createTemplated("Identical B", "identical summary text", ["risk one", "risk two"]);
    expect(second.content).toBe(first.content);
    expect(first.content.length).toBeGreaterThan(0);
  });

  it("lore search finds a word that exists only in a field", async () => {
    const doc = await createTemplated("Searchable", "ordinary words only", ["quokkaphrase"]);
    const result = await rig.lore(["search", "quokkaphrase", "--json"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(doc.slug);
  });

  it("the mirror export writes the rendered body", async () => {
    const doc = await createTemplated("Exported", "mirror summary text", ["wombatphrase"]);
    const exported = await rig.lore(["export-docs", "--type", "spec"]);
    expect(exported.exitCode, exported.stdout + exported.stderr).toBe(0);
    const specDir = join(rig.dir, "docs", "requirements", "spec");
    expect(existsSync(specDir)).toBe(true);
    const files = readdirSync(specDir).map((name) => readFileSync(join(specDir, name), "utf8"));
    const mirrored = files.find((text) => text.includes("wombatphrase"));
    expect(mirrored, "an exported file carries the field-only word").toBeDefined();
    expect(mirrored).toContain("## Summary");
    expect(mirrored).toContain(doc.content.trim().split("\n")[0] ?? "");
  });
});
