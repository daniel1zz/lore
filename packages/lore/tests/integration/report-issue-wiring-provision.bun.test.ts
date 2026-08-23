/**
 * @spec_ref spec-out-of-box-reporting-channel-report-issue-self-provisions
 *   AC-OOB-2..5 (implementation-level coverage)
 *
 * Direct, in-process unit/integration coverage for the two new
 * `report-issue-wiring.ts` exports task-t3-core-upstream-resolver-config-writer
 * adds: `resolveUpstreamFromInstalledBinary` (+ its pure helpers
 * `deriveInstalledBinaryDir`/`walkUpForLoreDbRoot`) and
 * `provisionFeedbackUpstream`.
 *
 * ── Why this file exists alongside tests/integration/report-issue-provision.bun.test.ts ──
 * That RED suite (task-t1) drives these functions ONLY through the compiled
 * `dist/lore` CLI binary's `--auto-config` flag — which does not exist yet:
 * wiring `--auto-config` into `commands/report-issue.ts`'s `args` is a
 * SEPARATE, downstream task (T4) this task's file anchors explicitly exclude.
 * Verified empirically before writing this file: spawning `dist/lore
 * report-issue --auto-config ...` today exits 2 ("Unknown option:
 * --auto-config") via `strict-flags.ts`'s unconditional unknown-flag guard —
 * BEFORE any of this module's new code ever runs. So AC-OOB-2..5 cannot
 * reach exit-0/exit-4 through that CLI oracle until T4 lands, regardless of
 * this task's own correctness. This file is the oracle THIS task's file
 * anchors CAN close: every branch of `resolveUpstreamFromInstalledBinary`/
 * `provisionFeedbackUpstream`, invoked DIRECTLY (no subprocess spawn), so
 * T4 has a verified-correct pair of functions to wire in.
 *
 * ── Never touches the repo's own .lore/ corpus ──
 * Every fixture is a THROWAWAY `mkdtempSync` directory under `os.tmpdir()`
 * (root CLAUDE.md's hard rule; 2026-07-07 dashboard e2e pollution incident).
 *
 * ── Why real SQLiteStore/CorpusService instead of a subprocess ──
 * `resolveUpstreamFromInstalledBinary` transitively needs `bun:sqlite`
 * (via `buildUpstreamContext`), so this file is `.bun.test.ts` (not
 * vitest). Constructing `SQLiteStore` + `CorpusService` directly in-process
 * to seed candidate corpora is faster and more precise than spawning
 * `lore init`/`lore create` as child processes, and needs no compiled
 * `dist/lore` binary at all (this file has no `beforeAll` build step).
 *
 * Six-dimension coverage across the suite:
 *   HAPPY:      matching-identity candidate accepted; fresh config write;
 *               dev-mode / no-symlink compiled-mode dir derivation
 *   NEGATIVE:   idempotent no-op on an already-configured consumer
 *   BOUNDARY:   3-hop symlink chain (mirrors AC-OOB-2's own boundary case);
 *               .lore/lore.db found directly AT the start dir
 *   ERROR:      wrong-identity candidate, no-root-PRD candidate, unresolvable
 *               (.lore/lore.db not found), malformed YAML, invalid candidate,
 *               missing config file, broken symlink target (realpath failure)
 *   STATE:      byte-identical config on every rejection path; pre-existing
 *               top-level AND nested keys survive a successful write; two
 *               consecutive resolutions against the same corpus both succeed
 *               (proves the first call's db connection was actually closed)
 *   REGRESSION: written feedback.upstream round-trips clean through
 *               FeedbackConfigSchema
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import yaml from "yaml";
import { FeedbackConfigSchema } from "@lore/core";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import {
  deriveInstalledBinaryDir,
  provisionFeedbackUpstream,
  resolveUpstreamFromInstalledBinary,
  walkUpForLoreDbRoot,
  type InstalledBinaryContext,
} from "../../src/adapters/cli/report-issue-wiring.js";

// ─── Fixture root ────────────────────────────────────────────────────────────

const TMP_ROOT = tmpdir();

function assertUnderTmp(path: string): void {
  if (!path.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to use a fixture path outside ${TMP_ROOT}: ${path}`);
  }
}

const LORE_PROJECT_ROOT_PRD_TITLE = "Lore — Internal-First AI Team Knowledge Platform";
const LORE_PROJECT_ROOT_PRD_SLUG = "prd-lore-internal-first-ai-team-knowledge-platform";

const cleanup: string[] = [];
function track(...paths: string[]): void {
  cleanup.push(...paths);
}

afterEach(() => {
  while (cleanup.length > 0) {
    const path = cleanup.pop();
    if (path === undefined) continue;
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup only.
    }
  }
});

/** Seeds `<root>/.lore/lore.db` and, optionally, a root PRD of the given title, in-process (no `lore init`/`lore create` subprocess). */
async function seedCorpusAsync(
  prefix: string,
  rootPrdTitle?: string,
): Promise<{ root: string; rootPrdSlug?: string; rootPrdId?: string }> {
  const root = mkdtempSync(join(TMP_ROOT, `wiring-corpus-${prefix}-`));
  assertUnderTmp(root);
  mkdirSync(join(root, ".lore"), { recursive: true });
  const store = new SQLiteStore(join(root, ".lore", "lore.db"));
  let rootPrdSlug: string | undefined;
  let rootPrdId: string | undefined;
  if (rootPrdTitle !== undefined) {
    const corpusService = new CorpusService(store);
    const result = await corpusService.create({ type: "prd", title: rootPrdTitle, content: "root prd content" });
    if (!result.ok) throw new Error(`seedCorpusAsync: root PRD creation failed: ${JSON.stringify(result.error)}`);
    rootPrdSlug = result.value.slug;
    rootPrdId = result.value.id;
  }
  store.close();
  return {
    root,
    ...(rootPrdSlug !== undefined ? { rootPrdSlug } : {}),
    ...(rootPrdId !== undefined ? { rootPrdId } : {}),
  };
}

/** Fresh `.lore/config.yaml` consumer fixture — hand-written (mirrors what `lore init` produces), no CLI spawn. */
function seedConsumerConfig(prefix: string, extraYamlLines: string[] = []): string {
  const root = mkdtempSync(join(TMP_ROOT, `wiring-consumer-${prefix}-`));
  assertUnderTmp(root);
  mkdirSync(join(root, ".lore"), { recursive: true });
  const lines = ["project:", "  name: test-project", "  author: test-author", ...extraYamlLines];
  writeFileSync(join(root, ".lore", "config.yaml"), lines.join("\n") + "\n", "utf8");
  return root;
}

function configPath(root: string): string {
  return join(root, ".lore", "config.yaml");
}

// ─── deriveInstalledBinaryDir (pure) ──────────────────────────────────────────

describe("deriveInstalledBinaryDir", () => {
  it("HAPPY dev mode: returns dirname(bunMain) directly, ignoring execPath entirely", () => {
    const ctx: InstalledBinaryContext = { isCompiled: false, execPath: "/should/be/ignored", bunMain: "/repo/packages/lore/src/index.ts" };
    expect(deriveInstalledBinaryDir(ctx)).toBe("/repo/packages/lore/src");
  });

  it("HAPPY compiled mode, no symlink: returns dirname(realpath(execPath)) === dirname(execPath)", () => {
    const dir = mkdtempSync(join(TMP_ROOT, "wiring-derive-plain-"));
    track(dir);
    const binPath = join(dir, "lore");
    writeFileSync(binPath, "#!/bin/sh\necho stub\n", { mode: 0o755 });
    const result = deriveInstalledBinaryDir({ isCompiled: true, execPath: binPath, bunMain: "/unused" });
    // reason: expected value is realpath-resolved too — on macOS `os.tmpdir()`
    // lives under `/var/...`, itself a symlink to `/private/var/...`; this
    // function's OWN realpath resolution correctly follows that OS-level
    // symlink too (not just user-created ones), so the fair comparison is
    // against the fully-resolved expected path, not the raw mkdtemp string.
    expect(result).toBe(realpathSync(dir));
  });

  it("BOUNDARY compiled mode, 3-hop symlink chain: resolves through every hop to the REAL target's directory", () => {
    const realDir = mkdtempSync(join(TMP_ROOT, "wiring-derive-real-"));
    track(realDir);
    const realBin = join(realDir, "lore");
    writeFileSync(realBin, "#!/bin/sh\necho stub\n", { mode: 0o755 });

    const hopDir = mkdtempSync(join(TMP_ROOT, "wiring-derive-hops-"));
    track(hopDir);
    let target = realBin;
    for (let i = 0; i < 3; i++) {
      const hopPath = join(hopDir, `hop-${i}`);
      symlinkSync(target, hopPath);
      target = hopPath;
    }

    const result = deriveInstalledBinaryDir({ isCompiled: true, execPath: target, bunMain: "/unused" });
    // reason: see the "no symlink" test above for why the expected value is
    // realpath-resolved (macOS `/var` → `/private/var`).
    expect(result).toBe(realpathSync(realDir));
  });

  it("ERROR compiled mode, execPath does not exist: realpath fails, falls back to dirname(execPath) unchanged — never throws", () => {
    const nonexistent = join(TMP_ROOT, "wiring-derive-does-not-exist", "lore");
    expect(() => deriveInstalledBinaryDir({ isCompiled: true, execPath: nonexistent, bunMain: "/unused" })).not.toThrow();
    const result = deriveInstalledBinaryDir({ isCompiled: true, execPath: nonexistent, bunMain: "/unused" });
    expect(result).toBe(dirname(nonexistent));
  });
});

// ─── walkUpForLoreDbRoot (pure-ish, reads fs) ─────────────────────────────────

describe("walkUpForLoreDbRoot", () => {
  it("HAPPY: .lore/lore.db exists directly at startDir — returns startDir itself (BOUNDARY: zero-hop walk)", () => {
    const root = mkdtempSync(join(TMP_ROOT, "wiring-walk-direct-"));
    track(root);
    mkdirSync(join(root, ".lore"), { recursive: true });
    writeFileSync(join(root, ".lore", "lore.db"), "");
    expect(walkUpForLoreDbRoot(root)).toBe(root);
  });

  it("HAPPY: .lore/lore.db exists two levels up — walk ascends and finds it", () => {
    const root = mkdtempSync(join(TMP_ROOT, "wiring-walk-up-"));
    track(root);
    mkdirSync(join(root, ".lore"), { recursive: true });
    writeFileSync(join(root, ".lore", "lore.db"), "");
    const nested = join(root, "dist", "sub");
    mkdirSync(nested, { recursive: true });
    expect(walkUpForLoreDbRoot(nested)).toBe(root);
  });

  it("NEGATIVE: no .lore/lore.db anywhere up the chain — returns undefined at filesystem root", () => {
    // reason: mirrors task-t1's own documented assumption (report-issue-provision.bun.test.ts
    // module header, "Design decision: simulating 'installed binary' resolution") — OS
    // tmpdir and its ancestors carry no .lore/lore.db on any platform this suite runs on.
    const root = mkdtempSync(join(TMP_ROOT, "wiring-walk-none-"));
    track(root);
    expect(walkUpForLoreDbRoot(root)).toBeUndefined();
  });
});

// ─── resolveUpstreamFromInstalledBinary ───────────────────────────────────────

describe("resolveUpstreamFromInstalledBinary", () => {
  it("HAPPY: matching root-PRD identity — accepted, root_prd echoes the candidate's OWN slug", async () => {
    const { root, rootPrdSlug } = await seedCorpusAsync("match", LORE_PROJECT_ROOT_PRD_TITLE);
    track(root);
    expect(rootPrdSlug).toBe(LORE_PROJECT_ROOT_PRD_SLUG);

    const binDir = join(root, "dist");
    mkdirSync(binDir, { recursive: true });
    const binPath = join(binDir, "lore");
    writeFileSync(binPath, "stub");

    const result = await resolveUpstreamFromInstalledBinary({ isCompiled: true, execPath: binPath, bunMain: "/unused" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // reason: realpath-resolved expected value — see deriveInstalledBinaryDir's own tests.
      expect(result.value.corpus_path).toBe(realpathSync(root));
      expect(result.value.root_prd).toBe(rootPrdSlug as string);
    }
  });

  it("BOUNDARY: 3-hop symlink chain to the binary — still resolves the correct corpus_path", async () => {
    const { root } = await seedCorpusAsync("match-multihop", LORE_PROJECT_ROOT_PRD_TITLE);
    track(root);

    const binDir = join(root, "dist");
    mkdirSync(binDir, { recursive: true });
    const realBin = join(binDir, "lore");
    writeFileSync(realBin, "stub");

    const hopDir = mkdtempSync(join(TMP_ROOT, "wiring-resolve-hops-"));
    track(hopDir);
    let target = realBin;
    for (let i = 0; i < 3; i++) {
      const hopPath = join(hopDir, `hop-${i}`);
      symlinkSync(target, hopPath);
      target = hopPath;
    }

    const result = await resolveUpstreamFromInstalledBinary({ isCompiled: true, execPath: target, bunMain: "/unused" });
    expect(result.ok).toBe(true);
    // reason: realpath-resolved expected value — see deriveInstalledBinaryDir's own tests.
    if (result.ok) expect(result.value.corpus_path).toBe(realpathSync(root));
  });

  it("ERROR: wrong root-PRD identity — rejected, message names the found (wrong) slug", async () => {
    const { root, rootPrdSlug } = await seedCorpusAsync("mismatch", "Definitely Not The Lore Project");
    track(root);
    expect(rootPrdSlug).not.toBe(LORE_PROJECT_ROOT_PRD_SLUG);

    const binDir = join(root, "dist");
    mkdirSync(binDir, { recursive: true });
    const binPath = join(binDir, "lore");
    writeFileSync(binPath, "stub");

    const result = await resolveUpstreamFromInstalledBinary({ isCompiled: true, execPath: binPath, bunMain: "/unused" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { message: string }).message).toContain(rootPrdSlug as string);
    }
  });

  it("ERROR: candidate corpus has NO root PRD at all — rejected, names 'no root PRD'", async () => {
    const { root } = await seedCorpusAsync("no-prd");
    track(root);

    const binDir = join(root, "dist");
    mkdirSync(binDir, { recursive: true });
    const binPath = join(binDir, "lore");
    writeFileSync(binPath, "stub");

    const result = await resolveUpstreamFromInstalledBinary({ isCompiled: true, execPath: binPath, bunMain: "/unused" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { message: string }).message.toLowerCase()).toContain("no root prd");
    }
  });

  it("ERROR: no .lore/lore.db reachable at all — rejected, names 'could not resolve'", async () => {
    const isolated = mkdtempSync(join(TMP_ROOT, "wiring-resolve-unresolvable-"));
    track(isolated);
    const binPath = join(isolated, "lore");
    writeFileSync(binPath, "stub");

    const result = await resolveUpstreamFromInstalledBinary({ isCompiled: true, execPath: binPath, bunMain: "/unused" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { message: string }).message.toLowerCase()).toMatch(/could not resolve|resolv/);
    }
  });

  it("STATE/REGRESSION: two consecutive resolutions against the SAME corpus both succeed (proves the first call's db connection was actually closed)", async () => {
    const { root, rootPrdSlug } = await seedCorpusAsync("reuse", LORE_PROJECT_ROOT_PRD_TITLE);
    track(root);
    const binDir = join(root, "dist");
    mkdirSync(binDir, { recursive: true });
    const binPath = join(binDir, "lore");
    writeFileSync(binPath, "stub");

    const first = await resolveUpstreamFromInstalledBinary({ isCompiled: true, execPath: binPath, bunMain: "/unused" });
    const second = await resolveUpstreamFromInstalledBinary({ isCompiled: true, execPath: binPath, bunMain: "/unused" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.root_prd).toBe(rootPrdSlug as string);
      expect(second.value.root_prd).toBe(rootPrdSlug as string);
    }
  });
});

// ─── provisionFeedbackUpstream ────────────────────────────────────────────────

describe("provisionFeedbackUpstream", () => {
  const candidate = { corpus_path: "/upstream/repo", root_prd: LORE_PROJECT_ROOT_PRD_SLUG };

  it("HAPPY: fresh unconfigured consumer — writes feedback.upstream, FeedbackConfigSchema-clean", () => {
    const root = seedConsumerConfig("happy");
    track(root);

    const result = provisionFeedbackUpstream(root, candidate);
    expect(result.ok).toBe(true);

    const parsed = yaml.parse(readFileSync(configPath(root), "utf8"));
    const feedbackParse = FeedbackConfigSchema.safeParse(parsed.feedback);
    expect(feedbackParse.success).toBe(true);
    expect(parsed.feedback.upstream.corpus_path).toBe(candidate.corpus_path);
    expect(parsed.feedback.upstream.root_prd).toBe(candidate.root_prd);
  });

  it("NEGATIVE/idempotent: already-configured feedback.upstream — byte-identical no-op, never overwritten", () => {
    const root = seedConsumerConfig("idempotent", [
      "feedback:",
      "  upstream:",
      "    corpus_path: /already/configured",
      "    root_prd: prd-something-else",
    ]);
    track(root);
    const before = readFileSync(configPath(root));

    const result = provisionFeedbackUpstream(root, candidate);
    expect(result.ok).toBe(true);

    const after = readFileSync(configPath(root));
    expect(after.equals(before)).toBe(true);
  });

  it("STATE: preserves every pre-existing top-level AND nested key on a successful write", () => {
    const root = seedConsumerConfig("preserve", ["workflow:", "  claim_ttl_minutes: 999"]);
    track(root);

    const before = yaml.parse(readFileSync(configPath(root), "utf8"));
    expect(before.project).toBeTruthy();
    expect(before.workflow.claim_ttl_minutes).toBe(999);
    expect(before.feedback).toBeUndefined();

    const result = provisionFeedbackUpstream(root, candidate);
    expect(result.ok).toBe(true);

    const after = yaml.parse(readFileSync(configPath(root), "utf8"));
    expect(after.project).toEqual(before.project);
    expect(after.workflow.claim_ttl_minutes).toBe(999);
    expect(after.feedback.upstream.corpus_path).toBe(candidate.corpus_path);
  });

  it("ERROR: missing config.yaml entirely — STORE_ERROR, no crash", () => {
    const root = mkdtempSync(join(TMP_ROOT, "wiring-provision-missing-"));
    track(root);
    mkdirSync(join(root, ".lore"), { recursive: true });
    // No config.yaml written at all.

    const result = provisionFeedbackUpstream(root, candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STORE_ERROR");
  });

  it("ERROR: malformed YAML — VALIDATION_ERROR, file left byte-identical (zero write)", () => {
    const root = mkdtempSync(join(TMP_ROOT, "wiring-provision-malformed-"));
    track(root);
    mkdirSync(join(root, ".lore"), { recursive: true });
    writeFileSync(configPath(root), "project:\n  name: [unterminated\n", "utf8");
    const before = readFileSync(configPath(root));

    const result = provisionFeedbackUpstream(root, candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = readFileSync(configPath(root));
    expect(after.equals(before)).toBe(true);
  });

  it("ERROR: invalid candidate (empty corpus_path) — VALIDATION_ERROR, file left byte-identical (zero write)", () => {
    const root = seedConsumerConfig("invalid-candidate");
    track(root);
    const before = readFileSync(configPath(root));

    const result = provisionFeedbackUpstream(root, { corpus_path: "", root_prd: LORE_PROJECT_ROOT_PRD_SLUG });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = readFileSync(configPath(root));
    expect(after.equals(before)).toBe(true);
  });

  it("REGRESSION: written feedback.upstream round-trips clean through FeedbackConfigSchema on a second independent read", () => {
    const root = seedConsumerConfig("roundtrip");
    track(root);
    provisionFeedbackUpstream(root, candidate);

    const rereadRaw = readFileSync(configPath(root), "utf8");
    const reparsed = yaml.parse(rereadRaw);
    const parseResult = FeedbackConfigSchema.safeParse(reparsed.feedback);
    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      // reason: `upstream` is now a union of the legacy SQLite shape and the
      // GitHub shape (spec-the-defect-channel-reaches-no-machine-but-its-own-
      // github P2) — `candidate` here is always the legacy shape, so a
      // presence check on `corpus_path` narrows without weakening the assertion.
      const upstream = parseResult.data.upstream;
      expect(upstream !== undefined && "corpus_path" in upstream).toBe(true);
      if (upstream !== undefined && "corpus_path" in upstream) {
        expect(upstream.corpus_path).toBe(candidate.corpus_path);
        expect(upstream.root_prd).toBe(candidate.root_prd);
      }
    }
  });
});
