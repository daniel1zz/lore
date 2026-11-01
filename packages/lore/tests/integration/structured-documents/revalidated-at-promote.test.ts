// @reads assets/project/lore-config-template.yaml
// @reads packages/lore/src/**
// @spawns-external git builds a throwaway git repository the test runs against
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-4: ONE validating write path.
 *
 * This file holds the WRITE half of AC-ST-4 (task T6): writing an invalid templated document through each write surface
 * (CLI create, CLI set, HTTP POST, HTTP PATCH, CorpusService.create/set) is refused with exit 4 (or the surface's
 * equivalent error) and writes nothing, and a static scan finds no adapter module writing document rows through the
 * store interface. The PROMOTE half (cross-field checks refused at approve for every type, independent of
 * `judgment_required_types`) is the describe titled "promote-time cross-field checks for every type" at the end.
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
import { asyncLoreRunnerFor, ensureLiveRuleViaAsyncCli } from "../../helpers/cli-live-rule.js";
import { ensureRequirementsDocSlugAsync } from "../../helpers/parented-create.js";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { makeCleanTreeRepo } from "../../helpers/clean-tree-repo.js";
import { liveIo } from "../../live-invocation.js";
import {
  createStructuredRig,
  installTemplate,
  must,
  removeSeededTemplates,
  specTechTemplate,
  validSpecFiles,
  writeFieldsFile,
  type StructuredRig,
} from "../../helpers/structured-corpus.js";

const SPEC = "spec-every-document-is-stored-as-structured-fields-validated-by";

let rig: StructuredRig;
let liveRuleId = "";
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
  // reason: the live-rule fixture creates its baseline tree from the SHIPPED templates, so it runs before they are removed
  rig = await createStructuredRig("lore-revalidated");
  const fixturePrd = await ensureRequirementsDocSlugAsync(async (args) => await rig.lore(args));
  liveRuleId = await ensureLiveRuleViaAsyncCli(asyncLoreRunnerFor((args) => rig.lore(args), rig.dir), rig.dir, fixturePrd);
  await removeSeededTemplates(rig);
  // reason: approving a task compiles its done contract, which needs the base branch (main) to exist; the task is a corpus task (it changes no files)
  makeCleanTreeRepo(rig.dir);
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
  /**
   * One templated slot per document type. Every template lists `goal-has-measure` over a `goal` field: a draft whose goal
   * has no measure is created (write time never runs the cross-field checks) and refused at approval naming the check.
   */
  interface Slot {
    readonly label: string;
    readonly docType: string;
    readonly kind?: string;
    /** The type's own required `extra` keys (the kind selector among them). */
    readonly extra: Record<string, unknown>;
    readonly parent?: "prd" | "plan";
  }
  const SLOTS: readonly Slot[] = [
    { label: "prd", docType: "prd", extra: {} },
    { label: "spec", docType: "spec", kind: "feature", extra: { spec_kind: "feature" } },
    { label: "adr", docType: "adr", extra: { decision_status: "proposed" }, parent: "prd" },
    { label: "plan", docType: "plan", extra: {}, parent: "prd" },
    { label: "task", docType: "task", extra: { kind: "corpus" }, parent: "plan" },
    { label: "knowledge/research", docType: "knowledge", kind: "research", extra: { sub_type: "research" }, parent: "prd" },
    { label: "baseline root", docType: "baseline", kind: "root", extra: { node: "root", label: "Root" }, parent: "prd" },
  ];

  const GOAL_DIMENSIONS = [{ id: "edge-cases", status: "na", answer: "no edge case: nothing varies", refs: [] }];
  const created = new Map<string, { id: string; slug: string }>();
  let prdId = "";
  let planId = "";
  let ruleId = "";

  function goalTemplate(slot: Slot): Record<string, unknown> {
    return {
      doc_type: slot.docType,
      ...(slot.kind === undefined ? {} : { kind: slot.kind }),
      version: 1,
      fields: {
        type: "object",
        properties: { goal: { type: "object", "x-goal": true, properties: { statement: { type: "string" }, measure: { type: "string" } } } },
      },
      dimensions: [{ id: "edge-cases", question: "Which edge cases does it handle?" }],
      checks: ["goal-has-measure"],
      render: [{ heading: "Goal", fields: ["goal"] }],
    };
  }

  async function lore(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return await rig.lore(args);
  }

  async function statusOf(slug: string): Promise<string> {
    const got = await lore(["get", slug, "--json"]);
    return (JSON.parse(got.stdout) as { data: { doc: { status: string } } }).data.doc.status;
  }

  beforeAll(async () => {
    const prd = await rig.lore(["create", "prd", "--title", "Promote checks product", "--content", "# P\n\nA product.\n", "--json"]);
    expect(prd.exitCode, prd.stderr).toBe(0);
    prdId = (JSON.parse(prd.stdout) as { data: { id: string } }).data.id;
    for (const slot of SLOTS) await installTemplate(rig, `Promote ${slot.label} template`, goalTemplate(slot));
    ruleId = liveRuleId;
    await rig.withApp(async (app) => {
      for (const slot of SLOTS) {
        const parentId = slot.parent === "prd" ? prdId : slot.parent === "plan" ? planId : undefined;
        const doc = await must(
          app.corpusService.create({
            type: slot.docType,
            title: `Promote check ${slot.label}`,
            ...(parentId === undefined ? {} : { parent_id: parentId }),
            extra: {
              ...slot.extra,
              ...(slot.docType === "task" ? { plan_id: planId } : {}),
              fields: { goal: { statement: "be faster", measure: "" } },
              dimensions: GOAL_DIMENSIONS,
            },
          } as never),
          `create ${slot.label}`,
        );
        if (slot.docType === "plan") planId = doc.id;
        created.set(slot.label, { id: doc.id, slug: doc.slug });
      }
    });
  }, 420_000);

  it("every slot has a draft that violates its template's goal-has-measure check (write time did not refuse it)", () => {
    expect([...created.keys()]).toEqual(SLOTS.map((slot) => slot.label));
  });

  it("with judgment REQUIRED for spec and adr (the default), approval of every type is refused naming goal-has-measure and the entry, and nothing changes", async () => {
    for (const slot of SLOTS) {
      const doc = created.get(slot.label);
      expect(doc, slot.label).toBeDefined();
      const slug = doc?.slug ?? "";
      const before = await lore(["get", slug, "--json"]);
      const refused = await lore(["approve", slug]);
      expect(refused.exitCode, `${slot.label}: ${refused.stderr}`).toBe(4);
      expect(refused.stderr, slot.label).toContain("goal-has-measure");
      expect(refused.stderr, slot.label).toContain("goal");
      expect(await statusOf(slug), slot.label).toBe("draft");
      expect((await lore(["get", slug, "--json"])).stdout, slot.label).toBe(before.stdout);
    }
  }, 300_000);

  it("with judgment required for NO type, the corrected document of every type promotes and its status is approved", async () => {
    patchLoreConfig(rig.dir, { workflow: { review: { judgment_required_types: [] } } });
    const fix = writeFieldsFile(rig, "goal-fix.yaml", { fields: { goal: { statement: "be faster", measure: "p95 under 200 ms" } } });
    for (const slot of SLOTS) {
      const slug = created.get(slot.label)?.slug ?? "";
      const stillBad = await lore(["approve", slug]);
      expect(stillBad.exitCode, `${slot.label} (judgment off, still violating): ${stillBad.stderr}`).toBe(4);
      expect(stillBad.stderr, slot.label).toContain("goal-has-measure");
      if (slot.docType !== "baseline") {
        const set = await lore(["set", slug, "--fields-file", fix]);
        expect(set.exitCode, `${slot.label}: ${set.stderr}`).toBe(0);
      } else {
        await rig.withApp(async (app) => {
          const current = await must(app.corpusService.get(slug), "get baseline");
          await must(app.corpusService.set(slug, { extra: { ...current.doc.extra, fields: { goal: { statement: "be faster", measure: "p95 under 200 ms" } } }, version: current.doc.version } as never), "fix baseline");
        });
      }
      if (slot.docType === "spec") {
        const added = await lore(["ac", "add", slug, "AC-1", "--statement", "the parser round-trips every fixture file", "--mode", "script", "--oracle", "test", "--command", "true"]);
        expect(added.exitCode, added.stderr).toBe(0);
        const cite = await lore(["ac", "cite", slug, "AC-1", ruleId]);
        expect(cite.exitCode, cite.stderr).toBe(0);
      }
      expect((await lore(["template", "check", slug])).exitCode, slot.label).toBe(0);
      const approved = await lore(["approve", slug]);
      expect(approved.exitCode, `${slot.label}: ${approved.stderr}`).toBe(0);
      expect(await statusOf(slug), slot.label).toBe("approved");
    }
  }, 600_000);
});
