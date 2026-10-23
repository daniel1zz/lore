/**
 * `lore migrate fragments` flow — rewrites old-format context-fragment frontmatter (`audience` / `mode` / `delivery`)
 * to the `inject` list (+ `agents`).
 * Spec: spec-fragment-injection-timing-one-inject-enum-a-per-turn (Migration mapping, D9, BR-1376).
 *
 * Public surface:
 *   - migrateFragments(deps, opts) — one layer set, preview or apply; returns per-file outcomes + the exit code.
 *   - mapOldFrontmatter(raw) — pure mapping table (exported for tests).
 *   - formatOutcomeLine(outcome), formatOutcomeLines(outcomes) — the `<path>: <old> -> <new>` lines.
 *   - MigrateFragmentsDeps, MigrateFragmentsFs, FragmentLayerDir, FragmentFileOutcome, MigrateFragmentsReport,
 *     MigrateFragmentsError, MIGRATE_EXIT_CONFLICT, MIGRATE_EXIT_REFUSED.
 *
 * Invariants:
 *   - The RAW frontmatter is parsed (plain YAML): the new schema refuses the old keys, so it is NOT the reader here.
 *   - Only frontmatter lines change: the audience / mode / delivery key spans are dropped, `inject:` (flow list) and
 *     `agents:` are inserted right after the `title:` span; every byte from the closing `---` fence on is untouched.
 *   - The rewritten frontmatter must pass `FragmentFrontmatterSchema`, else the file is refused (never half-valid output).
 *   - Apply is per-file: read hash -> (optional hook) -> re-read -> write only if the hash is unchanged. A changed file is
 *     left exactly as the concurrent writer left it and reported as `conflict`.
 *   - Exit: 5 if any conflict, else 4 if any refusal, else 0; migratable files are migrated in every case.
 *   - Idempotent: an already-migrated file is `unchanged`.
 *
 * Side-effect class: IO through the injected `MigrateFragmentsFs` (preview performs reads only).
 */
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { FragmentFrontmatterSchema } from "@lore/core";

/** Local Result: `@lore/core`'s is bound to `LoreError`, and a failed write is not one of its codes. */
export type FlowResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: MigrateFragmentsError };
const ok = <T>(value: T): FlowResult<T> => ({ ok: true, value });
const err = (error: MigrateFragmentsError): FlowResult<never> => ({ ok: false, error });

/** Exit code when any file changed between read and write. */
export const MIGRATE_EXIT_CONFLICT = 5;
/** Exit code when any file was refused (and none conflicted). */
export const MIGRATE_EXIT_REFUSED = 4;

/** File ports. `listDir` of a missing directory resolves `[]`; `readFile` of a missing file resolves null. */
export interface MigrateFragmentsFs {
  listDir(dir: string): Promise<string[]>;
  readFile(path: string): Promise<string | null>;
  /** Replace the file's content (adapter writes atomically). May reject; the flow reports it as WRITE_FAILED. */
  writeFile(path: string, text: string): Promise<void>;
}

/** Injected dependencies. */
export interface MigrateFragmentsDeps {
  readonly fs: MigrateFragmentsFs;
  /**
   * Test seam: awaited after the first read and before the precondition re-read of each file about to be written.
   * Production leaves it undefined, except the adapter wires `LORE_MIGRATE_FRAGMENTS_SYNC_DIR` (compiled e2e only).
   */
  readonly beforeWrite?: (path: string) => Promise<void>;
}

/** One fragment directory to migrate. */
export interface FragmentLayerDir {
  readonly scope: "user" | "project";
  /** Absolute directory holding `*.md` fragments. */
  readonly dir: string;
}

/** Per-file result. `migrated` means "would be" in preview and "was" in apply. */
export type FragmentFileOutcome =
  | { readonly kind: "migrated"; readonly path: string; readonly old: string; readonly next: string }
  | { readonly kind: "unchanged"; readonly path: string }
  | { readonly kind: "refused"; readonly path: string; readonly reason: string }
  | { readonly kind: "conflict"; readonly path: string };

/** Flow result. */
export interface MigrateFragmentsReport {
  readonly outcomes: readonly FragmentFileOutcome[];
  readonly exitCode: 0 | 4 | 5;
}

/** A write that failed for an IO reason (distinct from a refusal, which is a content decision). */
export interface MigrateFragmentsError {
  readonly code: "WRITE_FAILED";
  readonly path: string;
  readonly message: string;
}

/** Result of mapping one file's raw frontmatter. */
export type OldFrontmatterMapping =
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: string }
  | {
      readonly kind: "migrate";
      readonly inject: readonly string[];
      readonly agents?: readonly string[];
      readonly old: string;
    };

const OLD_KEYS = ["audience", "mode", "delivery"] as const;
const TOP_LEVEL_KEY = /^([A-Za-z_][\w-]*)\s*:/;

function asStringArray(value: unknown): string[] | null {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value as string[];
  return null;
}

function describeOld(raw: Record<string, unknown>): string {
  const parts: string[] = [];
  const audience = asStringArray(raw["audience"]);
  if (audience !== null) parts.push(`audience: [${audience.join(", ")}]`);
  if (raw["mode"] !== undefined) parts.push(`mode: ${String(raw["mode"])}`);
  if (raw["delivery"] !== undefined) parts.push(`delivery: ${String(raw["delivery"])}`);
  return parts.join(", ");
}

/**
 * Pure mapping table: raw old frontmatter object -> new `inject` / `agents`.
 *
 * @param raw Parsed YAML of the frontmatter (any shape).
 * @returns unchanged (already new format), refused (with reason) or migrate (the new values).
 * @example mapOldFrontmatter({ audience: ["main"], mode: "static" }) // { kind: "migrate", inject: ["launch"], ... }
 */
export function mapOldFrontmatter(raw: Record<string, unknown>): OldFrontmatterMapping {
  const hasOld = OLD_KEYS.some((k) => raw[k] !== undefined);
  const hasInject = raw["inject"] !== undefined;
  if (!hasOld) {
    return hasInject ? { kind: "unchanged" } : { kind: "refused", reason: "no audience and no inject: nothing to migrate from" };
  }
  if (hasInject) return { kind: "refused", reason: "carries both inject and the retired audience/mode/delivery keys; remove one set by hand" };

  const audience = asStringArray(raw["audience"]);
  if (audience === null || audience.length === 0) return { kind: "refused", reason: "audience is missing or not a list of strings" };
  const mode = raw["mode"] ?? "static";
  if (mode !== "static" && mode !== "dynamic") return { kind: "refused", reason: `unknown mode '${String(mode)}'` };
  const delivery = raw["delivery"] ?? "rules";
  if (delivery !== "rules" && delivery !== "skill") return { kind: "refused", reason: `unknown delivery '${String(delivery)}'` };

  let hasMain = false;
  let hasAnyHelper = false;
  const types: string[] = [];
  for (const entry of audience) {
    if (entry === "main") hasMain = true;
    else if (entry === "subagent:*") hasAnyHelper = true;
    else if (entry.startsWith("subagent:") && entry.length > "subagent:".length) {
      const type = entry.slice("subagent:".length);
      if (!types.includes(type)) types.push(type);
    } else return { kind: "refused", reason: `unknown audience entry '${entry}'` };
  }
  const hasHelper = hasAnyHelper || types.length > 0;
  if (mode === "dynamic" && hasMain) {
    return { kind: "refused", reason: "mode: dynamic with main: its outlet is retired; choose inject user-prompt or launch by hand" };
  }
  if (delivery === "skill" && hasHelper) {
    return { kind: "refused", reason: "delivery: skill with a subagent: entry: on-demand admits no other timing; split it into an on-demand and a subagent-start fragment by hand" };
  }
  if (delivery === "skill" && !hasMain) return { kind: "refused", reason: "delivery: skill without main in audience" };

  const inject: string[] = [];
  if (hasMain) inject.push(delivery === "skill" ? "on-demand" : "launch");
  if (hasHelper) inject.push("subagent-start");
  const agents = hasHelper && !hasAnyHelper ? types : undefined;
  return { kind: "migrate", inject, ...(agents !== undefined ? { agents } : {}), old: describeOld(raw) };
}

function flowList(values: readonly string[]): string {
  return `[${values.map((v) => (/^[\w.-]+$/.test(v) ? v : JSON.stringify(v))).join(", ")}]`;
}

function describeNew(inject: readonly string[], agents: readonly string[] | undefined): string {
  return `inject: ${flowList(inject)}${agents !== undefined ? `, agents: ${flowList(agents)}` : ""}`;
}

/** Line index -> top-level key owning it (continuation lines belong to the preceding key). */
function ownerKeys(lines: readonly string[]): (string | null)[] {
  let current: string | null = null;
  return lines.map((line) => {
    const match = TOP_LEVEL_KEY.exec(line);
    if (match !== null) current = match[1] ?? null;
    return current;
  });
}

type RewriteResult = { readonly kind: "rewritten"; readonly text: string; readonly old: string; readonly next: string } | Exclude<OldFrontmatterMapping, { kind: "migrate" }>;

/** YAML text of frontmatter lines with the CR of a CRLF file dropped (a lone CR inside a flow list breaks the parser). */
function yamlText(lines: readonly string[]): string {
  return lines.map((line) => line.replace(/\r$/, "")).join("\n");
}

/** Pure: decide what one file's text becomes. Never throws. */
function rewriteFragmentText(text: string): RewriteResult {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const lines = text.slice(bom.length).split("\n");
  if (lines[0]?.trimEnd() !== "---") return { kind: "refused", reason: "no frontmatter (file must start with ---)" };
  const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === "---");
  if (close < 0) return { kind: "refused", reason: "frontmatter is not closed by a --- line" };
  const fm = lines.slice(1, close);

  let raw: unknown;
  try {
    raw = parseYaml(yamlText(fm));
  } catch (e) {
    return { kind: "refused", reason: `frontmatter is not valid YAML (${e instanceof Error ? e.message : String(e)})` };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { kind: "refused", reason: "frontmatter is not a YAML mapping" };

  const mapping = mapOldFrontmatter(raw as Record<string, unknown>);
  if (mapping.kind !== "migrate") return mapping;

  const owners = ownerKeys(fm);
  const titleLast = owners.lastIndexOf("title");
  if (titleLast < 0) return { kind: "refused", reason: "no title: line to place inject after" };
  const eolSuffix = fm[titleLast]?.endsWith("\r") === true ? "\r" : "";
  const inserted = [`inject: ${flowList(mapping.inject)}${eolSuffix}`];
  if (mapping.agents !== undefined) inserted.push(`agents: ${flowList(mapping.agents)}${eolSuffix}`);

  const kept: string[] = [];
  fm.forEach((line, i) => {
    const owner = owners[i];
    if (owner !== null && owner !== undefined && (OLD_KEYS as readonly string[]).includes(owner)) return;
    kept.push(line);
    if (i === titleLast) kept.push(...inserted);
  });

  const next = bom + ["---" + (lines[0]?.endsWith("\r") === true ? "\r" : ""), ...kept, ...lines.slice(close)].join("\n");
  const check = FragmentFrontmatterSchema.safeParse(parseYaml(yamlText(kept)));
  if (!check.success) {
    const detail = check.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { kind: "refused", reason: `migrated frontmatter would be invalid (${detail})` };
  }
  return { kind: "rewritten", text: next, old: mapping.old, next: describeNew(mapping.inject, mapping.agents) };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function migrateOneFile(deps: MigrateFragmentsDeps, path: string, apply: boolean): Promise<FlowResult<FragmentFileOutcome>> {
  const original = await deps.fs.readFile(path);
  if (original === null) return ok({ kind: "refused", path, reason: "file could not be read" });
  const readHash = sha256(original);
  const rewritten = rewriteFragmentText(original);
  if (rewritten.kind === "unchanged") return ok({ kind: "unchanged", path });
  if (rewritten.kind === "refused") return ok({ kind: "refused", path, reason: rewritten.reason });
  const migrated: FragmentFileOutcome = { kind: "migrated", path, old: rewritten.old, next: rewritten.next };
  if (!apply) return ok(migrated);

  if (deps.beforeWrite !== undefined) await deps.beforeWrite(path);
  // reason: hash precondition — a writer that touched the file after our read wins; we never overwrite its bytes.
  const current = await deps.fs.readFile(path);
  if (current === null || sha256(current) !== readHash) return ok({ kind: "conflict", path });
  try {
    await deps.fs.writeFile(path, rewritten.text);
  } catch (e) {
    return err({ code: "WRITE_FAILED", path, message: e instanceof Error ? e.message : String(e) });
  }
  return ok(migrated);
}

/**
 * Preview or apply the migration over the given fragment directories.
 *
 * @param deps File ports (+ optional test seam).
 * @param opts `layers` to walk (in order), `apply` false = preview (reads only).
 * @returns ok(report) with one outcome per `*.md` file; err only when a write failed for an IO reason.
 * @example
 *   const r = await migrateFragments({ fs }, { layers: [{ scope: "user", dir: "/h/.config/lore/context" }], apply: true });
 */
export async function migrateFragments(
  deps: MigrateFragmentsDeps,
  opts: { readonly layers: readonly FragmentLayerDir[]; readonly apply: boolean },
): Promise<FlowResult<MigrateFragmentsReport>> {
  const outcomes: FragmentFileOutcome[] = [];
  for (const layer of opts.layers) {
    const names = (await deps.fs.listDir(layer.dir)).filter((n) => n.endsWith(".md")).sort();
    for (const name of names) {
      const path = `${layer.dir.endsWith("/") ? layer.dir.slice(0, -1) : layer.dir}/${name}`;
      const outcome = await migrateOneFile(deps, path, opts.apply);
      if (!outcome.ok) return outcome;
      outcomes.push(outcome.value);
    }
  }
  const exitCode = outcomes.some((o) => o.kind === "conflict") ? MIGRATE_EXIT_CONFLICT : outcomes.some((o) => o.kind === "refused") ? MIGRATE_EXIT_REFUSED : 0;
  return ok({ outcomes, exitCode });
}

/** One report line for a file outcome. */
export function formatOutcomeLine(outcome: FragmentFileOutcome): string {
  switch (outcome.kind) {
    case "migrated":
      return `${outcome.path}: ${outcome.old} -> ${outcome.next}`;
    case "unchanged":
      return `${outcome.path}: unchanged`;
    case "refused":
      return `${outcome.path}: refused: ${outcome.reason}`;
    case "conflict":
      return `${outcome.path}: conflict: changed while migrating, left untouched; re-run`;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/** All lines of a report, in order. */
export function formatOutcomeLines(outcomes: readonly FragmentFileOutcome[]): string[] {
  return outcomes.map(formatOutcomeLine);
}
