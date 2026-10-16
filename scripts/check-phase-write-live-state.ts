#!/usr/bin/env bun
/**
 * Live-repo oracle for AC-PHASEVER-2(b) and AC-PHASEVER-3(d) of
 * `spec-lore-phase-add-and-phase-rm-mutate-a-plan-s-declared`
 * (`bun scripts/check-phase-write-live-state.ts`).
 *
 * PURPOSE: assert two facts about THIS repository's live state:
 *   AC-PHASEVER-2(b)  the premise question has a recorded answer in the corpus — an ADR named
 *                     {@link DEFAULT_ADR_SLUG} is reachable from the spec by a direct, never-unlinked,
 *                     OUTBOUND `relates-to` edge (read from `lore audit <spec>`), the ADR's
 *                     `decision_status` is `accepted`, and it is not listed as retracted;
 *   AC-PHASEVER-3(d)  no file under `packages/` still asserts that phase writes record nothing —
 *                     `grep -rIl -e <phrase A> -e <phrase B> packages/` is EMPTY, controlled by the same
 *                     grep shape finding a pattern known present.
 * These read the repo's live `.lore/` corpus and scan its `packages/` tree, so they run here — from a
 * check script — and not from the unit suite (task-skill-test-tg-2). The wiring logic is exercised
 * against mkdtemp fixtures by
 * `packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts`, which drives this script
 * with `--root`, `--spec` and `--adr`.
 *
 * ⛔ Read-only, mechanically: only `list` and `audit` are ever spawned against the corpus. MEASURED
 * 2026-08-24: `lore get` APPENDS a `trace_events` row to the live corpus while `audit` and `list`
 * move nothing, so {@link runLoreReadOnly} refuses every other verb. `HOME` is a throwaway directory.
 *
 * ⛔ The two banned phrases are assembled by CONCATENATION and never written contiguously — they are
 * the grep's own subject, and a spelled-out literal anywhere under `packages/` would defeat it.
 *
 * Usage: `bun scripts/check-phase-write-live-state.ts [--root <dir>] [--spec <slug>] [--adr <slug>]`.
 * `--root` defaults to this repository (corpus resolved from it, `packages/` scanned under it).
 *
 * Exit codes: 0 both facts hold; 1 a fact failed (each failing conjunct printed); 2 a precondition
 * failed loudly (verb refused, truncated read, missing ADR, grep malfunction). Never "clean".
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LORE_ENTRY = join(SCRIPT_REPO_ROOT, "packages", "lore", "src", "index.ts");

export const DEFAULT_SPEC_SLUG = "spec-lore-phase-add-and-phase-rm-mutate-a-plan-s-declared";
export const DEFAULT_ADR_SLUG = "adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan";

/** The two phrases AC-PHASEVER-3(d) bans from every file under `packages/` — assembled, never written contiguously. */
export const BANNED_PHRASE_A = "no version" + " history";
export const BANNED_PHRASE_B = "version" + "-less";

/** The grep control: a pattern known present under `packages/`, run through the SAME grep shape. */
export const GREP_CONTROL_PATTERN = "insertVersion";

/** The only verbs this script may spawn against a corpus. */
const READ_ONLY_VERBS: readonly string[] = ["audit", "list"];

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Runs one read verb in `root`'s corpus with a throwaway `HOME`. Refuses every verb but `audit`/`list`.
 *
 * @throws {Error} on a refused verb, a spawn failure, or a signal-killed child
 */
export function runLoreReadOnly(args: readonly string[], root: string, home: string): RunResult {
  const verb = args[0];
  if (verb === undefined || !READ_ONLY_VERBS.includes(verb)) {
    throw new Error(`refusing to run \`lore ${args.join(" ")}\` against a corpus — only ${READ_ONLY_VERBS.join("/")} are allowed here`);
  }
  const proc = spawnSync("bun", [LORE_ENTRY, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // reason: SPEC-024 — AI is OFF for agent surfaces; pinned so a shell without CLAUDECODE=1 cannot nest a Claude call.
    env: { ...process.env, HOME: home, CI: "true", LORE_AI_DEFAULT: "off" },
  });
  if (proc.status === null) {
    throw new Error(`lore ${args.join(" ")} did not run to completion (signal ${String(proc.signal)}, error ${String(proc.error?.message)})`);
  }
  return { stdout: proc.stdout ?? "", stderr: proc.stderr ?? "", exitCode: proc.status };
}

/** Strict envelope parse — a failing or non-JSON run throws NAMING the raw output, never yields a default. */
function jsonEnvelope<T>(run: RunResult, label: string): T {
  if (run.exitCode !== 0) throw new Error(`${label} exited ${run.exitCode}: ${run.stderr.trim() || run.stdout.trim()}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.stdout.trim());
  } catch (cause) {
    throw new Error(`${label} did not emit a JSON envelope: ${JSON.stringify(run.stdout.slice(0, 400))}`, { cause });
  }
  const envelope = parsed as { ok?: boolean; data?: T };
  if (envelope.ok !== true || envelope.data === undefined) {
    throw new Error(`${label} returned a non-ok envelope: ${JSON.stringify(parsed).slice(0, 400)}`);
  }
  return envelope.data;
}

interface AuditEntry {
  readonly action?: string;
  readonly details?: unknown;
}

interface DocSummaryRow {
  readonly id: string;
  readonly slug: string;
  readonly meta?: { readonly decision_status?: string };
  readonly validity_status?: { readonly invalidated?: boolean };
}

/**
 * Counts audit rows of `action` on the SPEC that name `toId` with link type `wantedType`.
 * `link`/`unlink` rows are written on the FROM doc with `details.to_id`, so a row here proves the
 * edge's DIRECTION (outbound from the spec), which `lore get`'s `navigation.related` cannot.
 * `unlink` rows carry `link_type` as the ARRAY of removed types, so both shapes are accepted.
 */
export function countLinkAuditRows(entries: readonly AuditEntry[], action: "link" | "unlink", toId: string, wantedType: string): number {
  let hits = 0;
  for (const entry of entries) {
    if (entry.action !== action) continue;
    const details = entry.details;
    if (typeof details !== "object" || details === null) continue;
    const record = details as Record<string, unknown>;
    if (record["to_id"] !== toId) continue;
    const linkType = record["link_type"];
    if (linkType === wantedType || (Array.isArray(linkType) && linkType.includes(wantedType))) hits += 1;
  }
  return hits;
}

/** AC-PHASEVER-2(b): reads the premise record from the corpus at `root` and returns every failing conjunct. */
export function checkPremise(root: string, specSlug: string, adrSlug: string, home: string): string[] {
  const adrList = jsonEnvelope<{ docs: readonly DocSummaryRow[]; total: number }>(
    runLoreReadOnly(["list", "--type", "adr", "--json"], root, home),
    "lore list --type adr --json",
  );
  if (adrList.docs.length !== adrList.total) {
    throw new Error(`lore list --type adr --json is truncated: ${adrList.docs.length} rows vs total ${adrList.total}`);
  }
  const adr = adrList.docs.find((row) => row.slug === adrSlug);
  if (adr === undefined) throw new Error(`no ADR named ${adrSlug} in this corpus — AC-PHASEVER-2(b) has nothing to measure`);

  const audit = jsonEnvelope<{ entries: readonly AuditEntry[]; total: number }>(
    runLoreReadOnly(["audit", specSlug, "--limit", "10000", "--json"], root, home),
    `lore audit ${specSlug} --json`,
  );
  if (audit.entries.length !== audit.total) {
    throw new Error(`lore audit ${specSlug} --json is truncated: ${audit.entries.length} entries vs total ${audit.total} — raise --limit`);
  }

  const violations: string[] = [];
  const outbound = countLinkAuditRows(audit.entries, "link", adr.id, "relates-to");
  if (outbound < 1) {
    violations.push(`AC-PHASEVER-2(b): no audit row on ${specSlug} records a relates-to link to ${adr.id} (${audit.entries.length} entries scanned)`);
  }
  const unlinked = countLinkAuditRows(audit.entries, "unlink", adr.id, "relates-to");
  if (unlinked !== 0) violations.push(`AC-PHASEVER-2(b): the relates-to edge to ${adrSlug} was unlinked ${unlinked} time(s)`);
  if (adr.meta?.decision_status !== "accepted") {
    violations.push(`AC-PHASEVER-2(b): ${adrSlug} decision_status is ${String(adr.meta?.decision_status)}, not accepted`);
  }
  // ⛔ `validity_status` off a `list` row is ADVISORY, not authoritative; kept because `invalidated: true` would be a real signal.
  if (adr.validity_status?.invalidated !== false) {
    violations.push(`AC-PHASEVER-2(b): ${adrSlug} is not listed as live (validity_status.invalidated = ${String(adr.validity_status?.invalidated)})`);
  }
  const parentRows = countLinkAuditRows(audit.entries, "link", adr.id, "parent");
  if (parentRows !== 0) violations.push(`AC-PHASEVER-2(b): the edge to ${adrSlug} includes a tree-parent link (${parentRows} row(s)) — it must be relates-to only`);
  return violations;
}

/**
 * `grep -rIl -e <pattern>… packages/` from `root` — AC-PHASEVER-3(d)'s pinned match rule, verbatim:
 * no `--exclude`, no path filter. Exit 1 (no match) is a legitimate empty answer; anything else is a
 * broken invocation and throws, so a mis-aimed grep can never read as "0 files".
 */
export function grepFilesUnderPackages(root: string, patterns: readonly string[]): readonly string[] {
  const args = ["-rIl"];
  for (const pattern of patterns) args.push("-e", pattern);
  args.push("packages/");
  const proc = spawnSync("grep", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (proc.status === null) throw new Error(`grep was killed by signal ${String(proc.signal)}`);
  if (proc.status !== 0 && proc.status !== 1) throw new Error(`grep ${args.join(" ")} failed with exit ${proc.status}: ${proc.stderr}`);
  const files = (proc.stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (proc.status === 1 && files.length > 0) {
    throw new Error(`grep exited 1 ("no match") yet printed ${files.length} path(s) — the invocation is not being read correctly`);
  }
  return files;
}

/** AC-PHASEVER-3(d): no banned phrase under `<root>/packages/`, with the grep control proving the grep is aimed. */
export function checkBannedPhrases(root: string): string[] {
  const violations: string[] = [];
  const banned = grepFilesUnderPackages(root, [BANNED_PHRASE_A, BANNED_PHRASE_B]);
  if (banned.length > 0) violations.push(`AC-PHASEVER-3(d): still carrying a banned phrase: ${banned.join(", ")}`);
  const control = grepFilesUnderPackages(root, [GREP_CONTROL_PATTERN]);
  if (control.length < 1) {
    violations.push(`AC-PHASEVER-3(d): CONTROL failed — the same grep found no file for "${GREP_CONTROL_PATTERN}", so a zero above would be a mis-aimed grep`);
  }
  return violations;
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires an argument`);
  return value;
}

export function main(argv: readonly string[]): number {
  const home = mkdtempSync(join(tmpdir(), "lore-phase-live-home-"));
  try {
    const root = resolve(argValue(argv, "--root") ?? SCRIPT_REPO_ROOT);
    const spec = argValue(argv, "--spec") ?? DEFAULT_SPEC_SLUG;
    const adr = argValue(argv, "--adr") ?? DEFAULT_ADR_SLUG;
    const violations = [...checkPremise(root, spec, adr, home), ...checkBannedPhrases(root)];
    if (violations.length > 0) {
      for (const v of violations) console.error(`check-phase-write-live-state: ${v}`);
      return 1;
    }
    console.log(
      `check-phase-write-live-state: OK — ${spec} reaches the accepted ${adr} by an outbound, never-unlinked relates-to edge, and no file under packages/ carries a banned phrase (grep control found files)`,
    );
    return 0;
  } catch (e) {
    console.error(`check-phase-write-live-state: precondition failed — ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
