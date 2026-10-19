// @reads packages/core/src/plan-update.ts
/**
 * @spec_ref SPEC-076 §C3 (five-state classification table) + Downstream
 *   Handoff (`UpdatePlan`/`EmbeddedAssetsManifest`/`FileFreshness` type
 *   contract) — task-skill-test-t3r-planupdate-five-state-red-test-scenarios
 *   (TDD-Role: red, paired with T3
 *   task-skill-implement-t3-planupdate-five-state-pure-classifier),
 *   AC-076-1.
 *
 * RED test file — `packages/core/src/plan-update.ts` and its `planUpdate`
 * export DO NOT EXIST YET. Every test below is expected to fail because the
 * module/export is missing, never because of a bug in the test itself. T3
 * implements against exactly the contract encoded here (per T3's own AC:
 * "RED tests from paired test task define the contract").
 *
 * ── Probe port shape (design decision made HERE, since the paired T3 task's
 * one-line dispatch description — "probe: (path) => {sha256}|'missing'" —
 * under-specifies how `orphaned` (SPEC-076 §C3: "disk has file, manifest has
 * NO entry for it") can ever be discovered. A bare per-path lookup can only
 * answer questions about paths the caller already knows to ask about; it can
 * never surface a genuinely unknown on-disk path. T3's own task text
 * anticipates this ("orphaned detection can scan only manifest-adjacent
 * dirs... if walk cost bites — document if taken"), confirming SOME
 * enumeration capability is expected. This file settles it: `probe` is an
 * injected PORT (object, not a bare function) with two sync members:
 *   - `resolve(path)` — the per-path sha lookup the dispatch described.
 *   - `listManagedPaths()` — sync enumeration of every path currently on
 *     disk under lore-managed directories, POSIX-relative (same shape as
 *     `EmbeddedAssetEntry.path`/`SetupEntry.path`). Used ONLY for orphan
 *     discovery; an empty array is legal and yields `files.orphaned === []`.
 * `planUpdate` itself stays pure/fs-free (I2) — the real enumeration is a
 * service-layer concern (mirrors `FsProbe.listDir` in
 * `service/drift-check-service.ts`, the established injected-port precedent
 * in this codebase for "pure classifier + real fs behind a port").
 *
 * Coverage:
 *   HAPPY:      digest-equal short-circuit → summary "sync", zero probe
 *               calls (adversarially: installed entries data content is
 *               deliberately made "wrong" so the assertion actually proves
 *               the short-circuit is taken, not just coincidentally
 *               matching); a managed `outdated` file lands in `writes`; a
 *               `merged`-ownership `outdated` file lands in `merges`, never
 *               `writes`.
 *   NEGATIVE:   a `diverged` file is excluded from `writes`/`merges`; a
 *               `user_once` file is excluded from `writes` across three
 *               different sha combinations (outdated-like, diverged-like,
 *               missing-like).
 *   BOUNDARY:   a single `missing` entry restores into `writes`; an orphaned
 *               disk file (unknown to both manifests) is reported but never
 *               actioned; a path with no installed-manifest entry at all
 *               whose disk content already equals the embedded sha
 *               classifies as `sync`, never `diverged` (assess follow-up,
 *               2026-07-25); a totally empty/absent installed manifest (fresh
 *               target) classifies every embedded entry as `missing`
 *               (install-equivalent); a legacy installed manifest with NO
 *               `assets_digest` field never short-circuits.
 *   ERROR:      a throwing probe yields `err(...)`, never a partial/ok plan.
 *   STATE:      multiple entries in differing states, classified in ONE
 *               `planUpdate` call, land in mutually exclusive buckets (a
 *               `sync` path appears in NO action bucket at all).
 *   REGRESSION: a near-miss digest (single trailing character differs) must
 *               NOT trip the short-circuit (guards a substring/loose-equality
 *               bug); once `plan-update.ts` exists, it must import no
 *               `node:fs`/`node:child_process`/`bun:*` modules (T3's own AC
 *               line 2 — "test asserts module source or import graph").
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// `planUpdate` — GREEN as of T3, `packages/core/src/plan-update.ts`,
// re-exported from the `@lore/core` barrel per the dispatch contract. The
// `@ts-expect-error` this import carried during the RED phase (T3r) is
// removed here — it is now unused (a compile error under `tsc`'s
// `noUnusedLocals`-adjacent `@ts-expect-error` check), a pure compile-time
// pragma flip with zero effect on any assertion below.
import { planUpdate } from "@lore/core";
import type { SetupManifest, SetupEntry } from "@lore/core";
import type {
  EmbeddedAssetEntry,
  EmbeddedAssetsManifest,
  AssetEntryKind,
} from "../../../src/generated/assets-manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SRC_DIR = join(__dirname, "../../../../core/src");

// ─── Local mirror of the not-yet-created contract types ───────────────────
// These interfaces exist ONLY in this test file — they mirror SPEC-076's
// Downstream Handoff prose exactly and will be superseded by real imports
// from `@lore/core` once `plan-update.ts` lands. Kept intentionally minimal
// (behavioral fields only) so this file never over-specifies implementation
// detail T3 hasn't been handed authority over.

type FileFreshness = "sync" | "outdated" | "diverged" | "missing" | "orphaned" | "retired";

interface ActionEntry {
  path: string;
}

interface UpdatePlan {
  summary: "sync" | "stale";
  files: Record<FileFreshness, string[]>;
  writes: ActionEntry[];
  merges: ActionEntry[];
}

interface UpdateProbe {
  resolve(path: string): { sha256: string } | "missing";
  listManagedPaths(): string[];
}

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: { code: string; [k: string]: unknown } };
type PlanUpdateResult = Ok<UpdatePlan> | Err;

// ─── Fixture builders ───────────────────────────────────────────────────────

function embeddedEntry(overrides: Partial<EmbeddedAssetEntry> = {}): EmbeddedAssetEntry {
  return {
    path: "skills/example/SKILL.md",
    kind: "skill" as AssetEntryKind,
    ownership: "managed",
    sha256: "e".repeat(64),
    ...overrides,
  };
}

function makeEmbedded(entries: EmbeddedAssetEntry[], treeDigest: string): EmbeddedAssetsManifest {
  return {
    binary_version: "0.2.0",
    tree_digest: treeDigest,
    entries,
  };
}

function installedEntry(overrides: Partial<SetupEntry> = {}): SetupEntry {
  return {
    path: "skills/example/SKILL.md",
    kind: "skill",
    sha256: "o".repeat(64),
    written_at: "2026-07-20T00:00:00.000Z",
    ownership: "managed",
    ...overrides,
  };
}

function makeInstalled(entries: SetupEntry[], assetsDigest?: string): SetupManifest {
  return {
    version: "1",
    claude_dir: "/home/user/.claude",
    entries,
    binary_version: "0.1.9",
    installed_at: "2026-07-20T00:00:00.000Z",
    ...(assetsDigest !== undefined ? { assets_digest: assetsDigest } : {}),
  };
}

/** Builds a spied `UpdateProbe` from a per-path sha map (`"missing"` for absent files). */
function makeProbe(
  shas: Record<string, { sha256: string } | "missing">,
  managedPaths: string[] = [],
): UpdateProbe & { resolveSpy: ReturnType<typeof vi.fn>; listSpy: ReturnType<typeof vi.fn> } {
  const resolveSpy = vi.fn((path: string) => shas[path] ?? "missing");
  const listSpy = vi.fn(() => managedPaths);
  return { resolve: resolveSpy, listManagedPaths: listSpy, resolveSpy, listSpy };
}

function hasPath(entries: ActionEntry[], path: string): boolean {
  return entries.some((e) => e.path === path);
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY: digest-equal short-circuit", () => {
  it("returns summary=sync and makes ZERO probe calls when tree digests match, even if entry data would otherwise diverge", () => {
    const path = "skills/example/SKILL.md";
    const embedded = makeEmbedded([embeddedEntry({ path, sha256: "brand-new-sha" })], "digest-match-123");
    // Deliberately WRONG installed entry data (would classify as diverged/
    // outdated if actually compared) — proves the short-circuit is real,
    // not an accident of matching fixture data.
    const installed = makeInstalled([installedEntry({ path, sha256: "totally-different-sha" })], "digest-match-123");
    const probe = makeProbe({ [path]: { sha256: "yet-another-sha" } });

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe("sync");
    expect(probe.resolveSpy).toHaveBeenCalledTimes(0);
    expect(probe.listSpy).toHaveBeenCalledTimes(0);
  });
});

describe("HAPPY: outdated managed file", () => {
  it("disk sha = manifest sha != embedded sha classifies as outdated and lands in writes", () => {
    const path = "hooks/pre-bash-git-safety-gate.mjs";
    const embedded = makeEmbedded([embeddedEntry({ path, kind: "hook", sha256: "new-embedded-sha" })], "digest-A");
    const installed = makeInstalled(
      [installedEntry({ path, kind: "hook", sha256: "old-recorded-sha" })],
      "digest-B",
    );
    const probe = makeProbe({ [path]: { sha256: "old-recorded-sha" } }); // matches manifest, not embedded

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe("stale");
    expect(result.value.files.outdated).toContain(path);
    expect(hasPath(result.value.writes, path)).toBe(true);
  });
});

describe("HAPPY: merged-ownership outdated file", () => {
  it("an outdated merged-ownership file lands in merges, never writes", () => {
    const path = "project/gitignore.template";
    const embedded = makeEmbedded(
      [embeddedEntry({ path, kind: "project" as AssetEntryKind, ownership: "merged", sha256: "new-merge-sha" })],
      "digest-A",
    );
    const installed = makeInstalled(
      [installedEntry({ path, kind: "governance", ownership: "merged", sha256: "old-merge-sha" })],
      "digest-B",
    );
    const probe = makeProbe({ [path]: { sha256: "old-merge-sha" } }); // matches manifest, not embedded => outdated

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.outdated).toContain(path);
    expect(hasPath(result.value.merges, path)).toBe(true);
    expect(hasPath(result.value.writes, path)).toBe(false);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE: diverged file is never actioned", () => {
  it("disk sha != manifest sha (any embedded sha) classifies as diverged and appears in NO write/merge set", () => {
    const path = "hooks/pre-bash-git-safety-gate.mjs";
    const embedded = makeEmbedded([embeddedEntry({ path, kind: "hook", sha256: "whatever-embedded-sha" })], "digest-A");
    const installed = makeInstalled(
      [installedEntry({ path, kind: "hook", sha256: "recorded-sha" })],
      "digest-B",
    );
    const probe = makeProbe({ [path]: { sha256: "user-hand-edited-sha" } }); // != recorded-sha

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.diverged).toContain(path);
    expect(hasPath(result.value.writes, path)).toBe(false);
    expect(hasPath(result.value.merges, path)).toBe(false);
  });
});

describe("NEGATIVE: user_once files are never written or marker-rewritten", () => {
  const path = "project/lore-config-template.yaml";

  it.each([
    {
      label: "outdated-like combo (disk sha = manifest sha != embedded sha)",
      embeddedSha: "new-embedded-sha",
      installedSha: "recorded-sha",
      probeResult: { sha256: "recorded-sha" } as const,
    },
    {
      label: "diverged-like combo (disk sha != manifest sha)",
      embeddedSha: "new-embedded-sha",
      installedSha: "recorded-sha",
      probeResult: { sha256: "user-edited-sha" } as const,
    },
    {
      label: "missing-like combo (manifest has entry, disk has nothing)",
      embeddedSha: "new-embedded-sha",
      installedSha: "recorded-sha",
      probeResult: "missing" as const,
    },
  ])("never appears in writes for $label", ({ embeddedSha, installedSha, probeResult }) => {
    const embedded = makeEmbedded(
      [embeddedEntry({ path, kind: "project" as AssetEntryKind, ownership: "user_once", sha256: embeddedSha })],
      "digest-A",
    );
    const installed = makeInstalled(
      [installedEntry({ path, kind: "governance", ownership: "user_once", sha256: installedSha })],
      "digest-B",
    );
    const probe = makeProbe({ [path]: probeResult });

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(hasPath(result.value.writes, path)).toBe(false);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY: missing manifest-tracked file restores via writes", () => {
  it("manifest has the entry, disk has nothing => classified missing, appears in writes", () => {
    const path = "agents/lore-implementer.md";
    const embedded = makeEmbedded([embeddedEntry({ path, kind: "agent", sha256: "embedded-sha" })], "digest-A");
    const installed = makeInstalled([installedEntry({ path, kind: "agent", sha256: "recorded-sha" })], "digest-B");
    const probe = makeProbe({ [path]: "missing" });

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.missing).toContain(path);
    expect(hasPath(result.value.writes, path)).toBe(true);
  });
});

describe("BOUNDARY: orphaned disk file is reported but never touched", () => {
  it("a disk file under a managed dir, unknown to both manifests, classifies as orphaned and is excluded from every action bucket", () => {
    const knownPath = "skills/example/SKILL.md";
    const orphanPath = "skills/rogue-user-file/NOTES.md";
    const embedded = makeEmbedded([embeddedEntry({ path: knownPath, sha256: "embedded-sha" })], "digest-A");
    const installed = makeInstalled([installedEntry({ path: knownPath, sha256: "embedded-sha" })], "digest-B");
    const probe = makeProbe(
      { [knownPath]: { sha256: "embedded-sha" }, [orphanPath]: { sha256: "foreign-sha" } },
      [orphanPath],
    );

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.orphaned).toContain(orphanPath);
    expect(hasPath(result.value.writes, orphanPath)).toBe(false);
    expect(hasPath(result.value.merges, orphanPath)).toBe(false);
  });
});

describe("BOUNDARY: fresh target (no installed manifest at all)", () => {
  it("every embedded entry classifies as missing (install-equivalent) when installedManifest is null", () => {
    const pathA = "skills/example/SKILL.md";
    const pathB = "agents/lore-explorer.md";
    const embedded = makeEmbedded(
      [embeddedEntry({ path: pathA, sha256: "sha-a" }), embeddedEntry({ path: pathB, kind: "agent", sha256: "sha-b" })],
      "digest-fresh",
    );
    const probe = makeProbe({ [pathA]: "missing", [pathB]: "missing" });

    const result: PlanUpdateResult = planUpdate(embedded, null, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe("stale");
    expect(result.value.files.missing).toEqual(expect.arrayContaining([pathA, pathB]));
    expect(hasPath(result.value.writes, pathA)).toBe(true);
    expect(hasPath(result.value.writes, pathB)).toBe(true);
  });
});

describe("BOUNDARY: no installed-manifest entry but disk already matches embedded sha", () => {
  it("classifies as sync, not diverged — DECISION: absent provenance for a path (no installed-manifest entry at all, e.g. a brand-new asset since the last recorded install) is not itself evidence of user modification; disk content already equal to the embedded/target sha needs zero action, so this must not be gated behind --force-diverged like a real diverged file would be. `missing` does not apply either — that state is reserved for the opposite shape (manifest HAS the entry, disk does not)", () => {
    const path = "skills/brand-new-since-last-install/SKILL.md";
    const embedded = makeEmbedded([embeddedEntry({ path, sha256: "target-sha" })], "digest-A");
    // Installed manifest tracks a DIFFERENT path only — zero provenance for
    // `path` itself (not the same as an empty/absent installed manifest,
    // covered by the "fresh target" BOUNDARY case above).
    const installed = makeInstalled(
      [installedEntry({ path: "skills/unrelated/SKILL.md", sha256: "other-sha" })],
      "digest-B",
    );
    const probe = makeProbe({ [path]: { sha256: "target-sha" } }); // disk already holds the target bytes

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.sync).toContain(path);
    expect(result.value.files.diverged).not.toContain(path);
    expect(hasPath(result.value.writes, path)).toBe(false);
    expect(hasPath(result.value.merges, path)).toBe(false);
  });
});

describe("BOUNDARY: legacy installed manifest with no assets_digest never short-circuits", () => {
  it("absent assets_digest forces full per-file expansion instead of a false-positive sync", () => {
    const path = "skills/example/SKILL.md";
    const embedded = makeEmbedded([embeddedEntry({ path, sha256: "embedded-sha" })], "digest-current");
    const installed = makeInstalled([installedEntry({ path, sha256: "embedded-sha" })]); // no assetsDigest arg
    const probe = makeProbe({ [path]: { sha256: "embedded-sha" } });

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Not asserting summary here (a full expansion that happens to find
    // everything in sync could legitimately report either "sync" or "stale"
    // depending on T3's summary derivation) — the load-bearing assertion is
    // that the probe WAS consulted, i.e. the short-circuit was not taken.
    expect(probe.resolveSpy).toHaveBeenCalled();
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("ERROR: a throwing probe never yields a partial plan", () => {
  it("returns err(...) when probe.resolve throws, with no writes/files payload leaking through", () => {
    const path = "hooks/pre-bash-git-safety-gate.mjs";
    const embedded = makeEmbedded([embeddedEntry({ path, kind: "hook", sha256: "embedded-sha" })], "digest-A");
    const installed = makeInstalled([installedEntry({ path, kind: "hook", sha256: "recorded-sha" })], "digest-B");
    const probe: UpdateProbe = {
      resolve: () => {
        throw new Error("simulated disk read failure");
      },
      listManagedPaths: () => [],
    };

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(typeof result.error.code).toBe("string");
    expect("value" in result).toBe(false);
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE: multiple entries in one call classify into mutually exclusive buckets", () => {
  it("sync/outdated/diverged co-existing in a single planUpdate call land correctly, sync in no action bucket", () => {
    const syncPath = "skills/sync-example/SKILL.md";
    const outdatedPath = "hooks/outdated-example.sh";
    const divergedPath = "hooks/diverged-example.sh";

    const embedded = makeEmbedded(
      [
        embeddedEntry({ path: syncPath, sha256: "same-sha" }),
        embeddedEntry({ path: outdatedPath, kind: "hook", sha256: "new-sha" }),
        embeddedEntry({ path: divergedPath, kind: "hook", sha256: "irrelevant-embedded-sha" }),
      ],
      "digest-multi-A",
    );
    const installed = makeInstalled(
      [
        installedEntry({ path: syncPath, sha256: "same-sha" }),
        installedEntry({ path: outdatedPath, kind: "hook", sha256: "old-sha" }),
        installedEntry({ path: divergedPath, kind: "hook", sha256: "recorded-sha" }),
      ],
      "digest-multi-B",
    );
    const probe = makeProbe({
      [syncPath]: { sha256: "same-sha" }, // matches manifest AND embedded => sync
      [outdatedPath]: { sha256: "old-sha" }, // matches manifest, not embedded => outdated
      [divergedPath]: { sha256: "user-edited-sha" }, // matches neither => diverged
    });

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.files.sync).toContain(syncPath);
    expect(result.value.files.outdated).toContain(outdatedPath);
    expect(result.value.files.diverged).toContain(divergedPath);

    // sync path: in NO action bucket at all.
    expect(hasPath(result.value.writes, syncPath)).toBe(false);
    expect(hasPath(result.value.merges, syncPath)).toBe(false);

    // outdated path: writes only.
    expect(hasPath(result.value.writes, outdatedPath)).toBe(true);

    // diverged path: no action bucket.
    expect(hasPath(result.value.writes, divergedPath)).toBe(false);
    expect(hasPath(result.value.merges, divergedPath)).toBe(false);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION: near-miss digest never trips the short-circuit", () => {
  it("a single trailing character difference between tree_digest and assets_digest forces full expansion, not a false sync", () => {
    const path = "skills/example/SKILL.md";
    const embedded = makeEmbedded([embeddedEntry({ path, sha256: "embedded-sha" })], "digest-almost-match-X");
    const installed = makeInstalled([installedEntry({ path, sha256: "recorded-sha" })], "digest-almost-match-Y");
    const probe = makeProbe({ [path]: { sha256: "recorded-sha" } });

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe("stale");
    expect(probe.resolveSpy).toHaveBeenCalled();
  });
});

describe("REGRESSION: plan-update.ts import purity (T3 AC line 2)", () => {
  it("imports no node:fs/node:child_process/bun modules once the module exists", () => {
    // Deliberately reads the SOURCE FILE directly (not via import) so this
    // assertion is meaningful the moment T3 creates the file, without this
    // test needing to change. Right now the file does not exist, so this
    // read throws ENOENT — itself a correct "implementation missing" signal.
    const src = readFileSync(join(CORE_SRC_DIR, "plan-update.ts"), "utf-8");
    const FORBIDDEN_IMPORT = /from\s+["'](?:node:)?(fs|path|os|child_process)["']|from\s+["']bun(?::|$)/;
    expect(FORBIDDEN_IMPORT.test(src)).toBe(false);
  });
});

// ─── DC2-3: retired ledger paths ────────────────────────────────────────────

describe("planUpdate — retired (tracked by the ledger, no longer shipped)", () => {
  const retiredPath = "skills/retired-x/SKILL.md";
  const keptPath = "skills/example/SKILL.md";
  const embedded = makeEmbedded([embeddedEntry({ path: keptPath, sha256: "same" })], "digest-A");

  it("an unedited retired file is `retired` and makes the summary stale, even when the digest matches", () => {
    const installed = makeInstalled(
      [installedEntry({ path: keptPath, sha256: "same" }), installedEntry({ path: retiredPath, sha256: "old" })],
      "digest-A",
    );
    const probe = makeProbe({ [keptPath]: { sha256: "same" }, [retiredPath]: { sha256: "old" } });

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.retired).toEqual([retiredPath]);
    expect(result.value.summary).toBe("stale");
    expect(result.value.writes).toEqual([]);
  });

  it("an edited retired file is `diverged`, never `retired`", () => {
    const installed = makeInstalled([installedEntry({ path: retiredPath, sha256: "old" })], "digest-B");
    const probe = makeProbe({ [keptPath]: { sha256: "same" }, [retiredPath]: { sha256: "user-edit" } });

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.diverged).toEqual([retiredPath]);
    expect(result.value.files.retired).toEqual([]);
    expect(result.value.summary).toBe("stale");
  });

  it("a retired path already absent from disk classifies nowhere", () => {
    const installed = makeInstalled(
      [installedEntry({ path: keptPath, sha256: "same" }), installedEntry({ path: retiredPath, sha256: "old" })],
      "digest-B",
    );
    const probe = makeProbe({ [keptPath]: { sha256: "same" } });

    const result: PlanUpdateResult = planUpdate(embedded, installed, probe);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.retired).toEqual([]);
    expect(result.value.files.diverged).toEqual([]);
    expect(result.value.summary).toBe("sync");
  });
});
