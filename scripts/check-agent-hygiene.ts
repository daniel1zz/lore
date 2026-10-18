#!/usr/bin/env bun
/**
 * Agent-hygiene scan (`bun run check:agent-hygiene`) — AC-AU-6 halves 1 and 2 of
 * `spec-autonomy-phase-1-decision-function-human-channel-lore`.
 *
 * Purpose: keep the shipped agent-facing assets (what a consumer's agents read) from steering agents
 * into the two habits that litter a shared checkout: `git stash` (the stack is shared by every
 * worktree and session, so a stash is lost work for somebody else) and polling with `pgrep -f`
 * (two such loops match each other's command lines and never end; reproduced on macOS 2026-10-18).
 *
 * Public surface: {@link scanAgentHygiene} (pure), {@link loadAllowlist} (IO), {@link main} (IO).
 * Invariants: a line is exempt only through an allowlist entry that names its file, its exact trimmed
 * text and a reason of at least {@link MIN_REASON_LENGTH} chars; an allowlist entry that exempts nothing
 * is itself a finding, so the list cannot rot. A missing or malformed allowlist is a scan failure.
 * Side-effect class: `scanAgentHygiene` pure; `loadAllowlist` and `main` read the file system.
 *
 * Exit codes: 0 clean; 1 findings (each printed as `file:line`); 2 scan could not run.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Shipped directories whose text reaches consumers' agents (repo-relative). */
export const SCANNED_ASSET_DIRS: readonly string[] = ["assets/agents", "assets/skills", "assets/hooks", "assets/context"];

/** Minimum characters of an allowlist reason; a shorter one is a placeholder, not a reason. */
export const MIN_REASON_LENGTH = 20;

const ALLOWLIST_RELATIVE_PATH = "scripts/agent-hygiene-allowlist.json";

/** Named hygiene rules; `id` is what a finding reports. */
export const HYGIENE_RULES = [
  { id: "stash-steer", pattern: /git stash (push|save|pop|apply)/, why: "steers an agent into the shared git stash stack; commit the test first or use `lore verify --falsify`" },
  { id: "pgrep-poll", pattern: /\b(until|while)\b.*pgrep -f/, why: "a pgrep -f wait loop matches its own command line and its peers'; wait on a recorded pid" },
] as const;

const AllowlistSchema = z
  .object({
    entries: z.array(
      z
        .object({
          file: z.string().min(1),
          line: z.string().min(1),
          reason: z.string().min(MIN_REASON_LENGTH),
        })
        .strict(),
    ),
  })
  .strict();

/** Parsed allowlist (types derive from the schema). */
export type Allowlist = z.infer<typeof AllowlistSchema>;

/** Thrown when the scan cannot run (missing/malformed allowlist, unreadable tree); never reported as clean. */
export class AgentHygieneScanError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "AgentHygieneScanError";
  }
}

/** One finding: a rule hit on `file:line`, or an allowlist entry that exempts nothing. */
export interface HygieneFinding {
  readonly kind: "rule-hit" | "stale-allowlist-entry";
  readonly file: string;
  readonly line: number;
  readonly ruleId: string;
  readonly text: string;
}

/** A scanned file: repo-relative path plus its content. */
export interface ScannedFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Applies every rule to every line, then reconciles with the allowlist.
 *
 * @param files - Files to scan (repo-relative `path`s with forward slashes).
 * @param allowlist - Exemptions; each must name a file and the exact trimmed line it exempts.
 * @returns Findings in file/line order; empty means clean.
 * @example
 * scanAgentHygiene([{ path: "assets/a.md", content: "git stash push" }], { entries: [] }); // one rule-hit
 */
export function scanAgentHygiene(files: readonly ScannedFile[], allowlist: Allowlist): HygieneFinding[] {
  const findings: HygieneFinding[] = [];
  const usedEntries = new Set<number>();
  for (const file of files) {
    const lines = file.content.split("\n");
    lines.forEach((text, index) => {
      for (const rule of HYGIENE_RULES) {
        if (!rule.pattern.test(text)) continue;
        const entryIndex = allowlist.entries.findIndex((entry) => entry.file === file.path && entry.line === text.trim());
        if (entryIndex >= 0) {
          usedEntries.add(entryIndex);
          continue;
        }
        findings.push({ kind: "rule-hit", file: file.path, line: index + 1, ruleId: rule.id, text: text.trim() });
      }
    });
  }
  allowlist.entries.forEach((entry, index) => {
    if (!usedEntries.has(index)) {
      findings.push({ kind: "stale-allowlist-entry", file: entry.file, line: 0, ruleId: "stale-allowlist-entry", text: entry.line });
    }
  });
  return findings;
}

/**
 * Reads and validates `scripts/agent-hygiene-allowlist.json` under `repoRoot`.
 *
 * @throws {AgentHygieneScanError} when the file is absent, not JSON, or fails the schema.
 */
export function loadAllowlist(repoRoot: string): Allowlist {
  const path = join(repoRoot, ALLOWLIST_RELATIVE_PATH);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new AgentHygieneScanError(`allowlist unreadable: ${cause instanceof Error ? cause.message : String(cause)}`, path);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new AgentHygieneScanError(`allowlist is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`, path);
  }
  const parsed = AllowlistSchema.safeParse(json);
  if (!parsed.success) {
    throw new AgentHygieneScanError(`allowlist violates its schema: ${parsed.error.message}`, path);
  }
  return parsed.data;
}

function collectFiles(repoRoot: string, directory: string, into: ScannedFile[]): void {
  const absolute = join(repoRoot, directory);
  let names: string[];
  try {
    names = readdirSync(absolute);
  } catch (cause) {
    throw new AgentHygieneScanError(`scanned directory unreadable: ${cause instanceof Error ? cause.message : String(cause)}`, absolute);
  }
  for (const name of names.sort()) {
    const child = join(absolute, name);
    if (statSync(child).isDirectory()) {
      collectFiles(repoRoot, relative(repoRoot, child), into);
      continue;
    }
    const buffer = readFileSync(child);
    if (buffer.includes(0)) continue; // reason: a NUL byte marks a binary asset, which carries no agent-readable lines
    into.push({ path: relative(repoRoot, child).split("\\").join("/"), content: buffer.toString("utf8") });
  }
}

/**
 * Runs the scan over {@link SCANNED_ASSET_DIRS} under `repoRoot`.
 *
 * @param repoRoot - Defaults to this repo; tests pass a fixture tree.
 * @param report - Receives every failure line (default: stderr).
 * @returns Exit code 0 (clean) or 1 (findings).
 * @throws {AgentHygieneScanError} when the scan cannot run.
 */
export function main(repoRoot: string = REPO_ROOT, report: (line: string) => void = (line) => process.stderr.write(`${line}\n`)): number {
  const allowlist = loadAllowlist(repoRoot);
  const files: ScannedFile[] = [];
  for (const directory of SCANNED_ASSET_DIRS) collectFiles(repoRoot, directory, files);
  const findings = scanAgentHygiene(files, allowlist);
  if (findings.length === 0) {
    process.stdout.write(`check:agent-hygiene passed — ${files.length} shipped asset file(s) scanned.\n`);
    return 0;
  }
  report(`check:agent-hygiene FAILED — ${findings.length} finding(s):`);
  for (const finding of findings) {
    const why = HYGIENE_RULES.find((rule) => rule.id === finding.ruleId)?.why ?? "an allowlist entry that exempts no line must be removed";
    report(`  ${finding.file}:${finding.line}  [${finding.ruleId}]  ${finding.text}\n      ${why}`);
  }
  return 1;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    process.stderr.write(`check:agent-hygiene could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
