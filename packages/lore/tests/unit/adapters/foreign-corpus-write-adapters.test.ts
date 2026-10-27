// @reads packages/lore/src/**
/**
 * @spec_ref spec-corpus-resolution-carries-provenance-and-a-foreign-write AC-CP-5
 *   ("THE ADAPTER MATRIX IS ASSERTED, INCLUDING ITS EXEMPTION")
 *
 * Two halves, each pinned to a MECHANISM rather than "it returned 200":
 *
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
 * A PRODUCTION-WIRING CENSUS over the source tree
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
 * (The MCP halves, (a) refused / (b) accepted / absent `caller_cwd`, left with the lore MCP server.)
 *
 * Runner: vitest. This file touches no `bun:sqlite` (InMemoryStore only).
 *
 * Fixture discipline: every corpus is a fresh `mkdtemp` directory — this
 * repo's own `.lore/` corpus is never touched (root CLAUDE.md).
 */

import { actedStore } from "../../live-invocation.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActorContext } from "../../../src/adapters/http/auth.js";
import { resolveDocWriteOpts } from "../../../src/adapters/http/auth.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import {
  checkForeignCorpusWrite,
} from "../../../src/service/foreign-corpus-write-guard.js";

// ─── Module mock — a typed spy over the REAL implementation ───────────────
// `vi.fn(actual.X)` preserves the real behaviour; only OBSERVABILITY is added. `vi.mocked(...)` at each call site
// is what makes this a "typed" spy (AC-CP-5(c)'s own requirement): a future signature change on the wrapped
// function breaks this file's `.mock.calls[...]` accesses at COMPILE time, never silently.

vi.mock("../../../src/service/foreign-corpus-write-guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/service/foreign-corpus-write-guard.js")>();
  return { ...actual, checkForeignCorpusWrite: vi.fn(actual.checkForeignCorpusWrite) };
});

const guardSpy = vi.mocked(checkForeignCorpusWrite);

beforeEach(() => {
  guardSpy.mockClear();
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
    const httpStore = actedStore(new InMemoryStore());
    const httpCorpusService = new CorpusService(httpStore, new RecordLockService(httpStore, new GateEnforcer(undefined)));

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
    const controlStore = actedStore(new InMemoryStore());
    const controlCorpusService = new CorpusService(controlStore, new RecordLockService(controlStore, new GateEnforcer(undefined)));

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
    // reason: `inv` is the Invocation the command hands the loader (AS-26); the HTTP surface is still the load-bearing key.
    if (args !== '{surface:"http"}' && args !== '{surface:"http",inv}') calls.push(match[0]);
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
