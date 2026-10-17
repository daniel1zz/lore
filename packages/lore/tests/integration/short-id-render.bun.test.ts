/**
 * @spec_ref task-short-id-rendering-truncates-ulids-to-8-chars-a-1024ms
 *
 * RED-first regression suite for the shared `formatShortId` short-id renderer
 * (`packages/lore/src/adapters/cli/utils.ts`). The task this suite verifies:
 * the OLD rendering (`id.slice(0, 8)`) kept only the ULID's 40-bit high
 * timestamp segment and ZERO bits of randomness, so any two docs created
 * inside the SAME 1024ms window printed a BYTE-IDENTICAL short id across
 * `lore tree`, `lore get`'s navigation block, and `lore link`.
 *
 * Determinism strategy (the load-bearing trick this suite depends on):
 * `ulidx`'s `ulid()` (called with no seed argument by
 * `CorpusService._createImpl`) reads its 48-bit timestamp segment via a bare
 * `Date.now()` call. Freezing the GLOBAL `Date.now` for the duration of two
 * back-to-back, awaited `corpusService.create()` calls forces an IDENTICAL
 * timestamp segment (hence an identical OLD-style 8-char prefix) on both
 * docs, while their independently-drawn 80-bit random segments still differ
 * with overwhelming probability (1 - 2^-80) — this constructs the EXACT
 * same-1024ms-window collision case deterministically, with no reliance on
 * real-wall-clock timing between subprocess spawns (which this repo's other
 * integration tests cannot control, and which would make a same-window
 * collision merely probable, not guaranteed).
 *
 * The two colliding docs are created through the REAL production composition
 * root (`createApp`, the same function `loader.ts` wires for every CLI
 * command) — never a mock — pointed at the SAME `.lore/lore.db` a `lore init`
 * subprocess bootstrapped moments before. The app handle is closed before any
 * subprocess reads that file, so every rendering assertion below runs the
 * ACTUAL CLI (`bun run src/index.ts tree|get|link`) end-to-end — this is
 * "through the surface", not a call to `formatTree`/`formatNavigation`
 * directly (see `cli-utils.test.ts` for the pure-function-level coverage of
 * `formatShortId` and its call sites in `utils.ts`).
 *
 * Never writes to this repo's OWN `.lore/` — every test uses a fresh
 * `mkdtemp` directory + `lore init` (packages/dashboard/tests/e2e/global-
 * setup.ts's canonical pattern), never a server on an assumed port.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/app.js";
import type { CreateDocResult } from "../../src/service/corpus-service.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface SiblingPair {
  readonly docA: CreateDocResult;
  readonly docB: CreateDocResult;
}

// ─── CLI subprocess helper (mirrors cli-check-tree.bun.test.ts's convention) ─

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

/** Run `bun run src/index.ts ...args` in `cwd`. HOME is overridden to isolate global config files. */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "lore-short-id-"));
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Extracts the whitespace-delimited token immediately preceding the first
 * occurrence of `title` in `line` — the short-id token in every one of this
 * task's render sites (`"<short> <title> ..."`, optionally prefixed by a
 * tree connector like `└── `, itself a separate whitespace token).
 */
function extractShortIdBeforeTitle(line: string, title: string): string {
  const idx = line.indexOf(title);
  if (idx === -1) {
    throw new Error(`title ${JSON.stringify(title)} not found in line: ${JSON.stringify(line)}`);
  }
  const before = line.slice(0, idx).trimEnd();
  const tokens = before.split(/\s+/).filter((t) => t.length > 0);
  const last = tokens[tokens.length - 1];
  if (last === undefined) {
    throw new Error(`no short-id token found before title in line: ${JSON.stringify(line)}`);
  }
  return last;
}

/**
 * Builds two sibling `plan` docs (a spec takes no parent, BR-2) under a fresh root PRD, forcing them into
 * the SAME 1024ms ULID timestamp window (see this module's header for the
 * `Date.now()` freeze trick). `content` supplies the minimal `## ` skeleton
 * heading the `spec-create` gate requires (`hasSkeleton`, gate-predicates.ts)
 * — unrelated to the short-id defect, just the gate's own admission floor.
 */
async function createCollidingSiblingPair(dbPath: string, parentId: string): Promise<SiblingPair> {
  const app = createApp(dbPath);
  try {
    const originalDateNow = Date.now;
    // Arbitrary fixed epoch ms — only needs to be a valid, stable timestamp;
    // its specific value is irrelevant to the test.
    const FIXED_TS = 1_700_000_000_000;
    let resultA: Awaited<ReturnType<typeof app.corpusService.create>>;
    let resultB: Awaited<ReturnType<typeof app.corpusService.create>>;
    try {
      Date.now = () => FIXED_TS;
      resultA = await app.corpusService.create({
        type: "plan",
        title: "Doc Alpha",
        parent_id: parentId,
        content: "## Overview\nDoc Alpha body.",
      });
      resultB = await app.corpusService.create({
        type: "plan",
        title: "Doc Bravo",
        parent_id: parentId,
        content: "## Overview\nDoc Bravo body.",
      });
    } finally {
      Date.now = originalDateNow;
    }

    if (!resultA.ok) {
      throw new Error(`create docA failed: ${JSON.stringify(resultA.error)}`);
    }
    if (!resultB.ok) {
      throw new Error(`create docB failed: ${JSON.stringify(resultB.error)}`);
    }
    const docA = resultA.value;
    const docB = resultB.value;

    // Fixture invariant: both docs land in the OLD bug's EXACT collision
    // window (identical first 8 chars) — proves this fixture exercises the
    // real defect, not some unrelated difference. A failure here means the
    // Date.now() freeze did not take effect, not that the short-id fix is
    // broken — surfaced loudly rather than producing a misleading result
    // downstream.
    if (docA.id.slice(0, 8) !== docB.id.slice(0, 8)) {
      throw new Error(
        `fixture invariant violated: ids do not share the OLD-bug's 8-char timestamp ` +
          `prefix — ${docA.id} vs ${docB.id} (Date.now mock did not take effect)`,
      );
    }
    if (docA.id === docB.id) {
      throw new Error("fixture invariant violated: ids are fully identical (impossible ulid collision)");
    }

    return { docA, docB };
  } finally {
    app.close();
  }
}

// ─── Fixture: two docs, same 1024ms window, three render surfaces ─────────

describe("short-id rendering: same-1024ms-window collision fixture across CLI surfaces", () => {
  let tmpDir: string;
  let parentSlug: string;
  let pair: SiblingPair;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    const initR = runLore(["init"], tmpDir);
    if (initR.exitCode !== 0) {
      throw new Error(`lore init failed: ${initR.stderr}`);
    }

    const prdR = runLore(["create", "prd", "--title", "Root Prd", "--no-ai"], tmpDir);
    if (prdR.exitCode !== 0) {
      throw new Error(`lore create prd failed: ${prdR.stderr}`);
    }
    const slugMatch = /Slug:\s+(\S+)/.exec(prdR.stdout);
    if (!slugMatch?.[1]) {
      throw new Error(`could not parse PRD slug from create output: ${prdR.stdout}`);
    }
    parentSlug = slugMatch[1];

    const dbPath = join(tmpDir, ".lore", "lore.db");
    const app = createApp(dbPath);
    const parentResolve = await app.corpusService.resolve(parentSlug);
    app.close();
    if (!parentResolve.ok) {
      throw new Error(`could not resolve parent PRD: ${JSON.stringify(parentResolve.error)}`);
    }

    pair = await createCollidingSiblingPair(dbPath, parentResolve.value);
  });

  afterEach(() => cleanupDir(tmpDir));

  it("PRE-CONDITION: the two docs share the OLD bug's exact 8-char collision prefix, and are otherwise distinct", () => {
    expect(pair.docA.id.slice(0, 8)).toBe(pair.docB.id.slice(0, 8));
    expect(pair.docA.id).not.toBe(pair.docB.id);
  });

  // ─── AC1 NEGATIVE (load-bearing) — three surfaces ─────────────────────────

  it("AC1 NEGATIVE — `lore tree`: the two docs' printed short ids DIFFER", () => {
    const result = runLore(["tree", parentSlug], tmpDir);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split("\n");
    const lineA = lines.find((l) => l.includes(pair.docA.title));
    const lineB = lines.find((l) => l.includes(pair.docB.title));
    expect(lineA).toBeDefined();
    expect(lineB).toBeDefined();
    const shortA = extractShortIdBeforeTitle(lineA as string, pair.docA.title);
    const shortB = extractShortIdBeforeTitle(lineB as string, pair.docB.title);
    expect(shortA).not.toBe(shortB);
  });

  it("AC1 NEGATIVE — `lore get` navigation block: docA's own header id and docB's sibling-rendered id DIFFER", () => {
    const result = runLore(["get", pair.docA.slug], tmpDir);
    expect(result.exitCode).toBe(0);
    const headerMatch = /^── (\S+) /.exec(result.stdout);
    expect(headerMatch).not.toBeNull();
    const headerShort = (headerMatch as RegExpExecArray)[1] as string;

    const siblingLine = result.stdout.split("\n").find((l) => l.startsWith("Siblings:"));
    expect(siblingLine).toBeDefined();
    expect(siblingLine).toContain(pair.docB.title);
    const siblingShort = extractShortIdBeforeTitle(siblingLine as string, pair.docB.title);

    expect(headerShort).not.toBe(siblingShort);
  });

  it("AC1 NEGATIVE — `lore link`: both operands of the SAME printed line render DIFFERENT short ids", () => {
    const result = runLore(["link", pair.docA.slug, pair.docB.slug, "--type", "relates-to"], tmpDir);
    expect(result.exitCode).toBe(0);
    const match = /^Linked (\S+) → (\S+) /.exec(result.stdout);
    expect(match).not.toBeNull();
    const [, fromShort, toShort] = match as RegExpExecArray;
    expect(fromShort).not.toBe(toShort);
  });

  // ─── AC2 HAPPY — a single doc renders a well-formed short id (get.ts / link.ts sites) ──
  // (utils.ts's six sites — tree x2, navigation Parent/Siblings/Children/Related — are
  // covered at the pure-function level in cli-utils.test.ts's formatShortId/formatTree/
  // formatNavigation describe blocks; these two assert the command-file sites this
  // integration suite can reach that those unit tests cannot: get.ts's header line and
  // link.ts's two operands, both of which require a full CLI + real corpus round trip.)

  it("AC2 HAPPY — `lore get`'s header line renders a well-formed head+tail short id", () => {
    const result = runLore(["get", pair.docA.slug], tmpDir);
    expect(result.exitCode).toBe(0);
    const headerMatch = /^── (\S+) /.exec(result.stdout);
    expect(headerMatch).not.toBeNull();
    expect((headerMatch as RegExpExecArray)[1]).toMatch(/^.{8}….{5}$/);
  });

  it("AC2 HAPPY — `lore link`'s two operands each render a well-formed head+tail short id", () => {
    const result = runLore(["link", pair.docA.slug, pair.docB.slug, "--type", "relates-to"], tmpDir);
    expect(result.exitCode).toBe(0);
    const match = /^Linked (\S+) → (\S+) /.exec(result.stdout);
    expect(match).not.toBeNull();
    const [, fromShort, toShort] = match as RegExpExecArray;
    expect(fromShort).toMatch(/^.{8}….{5}$/);
    expect(toShort).toMatch(/^.{8}….{5}$/);
  });

  // ─── AC3 REGRESSION — --json stays untruncated on all three surfaces ──────

  it("AC3 REGRESSION — `lore tree --json` carries the FULL untruncated ids", () => {
    const result = runLore(["tree", parentSlug, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(pair.docA.id);
    expect(result.stdout).toContain(pair.docB.id);
  });

  it("AC3 REGRESSION — `lore get --json` carries the FULL untruncated doc id and sibling id", () => {
    const result = runLore(["get", pair.docA.slug, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(pair.docA.id);
    expect(result.stdout).toContain(pair.docB.id); // sibling entry in navigation.siblings
  });

  it("AC3 REGRESSION — `lore link --json` carries the FULL untruncated from_id/to_id", () => {
    const result = runLore(["link", pair.docA.slug, pair.docB.slug, "--type", "relates-to", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout) as {
      ok: boolean;
      data: { from_id: string; to_id: string };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.from_id).toBe(pair.docA.id);
    expect(envelope.data.to_id).toBe(pair.docB.id);
  });
});

// ─── AC5 BOUNDARY — malformed/legacy short ids never throw, at the CLI's own surfaces ──
//
// The pure-function boundary matrix (empty string, 6/13/14-char ids, never-throws sweep)
// lives in cli-utils.test.ts's `formatShortId` describe block — this is deliberately NOT
// re-derived here. `formatShortId` is a pure function with no store/IO dependency, so a
// malformed-id CLI-level fixture would only re-prove the same function under more setup
// cost, not exercise any additional code path.
