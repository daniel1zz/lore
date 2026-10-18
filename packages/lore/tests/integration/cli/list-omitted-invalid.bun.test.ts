// @spawns packages/lore/src/index.ts
/**
 * AC-CRIT-6 — `lore list` / MCP `lore_list` report how many invalidated docs the
 * default validity filter hid (`omitted_invalid`), instead of hiding them silently.
 *
 * CLI runs in SOURCE mode against a THROWAWAY corpus (`mkdtemp` + `lore init`) — never
 * the repo's own `.lore/`. MCP runs the real `registerTools` against an InMemoryStore.
 *
 *   HAPPY:      default list -> total 1, omitted_invalid 1, text footer "1 invalidated hidden"
 *   BOUNDARY:   --include-invalid -> total 2, omitted_invalid 0, no footer note
 *   NEGATIVE:   a type with nothing invalidated -> omitted_invalid 0, no footer note
 *   REGRESSION: BR-745 — the invalidated doc stays excluded from the default rows
 *   MCP:        lore_list result carries omitted_invalid
 */
import { liveInvocation } from "../../live-invocation.js";
import { afterAll, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NoOpTelemetry, ok } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { ValidityService } from "../../../src/service/validity-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { App } from "../../../src/app.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

function runLore(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function runOrThrow(args: string[], dir: string, label: string): string {
  const r = runLore(args, dir);
  if (r.exitCode !== 0) throw new Error(`${label} failed (exit ${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

const slugOf = (stdout: string): string => (JSON.parse(stdout) as { data: { slug: string } }).data.slug;

const tmpDir = mkdtempSync(join(tmpdir(), "lore-list-omitted-invalid-"));
runOrThrow(["init"], tmpDir, "lore init");
appendFileSync(
  join(tmpDir, ".lore", "config.yaml"),
  ["workflow:", "  gates:", "    spec-create:", "      enabled: false", ""].join("\n"),
);
const prd = slugOf(
  runOrThrow(
    ["create", "prd", "--title", "Omitted Root", "--no-ai", "--content", "## Overview\n\nBody.", "--json"],
    tmpDir,
    "prd",
  ),
);
function createKnowledge(title: string): string {
  return slugOf(
    runOrThrow(
      [
        "create", "knowledge", "--title", title, "--sub-type", "reference", "--parent", prd,
        "--no-ai", "--content", "## Fact\n\nBody.", "--json",
      ],
      tmpDir,
      `create ${title}`,
    ),
  );
}
const liveSlug = createKnowledge("Live Fact Alpha");
const deadSlug = createKnowledge("Dead Fact Beta");
runOrThrow(["invalidate", deadSlug, "--reason", "retracted for test", "--json"], tmpDir, "invalidate");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

interface ListJson {
  ok: boolean;
  data: { docs: Array<{ slug: string }>; total: number; omitted_invalid: number };
}
const listJson = (extra: string[]): ListJson =>
  JSON.parse(runOrThrow(["list", "--type", "knowledge", "--json", ...extra], tmpDir, "list")) as ListJson;

describe("AC-CRIT-6: lore list reports omitted_invalid (CLI)", () => {
  it("AC-CRIT-6 default JSON: total=1, omitted_invalid=1, invalidated doc excluded (BR-745)", () => {
    const out = listJson([]);
    expect(out.data.total).toBe(1);
    expect(out.data.omitted_invalid).toBe(1);
    const slugs = out.data.docs.map((d) => d.slug);
    expect(slugs).toContain(liveSlug);
    expect(slugs).not.toContain(deadSlug);
  });

  it("AC-CRIT-6 default text footer says '1 invalidated hidden'", () => {
    const r = runLore(["list", "--type", "knowledge"], tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("1 invalidated hidden");
    expect(r.stdout).toContain("--include-invalid");
  });

  it("AC-CRIT-6 --include-invalid: total=2, omitted_invalid=0, no hidden note", () => {
    const out = listJson(["--include-invalid"]);
    expect(out.data.total).toBe(2);
    expect(out.data.omitted_invalid).toBe(0);
    const r = runLore(["list", "--type", "knowledge", "--include-invalid"], tmpDir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain("invalidated hidden");
  });

  it("AC-CRIT-6 nothing invalidated: omitted_invalid=0 and no footer note", () => {
    const out = JSON.parse(runOrThrow(["list", "--type", "prd", "--json"], tmpDir, "list prd")) as ListJson;
    expect(out.data.omitted_invalid).toBe(0);
    const r = runLore(["list", "--type", "prd"], tmpDir);
    expect(r.stdout).not.toContain("invalidated hidden");
  });
});

describe("AC-CRIT-6: MCP lore_list carries omitted_invalid", () => {
  it("AC-CRIT-6 lore_list reports omitted_invalid=1 by default and 0 with include_invalid", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const validityService = new ValidityService(store);
    const app = {
      corpusService,
      validityService,
      taskWorkflowService: new TaskWorkflowService(
        store,
        new NoOpTelemetry(),
        { claimTtlMinutes: 120 },
        async () => ok(new Set()),
      ),
      callerSurface: "mcp" as const,
      telemetry: new NoOpTelemetry(),
      close: () => undefined,
    } as unknown as App;
    const mk = async (title: string) => {
      const r = await corpusService.create({
        type: "knowledge",
        title,
        content: `# ${title}\n\nBody.`,
        extra: { sub_type: "reference" },
      } as CreateDocInput);
      if (!r.ok) throw new Error(JSON.stringify(r.error));
      return r.value;
    };
    await mk("Live");
    const dead = await mk("Dead");
    const inv = await validityService.invalidate(dead.slug, { reason: "r" } as never);
    if (!inv.ok) throw new Error(JSON.stringify(inv.error));

    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerTools(server, app, undefined, liveInvocation());
    const tool = (
      server as unknown as {
        _registeredTools: Record<
          string,
          { handler: (a: Record<string, unknown>, e: unknown) => Promise<CallToolResult> }
        >;
      }
    )._registeredTools["lore_list"];
    const call = async (args: Record<string, unknown>) => {
      const res = await tool!.handler(args, {});
      const c = res.content[0];
      if (!c || c.type !== "text") throw new Error("expected text");
      return JSON.parse(c.text) as { total: number; omitted_invalid: number };
    };
    const def = await call({ type: "knowledge" });
    expect(def.total).toBe(1);
    expect(def.omitted_invalid).toBe(1);
    const all = await call({ type: "knowledge", include_invalid: true });
    expect(all.total).toBe(2);
    expect(all.omitted_invalid).toBe(0);
  });
});
