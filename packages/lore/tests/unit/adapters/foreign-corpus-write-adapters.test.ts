/**
 * @spec_ref spec-corpus-resolution-carries-provenance-and-a-foreign-write AC-CP-5
 *   ("THE ADAPTER MATRIX IS ASSERTED, INCLUDING ITS EXEMPTION")
 *
 * Three halves, each pinned to a MECHANISM rather than "it returned 200":
 *
 *   (a) MCP INHERITS — driving the `lore_create` MCP tool handler with
 *       `caller_cwd` pointing INTO a nested worktree (no own `.lore/`), a
 *       non-lifecycle write is refused carrying the SAME literal
 *       `FOREIGN_CORPUS_WRITE_TOKEN` the CLI's own `CorpusService.
 *       refuseIfForeignCorpusWrite` emits — asserted by importing that ONE
 *       exported constant and comparing by equality, never a second
 *       MCP-side string.
 *   (b) MCP CONTROL — the SAME tool, same shape call, `caller_cwd` inside
 *       the corpus's OWN tree: ACCEPTED, and the doc is read back from the
 *       corpus afterward (never just "no error"), proving the refusal
 *       tracks provenance rather than refusing every MCP write.
 *   (c) THE HTTP EXEMPTION IS OBSERVED AT THE PREDICATE BOUNDARY — a typed
 *       spy (`vi.mocked`, so a future signature change on the predicate
 *       breaks this file at compile time, never silently) wraps the
 *       EXPORTED `checkForeignCorpusWrite` and asserts it was invoked
 *       EXACTLY ONCE on an HTTP-adapter write (driven via `auth.ts`'s own
 *       `resolveDocWriteOpts`) with its `provenance` argument EXACTLY
 *       `null`, and that the write landed. A companion CONTROL
 *       (`CorpusService.createHandoffDoc`, a REAL, already-shipped write
 *       path that deliberately bypasses this guard by design) proves the
 *       spy assertion is not a tautology: that write ALSO succeeds, yet
 *       invokes the predicate ZERO times — demonstrating that "the write
 *       succeeded" alone can never distinguish "predicate saw null" from
 *       "predicate never ran", which is the exact false-oracle class
 *       AC-CP-5(c) exists to close.
 *
 * A fourth, non-AC BOUNDARY block pins this task's own design decision for
 * ABSENT `caller_cwd` on the MCP surface: treated exactly like HTTP's named
 * exemption (`provenance: null`, never a fallback to this long-lived
 * server's own frozen startup cwd) — asserted both behaviourally (the write
 * is accepted regardless of fixture) and mechanistically (the CLI's
 * `resolveCorpus` is never even invoked when `caller_cwd` is absent).
 *
 * A fifth block is a PRODUCTION-WIRING CENSUS over the source tree
 * (`task-the-http-exemption-is-conditional-on-where-lore-serve-was`). AC-CP-5(c)
 * above observes the predicate on a bare `CorpusService`, whose constructor
 * default is `{provenance: null, enabled: true}` — null BY CONSTRUCTION, so
 * that block alone can never go red when the COMPOSITION ROOT wires something
 * else, and for a while it did: `loader.ts` derived the guard's provenance
 * from the SERVER's startup `process.cwd()` for every surface, so `lore serve`
 * launched inside a nested worktree refused every HTTP write. The behavioural
 * half of that fix is asserted at the wired path in
 * `loader-foreign-write-surface.bun.test.ts` (a bun test — `loader.ts` pulls in
 * `bun:sqlite`, which vitest cannot resolve, so it CANNOT live in this file).
 * The census here closes the other half: it makes the loader's `"cli"` DEFAULT
 * safe by proving no production HTTP mount silently relies on it.
 *
 * Runner: vitest. This file touches no `bun:sqlite` (InMemoryStore only);
 * the MCP-side fixtures spawn only the real `git` binary via `corpus-
 * resolution.ts`'s own `spawnSync` calls, mirroring `corpus-resolver-
 * collapse.test.ts`'s identical real-git-fixture discipline.
 *
 * Fixture discipline: every corpus is a fresh `mkdtemp` directory — this
 * repo's own `.lore/` corpus is never touched (root CLAUDE.md).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore, ActorContext } from "../../../src/adapters/http/auth.js";
import { resolveDocWriteOpts } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import {
  checkForeignCorpusWrite,
  FOREIGN_CORPUS_WRITE_TOKEN,
} from "../../../src/service/foreign-corpus-write-guard.js";
import { resolveCorpus } from "../../../src/adapters/cli/corpus-resolution.js";

// ─── Module mocks — typed spies over the REAL implementations ─────────────
// `vi.fn(actual.X)` preserves the real behaviour (every non-spy assertion in
// this file exercises genuine production logic); only OBSERVABILITY is
// added. `vi.mocked(...)` at each call site is what makes these "typed"
// spies (AC-CP-5(c)'s own requirement): a future signature change on either
// wrapped function breaks this file's `.mock.calls[...]` accesses at
// COMPILE time, never silently.

vi.mock("../../../src/service/foreign-corpus-write-guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/service/foreign-corpus-write-guard.js")>();
  return { ...actual, checkForeignCorpusWrite: vi.fn(actual.checkForeignCorpusWrite) };
});

vi.mock("../../../src/adapters/cli/corpus-resolution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/adapters/cli/corpus-resolution.js")>();
  return { ...actual, resolveCorpus: vi.fn(actual.resolveCorpus) };
});

const guardSpy = vi.mocked(checkForeignCorpusWrite);
const resolveCorpusSpy = vi.mocked(resolveCorpus);

// ─── App test stub (mirrors mcp-tools.test.ts's own makeApp()) ────────────

const stubApiKeyStore = {} as ApiKeyStore;

function makeApp(store: InMemoryStore): App {
  return {
    corpusService: new CorpusService(store),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: new JudgmentService(store, new NoOpTelemetry()),
    auditService: null as unknown as App["auditService"],
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

type McpServerInternal = {
  _registeredTools: Record<
    string,
    { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }
  >;
};

function getToolHandler(
  server: McpServer,
  name: string,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  const internal = server as unknown as McpServerInternal;
  const tool = internal._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return (args) => tool.handler(args, {} as unknown);
}

function parseResult(result: CallToolResult): unknown {
  const text = result.content[0];
  if (!text || text.type !== "text") throw new Error("Expected text content");
  return JSON.parse(text.text);
}

// ─── Git/corpus fixture helpers (mirrors corpus-resolver-collapse.test.ts) ─

const scratchDirs: string[] = [];

function mkScratchDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratchDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initGitRepo(dir: string): void {
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "foreign-corpus-write-adapters-test@example.invalid"]);
  git(dir, ["config", "user.name", "foreign-corpus-write-adapters test"]);
  writeFileSync(join(dir, "README.md"), "AC-CP-5 fixture\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
}

/** Marks `dir` as an "own" corpus location — resolution is fs-existence-only, no real DB needed. */
function makeCorpus(dir: string): void {
  mkdirSync(join(dir, ".lore"), { recursive: true });
  writeFileSync(join(dir, ".lore", "lore.db"), "");
}

/**
 * A repo WITH its own `.lore/` at the root, and a NESTED linked worktree at
 * `repo/.claude/worktrees/agent-x` carrying NO `.lore/` of its own — the
 * exact fixture shape `foreign-corpus-write-guard.bun.test.ts` uses for the
 * CLI's own AC-CP-3. `resolveCorpus(worktreePath)` must resolve the PARENT
 * repo's corpus via the §M4 git-common-dir fallback (`provenance:
 * "git_common_dir"`) — every write from `worktreePath` is therefore
 * genuinely foreign.
 */
function makeNestedWorktreeFixture(prefix: string): { repoRoot: string; worktreePath: string } {
  const repoRoot = mkScratchDir(`${prefix}-repo-`);
  initGitRepo(repoRoot);
  makeCorpus(repoRoot);

  mkdirSync(join(repoRoot, ".claude", "worktrees"), { recursive: true });
  const worktreeRelPath = join(".claude", "worktrees", "agent-x");
  git(repoRoot, ["worktree", "add", "-b", `${prefix}-agent-x`, worktreeRelPath]);
  const worktreePath = join(repoRoot, worktreeRelPath);

  return { repoRoot, worktreePath };
}

/** A plain repo with its OWN `.lore/` — `resolveCorpus(repoRoot)` resolves `provenance: "own"`. */
function makeOwnCorpusFixture(prefix: string): string {
  const repoRoot = mkScratchDir(`${prefix}-own-`);
  initGitRepo(repoRoot);
  makeCorpus(repoRoot);
  return repoRoot;
}

// ─── Test setup ────────────────────────────────────────────────────────────

let store: InMemoryStore;
let app: App;
let server: McpServer;

beforeEach(() => {
  store = new InMemoryStore();
  app = makeApp(store);
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app);
  guardSpy.mockClear();
  resolveCorpusSpy.mockClear();
});

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

// ─── AC-CP-5(a) MCP INHERITS ───────────────────────────────────────────────

describe("AC-CP-5(a) MCP INHERITS — caller_cwd into a nested worktree is refused", () => {
  it("lore_create with caller_cwd pointing into a nested (foreign) worktree is refused carrying the CLI's exact literal token", async () => {
    const { worktreePath } = makeNestedWorktreeFixture("ac-cp-5a");
    const call = getToolHandler(server, "lore_create");

    const result = await call({ type: "prd", title: "AC-CP-5a foreign write", caller_cwd: worktreePath });

    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; field?: string; message: string };
    expect(error.field).toBe(FOREIGN_CORPUS_WRITE_TOKEN);
    expect(error.message).toContain(FOREIGN_CORPUS_WRITE_TOKEN);

    // Positive proof nothing landed — not just "an error came back" (the
    // empty-artifact false oracle this spec's own text calls out elsewhere).
    const listed = await app.corpusService.list({});
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value.total).toBe(0);
  });

  it("MECHANISM: the refused verdict came from the SAME exported checkForeignCorpusWrite the CLI calls, with provenance git_common_dir and intentDeclared false", async () => {
    const { worktreePath } = makeNestedWorktreeFixture("ac-cp-5a-mech");
    const call = getToolHandler(server, "lore_create");

    await call({ type: "prd", title: "AC-CP-5a mechanism", caller_cwd: worktreePath });

    expect(guardSpy).toHaveBeenCalledTimes(1);
    const [context, intentDeclared] = guardSpy.mock.calls[0]!;
    expect(context.provenance).toBe("git_common_dir");
    expect(context.enabled).toBe(true);
    expect(intentDeclared).toBe(false);
  });
});

// ─── AC-CP-5(b) MCP CONTROL ─────────────────────────────────────────────────

describe("AC-CP-5(b) MCP CONTROL — caller_cwd inside the corpus's own tree is accepted", () => {
  it("the SAME tool, SAME shape call, with caller_cwd inside the corpus's own tree: accepted, and the doc is read back from the corpus", async () => {
    const ownRoot = makeOwnCorpusFixture("ac-cp-5b");
    const call = getToolHandler(server, "lore_create");

    const result = await call({ type: "prd", title: "AC-CP-5b own-tree write", caller_cwd: ownRoot });

    expect(result.isError).toBeFalsy();
    const created = parseResult(result) as { id: string; slug: string };

    // Positive landing proof — read the doc BACK from the corpus, never just
    // "no error came back".
    const fetched = await app.corpusService.get(created.id);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) expect(fetched.value.doc.title).toBe("AC-CP-5b own-tree write");

    // TWO calls, by design, not a bug: this task's NEW per-call MCP check
    // (checkMcpForeignCorpusWrite) fires FIRST with the caller_cwd-derived
    // provenance ("own" here); when it allows, execution reaches
    // `corpusService.create()`, whose PRE-EXISTING internal
    // `refuseIfForeignCorpusWrite` ALSO calls the SAME predicate — against
    // this bare test App's own unrelated ambient default
    // ({provenance:null,enabled:true}, since `makeApp()` never calls
    // `setForeignCorpusWriteContext`). Both signals are independently
    // correct and neither replaces the other (defense in depth: a future
    // bug in either layer's provenance derivation still leaves the OTHER
    // layer checking).
    expect(guardSpy).toHaveBeenCalledTimes(2);
    expect(guardSpy.mock.calls[0]![0].provenance).toBe("own");
    expect(guardSpy.mock.calls[1]![0].provenance).toBeNull();
  });
});

// ─── BOUNDARY — ABSENT caller_cwd (this task's own design decision) ───────

describe("BOUNDARY — absent caller_cwd is treated exactly like HTTP's null exemption", () => {
  it("omitting caller_cwd entirely: the write is accepted regardless of the calling process's real location, and resolveCorpus is NEVER consulted", async () => {
    const call = getToolHandler(server, "lore_create");

    const result = await call({ type: "prd", title: "AC-CP-5 absent caller_cwd" });

    expect(result.isError).toBeFalsy();
    expect(resolveCorpusSpy).not.toHaveBeenCalled();

    // TWO calls (see AC-CP-5(b)'s identical note above): this task's new
    // per-call MCP check fires first (provenance null, caller_cwd absent),
    // then CorpusService's pre-existing internal check fires a second time
    // against its own unrelated bare-default ambient context (ALSO null
    // here, coincidentally — a different fact, not the same invocation).
    expect(guardSpy).toHaveBeenCalledTimes(2);
    const [context] = guardSpy.mock.calls[0]!;
    expect(context.provenance).toBeNull();
    expect(guardSpy.mock.calls[1]![0].provenance).toBeNull();
  });

  it("REGRESSION CONTROL: when caller_cwd IS supplied, resolveCorpus DOES get consulted — proving the previous test's zero-calls assertion discriminates rather than being permanently vacuous", async () => {
    const ownRoot = makeOwnCorpusFixture("ac-cp-5-boundary-control");
    const call = getToolHandler(server, "lore_create");

    await call({ type: "prd", title: "AC-CP-5 boundary control", caller_cwd: ownRoot });

    expect(resolveCorpusSpy).toHaveBeenCalledTimes(1);
    expect(resolveCorpusSpy).toHaveBeenCalledWith(ownRoot);
  });
});

// ─── AC-CP-5(c) THE HTTP EXEMPTION IS OBSERVED AT THE PREDICATE BOUNDARY ──

describe("AC-CP-5(c) HTTP EXEMPTION — observed at the predicate boundary via a typed spy", () => {
  it("an HTTP-adapter write (via auth.ts's resolveDocWriteOpts) invokes the predicate EXACTLY ONCE with provenance EXACTLY null, and the write lands", async () => {
    // Bare CorpusService construction — NEVER calls setForeignCorpusWriteContext,
    // so its ambient context stays the documented default {provenance: null,
    // enabled: true}, which is the SHAPE the HTTP exemption requires.
    //
    // ⛔ That default is null BY CONSTRUCTION, so this block proves the SHAPE
    // and nothing about the WIRING — an earlier version of this comment claimed
    // it was "the FACTUAL basis of the HTTP exemption", and that claim was
    // wrong: `adapters/http/**` indeed reads no `process.cwd()`, but the App it
    // serves comes from `loadLoreApp()`, which DID call
    // `setForeignCorpusWriteContext` with the server's startup-cwd provenance
    // (`task-the-http-exemption-is-conditional-on-where-lore-serve-was`). The
    // wiring is now asserted where it actually lives — the composition root —
    // by `loader-foreign-write-surface.bun.test.ts` (behaviour) and by the
    // production-wiring census at the bottom of this file (call sites).
    const httpStore = new InMemoryStore();
    const httpCorpusService = new CorpusService(httpStore);

    const actor: ActorContext = {
      name: "agent-http-key",
      session_id: "0123456789abcdef",
      callerSurface: "http_token",
    };
    const opts = resolveDocWriteOpts(actor);
    expect(opts).toEqual({ by: "agent-http-key" });

    guardSpy.mockClear();
    const result = await httpCorpusService.create({ type: "prd", title: "AC-CP-5c HTTP write" }, opts);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const fetched = await httpCorpusService.get(result.value.id);
      expect(fetched.ok).toBe(true);
      if (fetched.ok) expect(fetched.value.doc.title).toBe("AC-CP-5c HTTP write");
    }

    // The predicate-boundary assertion itself — typed via vi.mocked, so a
    // future signature change on checkForeignCorpusWrite breaks THIS file at
    // compile time rather than silently observing nothing.
    expect(guardSpy).toHaveBeenCalledTimes(1);
    const [context, intentDeclared] = guardSpy.mock.calls[0]!;
    expect(context.provenance).toBeNull();
    expect(context.enabled).toBe(true);
    expect(intentDeclared).toBe(false);
  });

  it("CONTROL — provenance:null is NOT indistinguishable from never-called: CorpusService.createHandoffDoc (a REAL write that deliberately bypasses this guard) succeeds while invoking the predicate ZERO times", async () => {
    const controlStore = new InMemoryStore();
    const controlCorpusService = new CorpusService(controlStore);

    guardSpy.mockClear();
    const result = await controlCorpusService.createHandoffDoc({ type: "prd", title: "AC-CP-5c bypass control" });

    // The write genuinely succeeds — "the write succeeded" alone tells you
    // NOTHING about whether the predicate ran.
    expect(result.ok).toBe(true);

    // Yet the predicate was NEVER invoked for this write (allowHandoff skips
    // it entirely, by design — foreign-corpus-write-guard.ts's own module
    // header, "createHandoffDoc/createUatDoc ... are DELIBERATELY EXEMPT").
    // This is what proves the spy assertion above is falsifiable rather than
    // decorative: an implementation that silently stopped calling the guard
    // for the HTTP write path would look IDENTICAL to this control under a
    // behaviour-only assertion, and only the spy's zero-call count exposes it.
    expect(guardSpy).not.toHaveBeenCalled();
  });
});

// ─── PRODUCTION-WIRING CENSUS — every HTTP mount declares the HTTP surface ──

/**
 * `loadLoreApp`'s `surface` option defaults to `"cli"`, because ~50 per-invocation
 * CLI commands legitimately want that and making the argument required would be a
 * repo-wide edit for no safety gain. The cost of that default is a DRIFT HOLE: a
 * new command that mounts `startHttpServer` and forgets `{surface: "http"}` gets
 * the startup-cwd provenance back, silently, and reintroduces the exact lockout
 * `task-the-http-exemption-is-conditional-on-where-lore-serve-was` closed. This
 * census is the mechanism that makes that drift LOUD.
 *
 * @param source - The full text of one `.ts` source file.
 * @returns Every `loadLoreApp(...)` CALL in `source` whose argument list is not
 *   exactly `{surface: "http"}` (whitespace-insensitive), rendered verbatim.
 *   Import statements and `typeof loadLoreApp` references carry no `(` and are
 *   therefore never matched.
 */
function findNonHttpLoaderCalls(source: string): string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(/loadLoreApp\(([^)]*)\)/g)) {
    const args = (match[1] ?? "").replace(/\s+/g, "");
    if (args !== '{surface:"http"}') calls.push(match[0]);
  }
  return calls;
}

/** Recursively collects every `.ts` file under `dir`. */
function collectTypeScriptSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectTypeScriptSources(full));
    else if (entry.name.endsWith(".ts")) found.push(full);
  }
  return found;
}

const LORE_SRC_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "src");

describe("PRODUCTION WIRING — every startHttpServer mount boots loadLoreApp with the HTTP surface", () => {
  it("no source file that CALLS startHttpServer contains a loadLoreApp call missing {surface: \"http\"}", () => {
    const sources = collectTypeScriptSources(LORE_SRC_ROOT);

    // Positive trace of execution — an empty scan is byte-identical to a clean
    // one, so assert the walk actually visited a real tree before trusting a
    // zero-violation verdict.
    expect(sources.length).toBeGreaterThan(100);

    const mountFiles: string[] = [];
    const violations: string[] = [];
    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      // A CALL, not the definition (`export function startHttpServer(`) —
      // `adapters/http/index.ts` declares it and never boots an App itself.
      const withoutDefinition = source.replace(/export function startHttpServer\(/g, "");
      if (!withoutDefinition.includes("startHttpServer(")) continue;
      if (!source.includes("loadLoreApp(")) continue;
      mountFiles.push(file);
      for (const call of findNonHttpLoaderCalls(source)) violations.push(`${file}: ${call}`);
    }

    // The census must have found the mounts it exists to police — otherwise a
    // renamed file would turn this into a permanently-vacuous pass.
    expect(mountFiles.some((f) => f.endsWith(join("commands", "serve.ts")))).toBe(true);
    expect(mountFiles.some((f) => f.endsWith(join("commands", "dashboard.ts")))).toBe(true);

    expect(violations).toEqual([]);
  });

  it("CONTROL — the classifier reports a bare loadLoreApp() as a violation, so the empty-violations assertion above is falsifiable", () => {
    expect(findNonHttpLoaderCalls("const { app } = loadLoreApp();")).toEqual(["loadLoreApp()"]);
    expect(findNonHttpLoaderCalls('const { app } = loadLoreApp({ surface: "cli" });')).toEqual([
      'loadLoreApp({ surface: "cli" })',
    ]);
    expect(findNonHttpLoaderCalls('const { app } = loadLoreApp({ surface: "http" });')).toEqual([]);
    // An import or a `typeof` reference is not a call and must never be flagged.
    expect(findNonHttpLoaderCalls('import { loadLoreApp } from "../loader.js";')).toEqual([]);
    expect(findNonHttpLoaderCalls("type A = ReturnType<typeof loadLoreApp>['app'];")).toEqual([]);
  });
});
