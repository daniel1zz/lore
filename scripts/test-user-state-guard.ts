/**
 * User-level state guard (task iv-2, AC-IV-3, rule AS-27, closes debt AD-15).
 *
 * Purpose: fail a test run that changed any lore-owned path of the STARTING HOME. The repo-tree
 * snapshot (AC-TG-3) and the read recorder (AC-TG-7) only see the repository, so an in-process test
 * that wrote the developer's real ~/.claude/rules went unnoticed.
 * Public surface: `resolveUserStateRoots`, `snapshotUserState`, `diffUserState`,
 * `assertUserStateUnchanged`, `UserStateWrittenDuringRunError` (all parametrised by roots, so the
 * guard's own test drives them against a mkdtemp home; scripts/test-global-setup.ts wires the real one).
 * Invariants: only the listed lore-owned paths are fingerprinted (path + size + sha256); the rest of
 * ~/.claude (projects/, history, sessions: live Claude Code state) is excluded by construction, never
 * by a deny-list. A missing path is simply absent from the snapshot; add/delete/change are all findings.
 * Side-effect class: IO read-only.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

export const USER_STATE_RULE_ID = "AS-27";

/** Resolved roots of the guarded user-level state. */
export type UserStateRoots = { readonly home: string; readonly settingsDir: string };
/** path -> fingerprint (`<size>:<sha256>`, or `link:<target>`). */
export type UserStateSnapshot = ReadonlyMap<string, string>;

/** Thrown at teardown when a guarded path changed; `findings` holds one line per changed path. */
export class UserStateWrittenDuringRunError extends Error {
  readonly findings: readonly string[];
  constructor(findings: readonly string[]) {
    super(
      `${USER_STATE_RULE_ID}: the test run changed user-level state of the starting home (${findings.length} path(s)):\n` +
        `${findings.map((line) => `  ${line}`).join("\n")}\n` +
        `A test must never write the developer's real home. If another session ran \`lore setup\` / \`lore context refresh\` ` +
        `during this run, the named paths show it; re-run once that finishes.`,
    );
    this.name = "UserStateWrittenDuringRunError";
    this.findings = findings;
  }
}

/** The lore settings folder: $LORE_CONFIG_HOME, else $XDG_CONFIG_HOME/lore, else ~/.config/lore. */
export function resolveUserStateRoots(home: string, env: Record<string, string | undefined>): UserStateRoots {
  const lore = env["LORE_CONFIG_HOME"];
  const xdg = env["XDG_CONFIG_HOME"];
  const settingsDir =
    lore !== undefined && lore !== "" ? lore : xdg !== undefined && xdg !== "" ? join(xdg, "lore") : join(home, ".config", "lore");
  return { home, settingsDir };
}

function fingerprintFile(abs: string): string | undefined {
  let stat;
  try {
    stat = lstatSync(abs);
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw caught;
  }
  if (stat.isSymbolicLink()) return `link:${readlinkSync(abs)}`;
  if (!stat.isFile()) return undefined;
  return `${stat.size}:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`;
}

function listDir(abs: string): string[] {
  try {
    return readdirSync(abs).sort();
  } catch (caught) {
    const code = (caught as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw caught;
  }
}

function addTree(into: Map<string, string>, abs: string): void {
  let stat;
  try {
    stat = lstatSync(abs);
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return;
    throw caught;
  }
  if (stat.isDirectory()) {
    for (const entry of listDir(abs)) addTree(into, join(abs, entry));
    return;
  }
  const fingerprint = fingerprintFile(abs);
  if (fingerprint !== undefined) into.set(abs, fingerprint);
}

/** Fingerprints exactly the D2 lore-owned paths under `roots`. */
export function snapshotUserState(roots: UserStateRoots): UserStateSnapshot {
  const claude = join(roots.home, ".claude");
  const snapshot = new Map<string, string>();
  for (const name of listDir(join(claude, "rules"))) {
    if (name.startsWith("lore-") && name.endsWith(".md")) addTree(snapshot, join(claude, "rules", name));
  }
  for (const name of listDir(join(claude, "skills"))) {
    if (name.startsWith("lore-")) addTree(snapshot, join(claude, "skills", name));
  }
  for (const name of listDir(join(claude, "agents"))) {
    if (name.startsWith("lore-") && name.endsWith(".md")) addTree(snapshot, join(claude, "agents", name));
  }
  addTree(snapshot, join(claude, "CLAUDE.md"));
  addTree(snapshot, join(claude, "settings.json"));
  addTree(snapshot, join(claude, "hooks"));
  addTree(snapshot, roots.settingsDir);
  return snapshot;
}

/** One `added|deleted|changed: <path>` line per differing path, sorted by path. */
export function diffUserState(before: UserStateSnapshot, after: UserStateSnapshot): string[] {
  const lines: { path: string; line: string }[] = [];
  for (const [path, fingerprint] of after) {
    const old = before.get(path);
    if (old === undefined) lines.push({ path, line: `added: ${path}` });
    else if (old !== fingerprint) lines.push({ path, line: `changed: ${path}` });
  }
  for (const path of before.keys()) {
    if (!after.has(path)) lines.push({ path, line: `deleted: ${path}` });
  }
  return lines.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((entry) => entry.line);
}

/** Re-snapshots `roots` and throws `UserStateWrittenDuringRunError` naming each changed path and AS-27. */
export function assertUserStateUnchanged(before: UserStateSnapshot, roots: UserStateRoots): void {
  const findings = diffUserState(before, snapshotUserState(roots));
  if (findings.length > 0) throw new UserStateWrittenDuringRunError(findings);
}
