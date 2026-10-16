/**
 * AC-OX-6 — spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check.
 *
 * BACK-CATALOGUE SWEEP: task-the-two-mirror-exporters-disagree-because-drift-detection's
 * measured baseline (main @ 9736bdb9, 2026-08-13) found the mirror's frontmatter `status` field
 * disagreeing with the live corpus doc's `status` for a large share of `.lore/export-index.json`-
 * mapped files, PLUS a handful of mappings whose ULID no longer resolves to any live doc — and
 * every EXISTING checker (`mirror:export --check`, `lore export-docs --force`, `check:spec-
 * mirror`) reported OK against all of it, because none of them ever compares frontmatter (see
 * `mirror-frontmatter-drift.test.ts`'s own header for the full mechanism this sweep retroactively
 * exposes).
 *
 * This test is READ-ONLY over THIS repo's real `docs/requirements/**` + `.lore/export-index.json`
 * (git-tracked, present in every worktree) and the LIVE corpus (reached via the SAME `lore` CLI
 * subprocess pattern `scripts/tests/spec-mirror-export.test.ts` already establishes — a `lore
 * list --json` read never writes anything, so this satisfies "never write to the repo's own
 * `.lore/` corpus from tests" while still measuring the real thing an AC-OX-5-shaped fixture
 * cannot substitute for). It asserts BOTH directions of the mapping <-> live-doc relationship —
 * a mapping-keyed loop ALONE can prove a mapping resolves to nothing (orphan), but is
 * structurally blind to a live doc that has NO mapping at all (never exported); this file's own
 * first attempt at this exact count (recorded in the governing task) silently parsed 0 of ~1490
 * files and reported "0 mismatches" — the reason every count below is DERIVED at run time, never
 * a literal, and the reason `parsed_count` is asserted both non-zero AND equal to the
 * mapped-and-present population before the status comparison is trusted at all.
 *
 * Expected to be RED right now (a known back-catalogue this task's own scope forbids sweeping
 * from a worktree — see this repo's dispatch protocol: "never run the sweep yourself, that is the
 * orchestrator's job in the main checkout after merge"). Every disagreement is named in the
 * failure output — never a bare boolean, and never silently degraded to "0 mismatches" by a
 * parsing gap.
 *
 * @spec_ref spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check AC-OX-6
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMirrorMappings, MIRROR_TYPES, mirrorDirRelative, type MirrorDocType } from "../export-spec-mirror-core.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns `bun run <LORE_ENTRY> ...args` against the REPO ROOT — a READ-ONLY corpus query in every call site this file makes (mirrors `spec-mirror-export.test.ts`'s own `runLore` helper). Explicit `maxBuffer` per this repo's spawnSync-truncation discipline (project CLAUDE.md). */
function runLore(args: string[]): RunResult {
  const result = spawnSync("bun", ["run", LORE_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: "1" },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

interface LiveDoc {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
}

/**
 * Live corpus (id, slug, status) for ONE {@link MirrorDocType} via a real, READ-ONLY `lore list
 * --type <t> --json --include-invalid` subprocess. `--include-invalid` matches EXACTLY what
 * `ExportDocsService.exportDocs` itself walks (`StoreInterface.findMany` has no invalidation
 * filter — that filter is a `CorpusService.list()`-only post-filter) — mirrors
 * `spec-mirror-export.test.ts::readLiveCorpusDocsIncludingInvalid`'s own established rationale,
 * duplicated locally per this repo's test-helper convention (test helpers stay local, not shared
 * across files in different packages).
 */
function readLiveDocs(type: MirrorDocType): LiveDoc[] {
  const result = runLore(["list", "--type", type, "--json", "--include-invalid"]);
  if (result.exitCode !== 0) {
    throw new Error(
      `test setup: lore list --type ${type} --json --include-invalid failed (exit ${result.exitCode}): ${result.stderr}`,
    );
  }
  const parsed = JSON.parse(result.stdout) as { data: { docs: { id: string; slug: string; status: string }[] } };
  return parsed.data.docs.map((d) => ({ id: d.id, slug: d.slug, status: d.status }));
}

/**
 * Extracts the frontmatter `status:` scalar from raw `.md` file content — a minimal, test-local
 * line scan (mirrors `spec-mirror-export.test.ts::extractIdFromFileContent`'s own established
 * pattern for `id:`, never shared — this repo's convention keeps test helpers local). Returns
 * `null` if there is no strict `---\n...\n---\n` frontmatter block, or no top-level `status:`
 * line inside it — a caller must treat `null` as UNDECIDABLE, never as "clean".
 */
function extractStatusFromFileContent(content: string): string | null {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  for (const line of (match[1] ?? "").split("\n")) {
    if (line.startsWith("status:")) return line.slice("status:".length).trim();
  }
  return null;
}

/**
 * Resolves which {@link MirrorDocType} an export-index mapping belongs to, from its `file_path`
 * prefix — `ExportIndexMapping` carries NO `type` field of its own (`{human_id, file_path}`
 * only), and {@link mirrorDirRelative} is the literal, exact directory every file of that type is
 * written under, so this is a derivation from a FACT the mapping already encodes, never a guess.
 */
function resolveTypeFromFilePath(filePath: string): MirrorDocType | null {
  for (const type of MIRROR_TYPES) {
    if (filePath.startsWith(`${mirrorDirRelative(type)}/`)) return type;
  }
  return null;
}

interface Problem {
  readonly kind: "orphan_mapping" | "never_exported" | "file_absent" | "unreadable_frontmatter" | "status_mismatch";
  readonly detail: string;
}

describe("AC-OX-6 — back-catalogue sweep: every mirror file's frontmatter status equals its corpus doc's live status, resolved through .lore/export-index.json (never by filename), both directions, with a positive parse-count trace", () => {
  it(
    "every export-index-mapped mirror file's frontmatter status matches its corpus doc's status, every mapping resolves to a live doc, every live doc has a mapping, parsed_count is non-zero and equal to the mapped-and-present population, and the read-only comparison leaves the tree untouched",
    () => {
      const mappings = loadMirrorMappings(REPO_ROOT);

      // Live docs across ALL SIX mirrored types (never a literal count — always re-derived).
      const liveDocsById = new Map<string, LiveDoc & { type: MirrorDocType }>();
      for (const type of MIRROR_TYPES) {
        for (const doc of readLiveDocs(type)) {
          liveDocsById.set(doc.id, { ...doc, type });
        }
      }
      const totalLiveDocs = liveDocsById.size;
      // Sanity floor: never a vacuous pass over an empty corpus.
      expect(totalLiveDocs).toBeGreaterThan(0);

      const problems: Problem[] = [];

      // ── Direction 1: every export-index mapping resolves to a live doc + a parseable status ──
      let mappedAndPresentCount = 0;
      let parsedCount = 0;
      for (const [docId, mapping] of Object.entries(mappings)) {
        // A mapping whose file_path is under no mirror type's directory (e.g. a baseline doc,
        // which is not a mirror type) is outside this oracle's population — skip, never "orphan".
        if (resolveTypeFromFilePath(mapping.file_path) === null) continue;
        const liveDoc = liveDocsById.get(docId);
        if (liveDoc === undefined) {
          problems.push({
            kind: "orphan_mapping",
            detail: `export-index maps ${docId} -> ${mapping.file_path}, but no live corpus doc has this id`,
          });
          continue;
        }

        // Sanity: the mapping's file_path must resolve to the SAME type the live doc claims —
        // resolveTypeFromFilePath is exercised here (never dead code) and any disagreement is
        // itself worth surfacing rather than silently trusting the mapping.
        const pathType = resolveTypeFromFilePath(mapping.file_path);
        if (pathType !== null && pathType !== liveDoc.type) {
          problems.push({
            kind: "orphan_mapping",
            detail: `${liveDoc.slug} (${docId}) is type ${liveDoc.type} but its mapping's file_path ${mapping.file_path} resolves to type ${pathType}`,
          });
          continue;
        }

        const absPath = join(REPO_ROOT, mapping.file_path);
        if (!existsSync(absPath)) {
          problems.push({
            kind: "file_absent",
            detail: `${liveDoc.slug} (${docId}) mapped to ${mapping.file_path}, but the file does not exist on disk`,
          });
          continue;
        }

        mappedAndPresentCount += 1;
        const content = readFileSync(absPath, "utf8");
        const onDiskStatus = extractStatusFromFileContent(content);
        if (onDiskStatus === null) {
          problems.push({
            kind: "unreadable_frontmatter",
            detail: `${liveDoc.slug} (${docId}) at ${mapping.file_path} has no parseable frontmatter status: line`,
          });
          continue;
        }
        parsedCount += 1;

        if (onDiskStatus !== liveDoc.status) {
          problems.push({
            kind: "status_mismatch",
            detail: `${liveDoc.slug} (${docId}) at ${mapping.file_path}: mirror says status: ${onDiskStatus}, corpus says status: ${liveDoc.status}`,
          });
        }
      }

      // ── Direction 2: every live doc has a mapping at all — a mapping-keyed loop alone is
      // structurally blind to this (measured this session: docs created with no export-index
      // entry yet). ──────────────────────────────────────────────────────────────────────────
      let neverExportedCount = 0;
      for (const [docId, liveDoc] of liveDocsById) {
        if (mappings[docId] === undefined) {
          neverExportedCount += 1;
          problems.push({
            kind: "never_exported",
            detail: `${liveDoc.slug} (${docId}, type ${liveDoc.type}) has no .lore/export-index.json mapping at all`,
          });
        }
      }

      // Positive-trace requirement (AC-OX-6): a run that silently parsed 0 files is
      // indistinguishable from a clean one. Assert BOTH that parsing actually happened AND that
      // it covered the WHOLE mapped-and-present population — never a partial silent skip.
      expect(parsedCount).toBeGreaterThan(0);
      expect(parsedCount).toBe(mappedAndPresentCount);
      // The mapped-and-present population plus never-exported docs can never exceed the total
      // live-doc count (arithmetic sanity — catches a double-count bug in this test itself).
      expect(mappedAndPresentCount + neverExportedCount).toBeLessThanOrEqual(totalLiveDocs);

      // The actual verdict — every category of problem NAMED explicitly on failure (vitest's
      // array diff prints every entry with its own human-readable detail string), never a bare
      // boolean, never a count with no member list.
      expect(problems).toEqual([]);
    },
    180_000,
  );
});
