#!/usr/bin/env bun
/**
 * Live-corpus arming of two static detectors (`bun scripts/check-live-corpus-detectors.ts`).
 *
 * PURPOSE: run `check-ac-ref-integrity` and `check-gap-namespace` against THIS repository's own
 * `.lore/` corpus — the "arming" cases that used to live in `scripts/tests/check-ac-ref-integrity.test.ts`
 * and `scripts/tests/check-gap-namespace.test.ts`. They read the repo's live corpus, which the vitest
 * sandbox guard (LORE_TEST_SANDBOX, task-skill-implement-tg-4, AC-TG-2) refuses with exit 4, so they run
 * here, from a check script, wired into `check:live-repo-state` (same move as task-skill-test-tg-2).
 * The detectors' behaviour on mkdtemp fixtures stays in the unit suites.
 *
 * Checks (each read-only against the corpus):
 *   ac-ref HAPPY    — the real detector exits 0 with the shipped ledger and scanned > 0 tasks / rows;
 *   ac-ref CONTROL  — with an EMPTY ledger it exits 2, and the dangling refs it names equal the shipped
 *                     ledger's entries (set equality), so exit 0 above is the ledger doing its job;
 *   gap HAPPY       — `check-gap-namespace` main() exits 0 against the live ledger;
 *   gap SET         — the unowned-gap report equals the pinned set;
 *   gap SCOPE       — GAP-19's scope line is present and ok;
 *   bfi-11(d)       — (moved from pre-push-trip.bun.test.ts) `lore status --check-drift` exits 0 on the
 *                     live corpus AND the binary-provenance spec's stored code_anchors name
 *                     pre-push-trip.bun.test.ts (the renamed file).
 *
 * Usage: `bun scripts/check-live-corpus-detectors.ts`. Exit 0 all hold; 1 a check failed (printed);
 * 2 a precondition failed loudly.
 * Side-effect class: IO (spawns the detector, reads the corpus; writes only a mkdtemp ledger root).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LEDGER_RELATIVE_PATH, loadLedgerFromDisk } from "./check-ac-ref-integrity-core.js";
import {
  LEDGER_SLUG,
  checkGap19Scope,
  computeUnownedGapIds,
  extractGapEntries,
  main as gapNamespaceMain,
  readLedgerFromCorpus,
} from "./check-gap-namespace.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DETECTOR_SCRIPT = join(REPO_ROOT, "scripts", "check-ac-ref-integrity.ts");
const PINNED_UNOWNED_GAPS = ["GAP-7", "GAP-8", "GAP-11", "GAP-15", "GAP-16", "GAP-17", "GAP-18", "GAP-19"];

interface DetectorRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns the real detector with cwd = repo root. `LORE_AC_REF_LEDGER_REPO_ROOT` is deleted unless
 * `ledgerRootOverride` is given — an ambient value would silently redirect the ledger read.
 */
function runDetector(ledgerRootOverride?: string): DetectorRun {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["LORE_AC_REF_LEDGER_REPO_ROOT"];
  if (ledgerRootOverride !== undefined) env["LORE_AC_REF_LEDGER_REPO_ROOT"] = ledgerRootOverride;
  const result = spawnSync("bun", ["run", DETECTOR_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env,
  });
  if (result.status === null) {
    throw new Error(`check-ac-ref-integrity did not run to completion: ${String(result.error?.message ?? result.signal)}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status };
}

function sortedPairs(pairs: readonly { spec: string; id: string }[]): string[] {
  return pairs.map((p) => `${p.spec}::${p.id}`).sort();
}

function checkAcRef(): string[] {
  const violations: string[] = [];
  const happy = runDetector();
  if (happy.exitCode !== 0) {
    violations.push(`ac-ref HAPPY: detector exited ${happy.exitCode}, expected 0: ${(happy.stderr || happy.stdout).slice(0, 300)}`);
  }
  const scanned = /scanned\s+(\d+)\s+task\(s\),\s+(\d+)\s+evidence row\(s\)/.exec(happy.stdout);
  if (scanned === null || Number(scanned[1]) <= 0 || Number(scanned[2]) <= 0) {
    violations.push("ac-ref HAPPY: detector did not report a non-trivial scan (vacuous pass refused)");
  }

  const emptyLedgerRoot = mkdtempSync(join(tmpdir(), "lore-ac-ref-ledger-root-"));
  try {
    mkdirSync(join(emptyLedgerRoot, "scripts"), { recursive: true });
    writeFileSync(join(emptyLedgerRoot, LEDGER_RELATIVE_PATH), JSON.stringify({ entries: [] }), "utf8");
    const control = runDetector(emptyLedgerRoot);
    if (control.exitCode !== 2) {
      violations.push(`ac-ref CONTROL: empty-ledger run exited ${control.exitCode}, expected 2`);
    }
    const reported = [...(control.stdout + control.stderr).matchAll(/ac_ref="([^"]+)"\s+—\s+governing spec:\s+(\S+)/g)].map(
      (m) => ({ id: m[1] as string, spec: m[2] as string }),
    );
    if (reported.length === 0) violations.push("ac-ref CONTROL: empty-ledger run named no dangling refs");
    const shipped = loadLedgerFromDisk(REPO_ROOT).entries.map((e) => ({ spec: e.spec, id: e.id }));
    const got = sortedPairs(reported);
    const want = sortedPairs(shipped);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      violations.push(`ac-ref CONTROL: dangling refs (${got.length}) differ from shipped ledger entries (${want.length})`);
    }
  } finally {
    rmSync(emptyLedgerRoot, { recursive: true, force: true });
  }
  return violations;
}

function checkGapNamespace(): string[] {
  const violations: string[] = [];
  const exit = gapNamespaceMain();
  if (exit !== 0) violations.push(`gap HAPPY: check-gap-namespace main() exited ${exit}, expected 0`);

  const content = readLedgerFromCorpus(REPO_ROOT, LEDGER_SLUG);
  const unowned = new Set(computeUnownedGapIds(extractGapEntries(content).entries));
  const pinned = new Set(PINNED_UNOWNED_GAPS);
  const same = unowned.size === pinned.size && [...pinned].every((g) => unowned.has(g));
  if (!same) violations.push(`gap SET: unowned gaps ${JSON.stringify([...unowned].sort())} != pinned ${JSON.stringify([...pinned].sort())}`);

  const scope = checkGap19Scope(content);
  if (!scope.present || !scope.ok) violations.push(`gap SCOPE: GAP-19 scope line present=${scope.present} ok=${scope.ok}`);
  return violations;
}

const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const BFI_SPEC_SLUG = "spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor";

function runLoreAtRepoRoot(args: readonly string[]) {
  const result = spawnSync("bun", ["run", LORE_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env },
  });
  if (result.status === null) {
    throw new Error(`lore ${args.join(" ")} did not run to completion: ${String(result.error?.message ?? result.signal)}`);
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** bfi-11(d), moved from pre-push-trip.bun.test.ts: live drift clean AND the stored anchor names the renamed file. */
function checkBfi11Anchor(): string[] {
  const violations: string[] = [];
  const drift = runLoreAtRepoRoot(["status", "--check-drift"]);
  if (drift.status !== 0) violations.push(`bfi-11(d): status --check-drift exited ${drift.status}: ${(drift.stdout + drift.stderr).slice(0, 300)}`);
  const got = runLoreAtRepoRoot(["get", BFI_SPEC_SLUG, "--json"]);
  if (got.status !== 0) {
    violations.push(`bfi-11(d): lore get ${BFI_SPEC_SLUG} exited ${got.status}: ${(got.stdout + got.stderr).slice(0, 300)}`);
    return violations;
  }
  const parsed = JSON.parse(got.stdout) as { data?: { doc?: { extra?: { code_anchors?: readonly string[] } } } };
  const anchors = parsed.data?.doc?.extra?.code_anchors ?? [];
  if (!anchors.some((a) => a.endsWith("pre-push-trip.bun.test.ts"))) {
    violations.push(`bfi-11(d): ${BFI_SPEC_SLUG} code_anchors do not name pre-push-trip.bun.test.ts: ${JSON.stringify(anchors)}`);
  }
  return violations;
}

function main(): number {
  let violations: string[];
  try {
    violations = [...checkAcRef(), ...checkGapNamespace(), ...checkBfi11Anchor()];
  } catch (e) {
    console.error(`check-live-corpus-detectors: precondition failed — ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  if (violations.length > 0) {
    for (const v of violations) console.error(`check-live-corpus-detectors: ${v}`);
    return 1;
  }
  console.log(
    "check-live-corpus-detectors: OK — ac-ref detector exits 0 with the shipped ledger and 2 with an empty one naming exactly the ledger's refs; gap-namespace exits 0, unowned set pinned, GAP-19 scope ok",
  );
  return 0;
}

if (import.meta.main) process.exit(main());
