/**
 * Mirror-integrity measurements shared by the live check
 * (`scripts/check-live-mirror-integrity.ts`, run against THIS repository) and the mkdtemp-fixture
 * tests (`scripts/tests/spec-mirror-export.test.ts`, run against a throwaway corpus + mirror).
 * Every function takes the root / corpus cwd it measures as an argument — none reads a repo-global
 * path — so the same logic is proven on a fixture and then pointed at production.
 *
 * Origin: `spec-falsifiability-reachability-a-feedable-checkpoint-an` D6, AC-FR-6 / AC-FR-10, whose
 * helpers used to live inside the unit test and read the live corpus from there
 * (task-skill-test-tg-2 moved the live reads out of the unit suite).
 *
 * ⛔ The `maxBuffer` literal in {@link runLoreList} is the cap AC-MOS-2 of
 * `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by` borrows
 * (`scripts/check-list-json-real-corpus-buffer.ts` re-reads it from THIS file's code). The narrow
 * ten-key `lore list --json` row fits it with orders of magnitude to spare.
 *
 * Side-effect class: IO (spawns `lore list`, reads mirror files). Never writes.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NoOpTelemetry } from "@lore/core";
import { mirrorDirRelative, MIRROR_TYPES, type MirrorDocType } from "../export-spec-mirror-core.js";
import { InMemoryStore } from "../../packages/lore/src/store/in-memory-store.js";
import { CorpusService } from "../../packages/lore/src/service/corpus-service.js";
import { MigrationService } from "../../packages/lore/src/service/migration-service.js";
import { ReviewService } from "../../packages/lore/src/service/review-service.js";
import { VersionService } from "../../packages/lore/src/service/version-service.js";
import { OutlineService } from "../../packages/lore/src/service/outline-service.js";
import { TreeCheckService } from "../../packages/lore/src/service/tree-check-service.js";
import { RecordLockService } from "../../packages/lore/src/service/record-lock-service.js";
import { GateEnforcer } from "../../packages/lore/src/service/gate-enforcer.js";
import { runMigrationCoverage } from "../../packages/lore/src/eval/scenarios/migration-coverage.js";
import type { App } from "../../packages/lore/src/app.js";

const LIB_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LORE_ENTRY = join(LIB_REPO_ROOT, "packages", "lore", "src", "index.ts");

/** One live-corpus doc, as `lore list --json` reports it. */
export interface CorpusDoc {
  readonly id: string;
  readonly slug: string;
}

/**
 * Lists one doc type from the corpus the CLI resolves from `corpusCwd`, via a real
 * `lore list --type <t> --json --include-invalid` subprocess. `--include-invalid` matches EXACTLY
 * what `ExportDocsService.exportDocs` walks; omitting it would make knowledge/adr/task counts
 * structurally never match the mirror.
 *
 * ⛔ Fails LOUD when the subprocess did not run to completion: `spawnSync` past `maxBuffer` returns
 * `status: null` + `error.code: "ENOBUFS"`, which `status ?? 1` would launder into a fabricated
 * exit code (the defect recorded in `knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in`).
 *
 * @param type - mirrored doc type
 * @param corpusCwd - directory whose nearest `.lore/lore.db` is read
 * @throws {Error} on spawn failure, signal, ENOBUFS, nonzero exit, or a non-envelope payload
 */
export function runLoreList(type: MirrorDocType, corpusCwd: string): CorpusDoc[] {
  const args = ["list", "--type", type, "--json", "--include-invalid"];
  const result = spawnSync("bun", ["run", LORE_ENTRY, ...args], {
    cwd: corpusCwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: "1" },
  });
  const spawnError = result.error as NodeJS.ErrnoException | undefined;
  if (spawnError !== undefined || result.status === null) {
    throw new Error(
      `lore ${args.join(" ")}: subprocess did not run to completion — status=${String(result.status)} signal=${String(result.signal)} error.code=${spawnError?.code ?? "none"}. ` +
        `⛔ Never reported as an exit code: \`status ?? 1\` would fabricate a code the child never returned.`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`lore ${args.join(" ")} failed (exit ${result.status}): ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as { data?: { docs?: { id: string; slug: string }[] } };
  if (!Array.isArray(parsed.data?.docs)) throw new Error(`lore ${args.join(" ")} returned a non-envelope payload`);
  return parsed.data.docs.map((d) => ({ id: d.id, slug: d.slug }));
}

/** Every `.md` file's basename directly under one root's mirror directory for `type` (non-recursive). */
export function listMirrorFilenamesAt(root: string, type: MirrorDocType): string[] {
  const dir = join(root, mirrorDirRelative(type));
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name);
}

/** The frontmatter `id:` scalar of raw file content, or `null` when there is no strict frontmatter block or no `id:` line. */
export function extractIdFromFileContent(content: string): string | null {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  for (const line of (match[1] ?? "").split("\n")) {
    if (line.startsWith("id:")) return line.slice("id:".length).trim();
  }
  return null;
}

/** The leading `{PREFIX}-{digits}` identifier of a mirror filename (`"SPEC-021-foo.md"` -> `"SPEC-021"`), or `null`. */
export function extractFilenameLeadingId(filename: string): string | null {
  const match = filename.match(/^([A-Za-z]+-\d+)-/);
  return match?.[1] ?? null;
}

/** True iff `id`'s numeric suffix is zero-padded to AT LEAST 3 digits — the canonical mirror form. */
export function isThreeDigitPadded(id: string): boolean {
  const match = id.match(/^[A-Za-z]+-(\d+)$/);
  if (!match) return false;
  const digits = match[1] as string;
  return digits.padStart(3, "0") === digits;
}

/** Result of {@link measureAllTypesParity}. */
export interface AllTypesParity {
  /** One line per mirrored type whose on-disk file count differs from its live corpus count. */
  readonly countMismatches: string[];
  /** One line per mirror file whose frontmatter `id:` is missing, mismatched to its filename, or not 3-digit padded. */
  readonly idViolations: string[];
  /** Total mirror files inspected — the caller's non-vacuity floor. */
  readonly totalFilesChecked: number;
}

/**
 * AC-FR-10 (a)+(b) for one root: for EVERY mirrored type, mirror file count EQUALS the corpus count
 * read from `corpusCwd`, and every mirror file's frontmatter `id:` is byte-identical to its
 * filename's leading identifier AND zero-padded to 3 digits.
 *
 * ⛔ All six corpus reads happen BEFORE any assertion-shaped collection, and every violation is
 * collected rather than dying on the first — a mismatch on `spec` must not hide a defect on `task`.
 *
 * @param root - repo root holding `docs/requirements/<type>/`
 * @param corpusCwd - directory whose corpus is the truth the mirror is compared against
 */
export function measureAllTypesParity(root: string, corpusCwd: string): AllTypesParity {
  const perType = MIRROR_TYPES.map((type) => ({
    type,
    liveDocs: runLoreList(type, corpusCwd),
    filenames: listMirrorFilenamesAt(root, type),
  }));
  const countMismatches: string[] = [];
  const idViolations: string[] = [];
  let totalFilesChecked = 0;
  for (const { type, liveDocs, filenames } of perType) {
    if (filenames.length !== liveDocs.length) {
      countMismatches.push(`${type}: ${filenames.length} mirror file(s) on disk vs ${liveDocs.length} live corpus doc(s)`);
    }
    for (const filename of filenames) {
      totalFilesChecked += 1;
      const filenameId = extractFilenameLeadingId(filename);
      if (filenameId === null) {
        idViolations.push(`${type}/${filename} has no {PREFIX}-{digits}- leading identifier`);
        continue;
      }
      const frontmatterId = extractIdFromFileContent(readFileSync(join(root, mirrorDirRelative(type), filename), "utf8"));
      if (frontmatterId === null) {
        idViolations.push(`${type}/${filename} has no frontmatter id: line`);
        continue;
      }
      if (frontmatterId !== filenameId) {
        idViolations.push(`${type}/${filename}: frontmatter id: (${frontmatterId}) != filename leading id (${filenameId})`);
      }
      if (!isThreeDigitPadded(frontmatterId)) {
        idViolations.push(`${type}/${filename}: id "${frontmatterId}" is not zero-padded to 3 digits`);
      }
    }
  }
  return { countMismatches, idViolations, totalFilesChecked };
}

/**
 * A throwaway `App` backed by `InMemoryStore` — the same construction
 * `packages/lore/tests/unit/eval/migration-coverage.test.ts::makeApp` uses. NEVER touches any real
 * corpus: `MigrationService`/`InMemoryStore` operate entirely in memory.
 */
function makeThrowawayApp(): App {
  const store = new InMemoryStore();
  const telemetry = new NoOpTelemetry();
  return {
    corpusService: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), telemetry),
    reviewService: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    versionService: new VersionService(store, new RecordLockService(store, new GateEnforcer(undefined))),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: null as unknown as App["apiKeyStore"],
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry,
    close: () => {
      telemetry.close();
    },
  };
}

/** `links_broken` from one migration-coverage pass over `<root>/docs/requirements` — the AC-FR-10(c) observable. */
export async function measureLinksBrokenAt(
  root: string,
): Promise<{ links_broken: number; expected_files: number; passed: boolean }> {
  const app = makeThrowawayApp();
  try {
    const result = await runMigrationCoverage(join(root, "docs", "requirements"), app);
    return { links_broken: result.links_broken, expected_files: result.expected_files, passed: result.passed };
  } finally {
    app.close();
  }
}
