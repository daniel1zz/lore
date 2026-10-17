// @reads assets/**
// @reads packages/**
// @reads scripts/**
/**
 * `feedback.upstream.vendor` — the vendor-intake consent branch (2026-08-25).
 *
 * What this file locks in: `lore report-issue`'s upstream ADDRESS is a constant
 * that ships inside the binary (`@lore/core`'s `VENDOR_INTAKE_REPO`), and the
 * only thing left in a consumer's `.lore/config.yaml` is CONSENT
 * (`feedback.upstream.vendor: true`). Before this split, every consumer
 * hand-copied the address, and a typo filed that project's defect reports into
 * a stranger's repository.
 *
 * Runner: vitest. `report-issue-wiring.ts` and its transitive imports contain
 * no `bun:sqlite` (the precedent this follows is
 * `tests/unit/service/github-filing-split-write.test.ts`, which already imports
 * this same module under vitest).
 *
 * ⛔ A vitest run alone NEVER proves `VENDOR_INTAKE_REPO` is EXPORTED — esbuild
 * does not check named exports across modules, so importing a name a module
 * does not export stays green unless the test READS it (standing lesson,
 * `knowledge-under-vitest-importing-a-name-a-module-does-not`). Every
 * assertion below that touches the constant therefore reads its VALUE, and the
 * paired `bun run typecheck` (TS2459/TS2305) is recorded as its own oracle.
 *
 * Six-dimension coverage:
 *   HAPPY:      `{vendor: true}` parses; the classifier normalizes it to the
 *               GitHub shape carrying `VENDOR_INTAKE_REPO`.
 *   NEGATIVE:   `{vendor: false}` and `{vendor: true, repo}` both fail to parse.
 *   BOUNDARY:   "not GitHub" is not "legacy" — a vendor config has no `repo`
 *               key, so `isGithubUpstreamCfg` answers `false` for it, and the
 *               classifier must still not reach the retired branch. Deleting
 *               the vendor branch from `classifyFeedbackUpstream` is the
 *               measured one-line mutation that reddens this file.
 *   ERROR:      `{vendor: false}`'s `LoreError` names `feedback.upstream.vendor`.
 *   STATE:      parsing a vendor config emits NO retired-transport-key warning
 *               (the legacy branch's `superRefine` must not fire for it).
 *   REGRESSION: `{repo}` / `{root_prd}` / absent all behave exactly as before;
 *               the unconfigured remedy still names the self-hosted path and
 *               keeps its three pinned disclosure substrings; the address has
 *               exactly ONE definition site repo-wide.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { LoreConfigSchema, VENDOR_INTAKE_REPO, buildUnconfiguredUpstreamRemedy, parseConfig } from "@lore/core";
import type { LoreConfig } from "@lore/core";
import {
  classifyFeedbackUpstream,
  isGithubUpstreamCfg,
  isVendorUpstreamCfg,
  type UpstreamCfg,
} from "../../../src/adapters/cli/report-issue-wiring.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Minimal valid top-level config — `project` is the only required section. */
function baseConfig(): Record<string, unknown> {
  return { project: { name: "vendor-probe", author: "owner" } };
}

/** Raw config carrying the given `feedback.upstream` value, for `parseConfig`. */
function rawWithUpstream(upstream: Record<string, unknown>): Record<string, unknown> {
  return { ...baseConfig(), feedback: { upstream } };
}

/**
 * A parsed `LoreConfig` built through the REAL schema (never a hand-typed
 * literal that could drift from `FeedbackConfigSchema`'s shape) — `undefined`
 * omits the `feedback` section entirely, which is the "unconfigured" case.
 */
function makeConfig(upstream?: Record<string, unknown>): LoreConfig {
  return LoreConfigSchema.parse(
    upstream === undefined ? baseConfig() : rawWithUpstream(upstream),
  ) as LoreConfig;
}

/** Flattens every `console.warn` call made during a test into one searchable string. */
function warnedText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => call.join(" ")).join("\n");
}

// ─── AC1: one definition site for the address ──────────────────────────────

describe("VENDOR_INTAKE_REPO — the address ships in the binary (AC1)", () => {
  it("HAPPY: reads as a non-empty owner/repo string through the @lore/core barrel", () => {
    // Reads the VALUE (not merely imports the name) — see this file's header on
    // why an import alone proves nothing under vitest.
    expect(typeof VENDOR_INTAKE_REPO).toBe("string");
    expect(VENDOR_INTAKE_REPO.length).toBeGreaterThan(0);
    expect(VENDOR_INTAKE_REPO).toMatch(/^[^/\s]+\/[^/\s]+$/);
  });

  it("REGRESSION: the quoted literal occurs EXACTLY once under packages/, scripts/ and assets/", () => {
    // Needle is DERIVED from the imported constant, so this test file itself
    // holds no copy of the literal and cannot inflate its own count.
    const needle = Buffer.from(JSON.stringify(VENDOR_INTAKE_REPO), "utf8");
    const root = findRepoRoot(__dirname);
    const hits: string[] = [];
    for (const scanRoot of ["packages", "scripts", "assets"]) {
      for (const file of walkFiles(join(root, scanRoot))) {
        // ⛔ Byte search over the raw Buffer, never a decoded-string `grep`
        // equivalent: BSD grep goes SILENT on a file containing one raw NUL and
        // exits 1, which is byte-identical to "absent"
        // (`knowledge-a-correction-asserting-an-oracle-s-strength-is-itself`).
        if (readFileSync(file).includes(needle)) hits.push(relative(root, file));
      }
    }
    expect(hits).toEqual(["packages/core/src/issue-report.ts"]);
  });
});

// ─── AC2: the schema accepts consent only ──────────────────────────────────

describe("FeedbackConfigSchema.upstream — the vendor-consent branch (AC2)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("HAPPY: {vendor: true} parses and round-trips the flag", () => {
    const result = parseConfig(rawWithUpstream({ vendor: true }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feedback?.upstream).toEqual({ vendor: true });
  });

  it("STATE: parsing {vendor: true} emits NO retired-transport-key warning", () => {
    // The legacy branch carries a side-effecting `.superRefine`
    // (`warnRetiredUpstreamTransportKey`). A vendor config must not trip it —
    // the legacy object parse fails first (missing `root_prd`, unrecognized
    // `vendor`), so the refinement never runs. Asserted rather than assumed,
    // because union branch ORDER is what makes it true.
    const result = parseConfig(rawWithUpstream({ vendor: true }));

    expect(result.ok).toBe(true);
    const warned = warnedText(warnSpy);
    expect(warned).not.toContain("retired");
    expect(warned).not.toContain("corpus_path");
    expect(warned).not.toContain("transport");
  });

  it("NEGATIVE/ERROR: {vendor: false} FAILS to parse and the error names feedback.upstream.vendor", () => {
    // `z.literal(true)`, deliberately not `z.boolean()`: a parsing `false`
    // would be a silent no-op — the author believes something is configured
    // while `lore report-issue` still refuses as "unconfigured".
    const result = parseConfig(rawWithUpstream({ vendor: false }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    // Narrowing guard only — the assertion above already fails the test for any
    // other code, so this `if` is always entered on a passing run.
    if (result.error.code === "VALIDATION_ERROR") {
      expect(result.error.field).toBe("feedback.upstream.vendor");
    } else {
      throw new Error(`expected VALIDATION_ERROR, got ${result.error.code}`);
    }
  });

  it("NEGATIVE: {vendor: true, repo} FAILS to parse — the two intents must not be mixed", () => {
    // Each union branch is `.strict()`, so a config naming both an intent and
    // an address matches no branch. The reported field names only ONE of the
    // two keys (the same one-sidedness the pre-existing `repo`+`root_prd` mix
    // already had), so this pins the REFUSAL and the field's prefix, not a
    // wording that would make the assertion misleading.
    const result = parseConfig(rawWithUpstream({ vendor: true, repo: "acme/widget" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code === "VALIDATION_ERROR") {
      expect(result.error.field.startsWith("feedback.upstream")).toBe(true);
    }
  });

  it("REGRESSION: the self-hosted {repo} shape still parses unchanged", () => {
    const result = parseConfig(rawWithUpstream({ repo: "acme/widget" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.feedback?.upstream).toEqual({ repo: "acme/widget" });
  });

  it("REGRESSION: the legacy {root_prd} shape still parses, and a retired key still warns BY NAME", () => {
    const result = parseConfig(
      rawWithUpstream({ root_prd: "prd-upstream-root", corpus_path: "/abs/path/to/upstream" }),
    );

    expect(result.ok).toBe(true);
    expect(warnedText(warnSpy)).toContain("corpus_path");
  });
});

// ─── AC3: the ONE production read path normalizes vendor onto {repo} ───────

describe("classifyFeedbackUpstream — vendor normalization (AC3)", () => {
  it("HAPPY: {vendor: true} classifies as the GitHub shape carrying VENDOR_INTAKE_REPO", () => {
    const classification = classifyFeedbackUpstream(makeConfig({ vendor: true }));

    expect(classification).toEqual({ kind: "github", cfg: { repo: VENDOR_INTAKE_REPO } });
  });

  it("BOUNDARY: a vendor config answers FALSE to isGithubUpstreamCfg, yet must NOT reach the retired branch", () => {
    // `isGithubUpstreamCfg` is `"repo" in cfg`, and a vendor config has no
    // `repo` — so "not GitHub" must NOT be read as "legacy". A chain written as
    // `if (github) {...} else {retired}` tells the caller its valid config is
    // "the retired SQLite shape"; that is the shape the MCP handler had.
    //
    // MEASURED minimal mutation for this file: DELETE the
    // `isVendorUpstreamCfg` branch from `classifyFeedbackUpstream` — this
    // assertion and the HAPPY one above both go red with `kind: "retired"`.
    // ⛔ NOT the guards' order: swapping the two `if`s inside that function
    // leaves all 18 assertions green (measured), because `retired` is a
    // fall-through at the end rather than an `else`.
    const cfg = makeConfig({ vendor: true }).feedback?.upstream;
    expect(cfg).toBeDefined();
    if (cfg === undefined) return;

    expect(isGithubUpstreamCfg(cfg as UpstreamCfg)).toBe(false);
    expect(isVendorUpstreamCfg(cfg as UpstreamCfg)).toBe(true);
    expect(classifyFeedbackUpstream(makeConfig({ vendor: true })).kind).not.toBe("retired");
  });

  it("BOUNDARY: the two guards are mutually exclusive across all three shapes", () => {
    const shapes: readonly UpstreamCfg[] = [
      { vendor: true } as UpstreamCfg,
      { repo: "acme/widget" } as UpstreamCfg,
      { root_prd: "prd-legacy" } as UpstreamCfg,
    ];
    for (const shape of shapes) {
      expect(isVendorUpstreamCfg(shape) && isGithubUpstreamCfg(shape)).toBe(false);
    }
  });

  it("REGRESSION: {repo} still classifies as github with the configured repo carried verbatim", () => {
    const classification = classifyFeedbackUpstream(makeConfig({ repo: "acme/widget" }));

    expect(classification.kind).toBe("github");
    if (classification.kind !== "github") return;
    expect(classification.cfg.repo).toBe("acme/widget");
    // Not silently redirected to the vendor intake — the whole point of keeping
    // a self-hosted branch.
    expect(classification.cfg.repo).not.toBe(VENDOR_INTAKE_REPO);
  });

  it("REGRESSION: the legacy {root_prd} shape is still refused as retired", () => {
    const classification = classifyFeedbackUpstream(makeConfig({ root_prd: "prd-legacy-target" }));

    expect(classification.kind).toBe("retired");
    if (classification.kind !== "retired") return;
    expect(classification.error.code).toBe("VALIDATION_ERROR");
    expect("message" in classification.error ? classification.error.message : "").toContain(
      "retired SQLite shape",
    );
  });

  it("REGRESSION: an absent feedback.upstream is still 'unconfigured', never the vendor intake", () => {
    // ⛔ The load-bearing negative: consent must never be inferred. If an absent
    // section ever defaulted to the vendor branch, this project's report bodies
    // would start reaching a third-party GitHub with nobody having agreed.
    expect(classifyFeedbackUpstream(makeConfig()).kind).toBe("unconfigured");
    expect(classifyFeedbackUpstream(undefined).kind).toBe("unconfigured");
  });
});

// ─── AC4: the unconfigured remedy names BOTH paths ─────────────────────────

describe("buildUnconfiguredUpstreamRemedy — two paths, one message (AC4)", () => {
  function remedyMessage(): string {
    const remedy = buildUnconfiguredUpstreamRemedy();
    return "message" in remedy ? remedy.message : "";
  }

  it("HAPPY: names feedback.upstream.vendor AND feedback.upstream.repo", () => {
    const message = remedyMessage();
    expect(message).toContain("feedback.upstream.vendor");
    expect(message).toContain("feedback.upstream.repo");
  });

  it("HAPPY: says which is which — vendor is the lore project's intake, repo is self-hosted", () => {
    const message = remedyMessage();
    const vendorAt = message.indexOf("feedback.upstream.vendor");
    const repoAt = message.indexOf("feedback.upstream.repo");
    expect(vendorAt).toBeGreaterThanOrEqual(0);
    expect(repoAt).toBeGreaterThan(vendorAt);
    // The vendor clause must explain that the address is NOT typed by the
    // reader (otherwise "vendor: true" reads as an incomplete instruction).
    expect(message.slice(vendorAt, repoAt)).toContain("ships inside this binary");
    expect(message.slice(repoAt)).toContain("host yourself");
  });

  it("REGRESSION: keeps the three pinned disclosure substrings (AC-GD-2(b))", () => {
    const message = remedyMessage();
    expect(message).toContain(".lore/config.yaml");
    expect(message).toContain("git-tracked");
    expect(message).toContain("shared");
  });

  it("REGRESSION: still a VALIDATION_ERROR on field feedback.upstream", () => {
    const remedy = buildUnconfiguredUpstreamRemedy();
    expect(remedy.code).toBe("VALIDATION_ERROR");
    expect("field" in remedy ? remedy.field : "").toBe("feedback.upstream");
  });
});

// ─── scan helpers ──────────────────────────────────────────────────────────

/** Walks up until a directory holds BOTH scan roots, never a hardcoded level count. */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "packages", "core", "src")) && existsSync(join(dir, "scripts"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`vendor-intake scan: could not locate repo root walking up from ${startDir}`);
    }
    dir = parent;
  }
}

/** Directory names never scanned — build output and dependencies, never sources. */
const SKIPPED_DIRS = new Set(["node_modules", "dist", "dist-npm", "coverage", ".git", ".turbo", "build"]);

/** Every regular file under `root` (recursive), skipping {@link SKIPPED_DIRS}. Absent root → nothing. */
function* walkFiles(root: string): Generator<string> {
  if (!existsSync(root)) return;
  if (!statSync(root).isDirectory()) {
    yield root;
    return;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      yield* walkFiles(join(root, entry.name));
    } else if (entry.isFile()) {
      yield join(root, entry.name);
    }
  }
}
