// @reads assets/project/lore-config-template.yaml
// @reads packages/lore/src/**
// @spawns-external git builds a throwaway git repository the test runs against
/**
 * spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-4: ONE validating write path.
 *
 * This file holds the WRITE half of AC-ST-4 (task T6): writing an invalid templated document through each write surface
 * (CLI create, CLI set, HTTP POST, HTTP PATCH, CorpusService.create/set) is refused with exit 4 (or the surface's
 * equivalent error) and writes nothing, and a static scan finds no adapter module writing document rows through the
 * store interface. The PROMOTE half (cross-field checks refused at approve for every type) is added by task T7 in the
 * describe titled "promote-time cross-field checks for every type", which this file leaves empty on purpose.
 *
 * The MCP surface named in the AC statement is retired (adr-retire-the-lore-mcp-server-the-cli-and-http-are-th); the
 * surfaces that exist are CLI, HTTP and CorpusService.
 *
 * Coverage:
 *   NEGATIVE:   each surface refuses an invalid templated create and an invalid templated update
 *   STATE:      document count and version are unchanged after every refusal
 *   HAPPY:      the same surfaces accept a valid templated create
 *   REGRESSION: static scan: no module under adapters/ or flows/ calls a document-row store writer
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
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

function title(label: string): string {
  counter += 1;
  return `${label} ${String(counter)}`;
}

const INVALID_FIELDS = { fields: { risks: ["no summary"] }, dimensions: [] as unknown[] };

beforeAll(async () => {
  rig = await createStructuredRig("lore-revalidated");
  await installTemplate(rig, "Spec tech template", specTechTemplate(1));
  httpApp = createLiveApp(rig.dbPath);
  machineDir = mkdtempSync(join(tmpdir(), "lore-revalidated-machine-"));
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

async function createValidViaCli(label: string): Promise<{ slug: string; id: string; version: number }> {
  const file = writeFieldsFile(rig, `valid-${String(++counter)}.yaml`, validSpecFiles());
  const result = await rig.lore(["create", "spec", "--kind", "tech", "--title", title(label), "--fields-file", file, "--json"]);
  expect(result.exitCode, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { data: { slug: string; id: string; version: number } }).data;
}

async function versionOf(slug: string): Promise<number> {
  const got = await rig.lore(["get", slug, "--json"]);
  return (JSON.parse(got.stdout) as { data: { doc: { version: number } } }).data.doc.version;
}

describe(`${SPEC}#AC-ST-4 one validating write path: an invalid templated document is refused on every surface`, () => {
  it("CLI create: exit 4, nothing written", async () => {
    const before = await rig.countDocs();
    const file = writeFieldsFile(rig, "cli-create-invalid.yaml", INVALID_FIELDS);
    const result = await rig.lore(["create", "spec", "--kind", "tech", "--title", title("Cli create"), "--fields-file", file]);
    expect(result.exitCode, result.stderr).toBe(4);
    expect(await rig.countDocs()).toBe(before);
  });

  it("CLI set: exit 4, version unchanged", async () => {
    const doc = await createValidViaCli("Cli set");
    const file = writeFieldsFile(rig, "cli-set-invalid.yaml", { fields: { summary: "" } });
    const result = await rig.lore(["set", doc.slug, "--fields-file", file]);
    expect(result.exitCode, result.stderr).toBe(4);
    expect(await versionOf(doc.slug)).toBe(doc.version);
  });

  it("HTTP POST: refused (4xx), nothing written", async () => {
    const before = await rig.countDocs();
    const res = await fetch(`${baseUrl}/api/docs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spec", title: title("Http create"), extra: { spec_kind: "tech", ...INVALID_FIELDS } }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await rig.countDocs()).toBe(before);
  });

  it("HTTP PATCH of the fields: refused (4xx), version unchanged", async () => {
    const doc = await createValidViaCli("Http patch");
    const current = (JSON.parse((await rig.lore(["get", doc.slug, "--json"])).stdout) as { data: { doc: { extra: Record<string, unknown> } } }).data.doc;
    const res = await fetch(`${baseUrl}/api/docs/${doc.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ extra: { ...current.extra, fields: { risks: ["no summary"] } } }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await versionOf(doc.slug)).toBe(doc.version);
  });

  it("CorpusService.create: VALIDATION_ERROR, nothing written", async () => {
    const before = await rig.countDocs();
    const refused = await rig.withApp((app) =>
      app.corpusService.create({ type: "spec", title: title("Service create"), extra: { spec_kind: "tech", ...INVALID_FIELDS } } as never),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("VALIDATION_ERROR");
    expect(await rig.countDocs()).toBe(before);
  });

  it("CorpusService.set: VALIDATION_ERROR, version unchanged", async () => {
    const doc = await createValidViaCli("Service set");
    const refused = await rig.withApp(async (app) => {
      const current = await must(app.corpusService.get(doc.id), "get");
      return await app.corpusService.set(doc.id, { extra: { ...current.doc.extra, dimensions: [] } } as never);
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("VALIDATION_ERROR");
    expect(await versionOf(doc.slug)).toBe(doc.version);
  });

  it("CorpusService.create with a supplied body next to fields is refused naming --fields-file", async () => {
    const files = validSpecFiles();
    const refused = await rig.withApp((app) =>
      app.corpusService.create({ type: "spec", title: title("Service body"), content: "## Hand written\n", extra: { spec_kind: "tech", ...files } } as never),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(JSON.stringify(refused.error)).toContain("--fields-file");
  });

  it("the same surfaces accept a valid templated create (HTTP POST and CorpusService.create)", async () => {
    const files = validSpecFiles();
    const res = await fetch(`${baseUrl}/api/docs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "spec", title: title("Http valid"), extra: { spec_kind: "tech", ...files } }),
    });
    expect(res.status).toBe(201);
    const viaService = await rig.withApp((app) =>
      app.corpusService.create({ type: "spec", title: title("Service valid"), extra: { spec_kind: "tech", ...files } } as never),
    );
    expect(viaService.ok).toBe(true);
    if (viaService.ok) expect(viaService.value.extra["template_ref"]).toMatch(/@1$/);
  });
});

describe(`${SPEC}#AC-ST-4 no adapter writes document rows through the store interface`, () => {
  /** The StoreInterface methods that write document, version or provenance rows. */
  const DOC_ROW_WRITERS = [
    "insert",
    "insertWithAllocatedOrdinal",
    "insertWithProvenance",
    "insertWithAllocatedOrdinalAndProvenance",
    "update",
    "updateWithProvenance",
    "softDelete",
    "softDeleteWithProvenance",
    "insertVersion",
    "moveRule",
    "allocateRuleAndUpdateLeaf",
  ];
  const WRITER_CALL = new RegExp(`\\b\\w*[sS]tore\\.(${DOC_ROW_WRITERS.join("|")})\\(`);
  const SRC = join(fileURLToPath(new URL("../../../src/", import.meta.url)));

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
    });
  }

  it("scans adapters/ and flows/ (non-empty) and names any module that calls a document-row writer", () => {
    const modules = [...walk(join(SRC, "adapters")), ...walk(join(SRC, "flows"))];
    expect(modules.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const path of modules) {
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
          const hit = WRITER_CALL.exec(line);
          if (hit !== null) offenders.push(`${relative(SRC, path)}:${String(index + 1)} ${hit[0]}`);
        });
    }
    expect(offenders, `adapters/flows must write documents through CorpusService only:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the scan fires on a planted call (guards against a pattern that matches nothing)", () => {
    expect(WRITER_CALL.test("await this.store.updateWithProvenance(id, patch)")).toBe(true);
    expect(WRITER_CALL.test("await app.corpusService.set(id, patch)")).toBe(false);
  });
});

describe(`${SPEC}#AC-ST-4 promote-time cross-field checks for every type`, () => {
  // Task T7 adds its cases here (prd, spec, adr, plan, task, a knowledge sub-type and a baseline node).
  it("is reserved for T7 (see the file header)", () => {
    expect(true).toBe(true);
  });
});
