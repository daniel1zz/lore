/**
 * `lore fragments render | check` flows — read-only, hook-facing context-fragment verbs.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D3, D6, D7, D12, D13).
 *
 * Public surface:
 *   - runFragmentsRender(deps, opts) — the additionalContext string one hook outlet emits
 *     (dynamic block, plus the D7 stale-rules-file notice at session start).
 *   - runFragmentsCheck(deps) — every outlet × agent type vs caps, lore rules-file drift, override refusal
 *     and Claude Code `language` drift; findings, never throws.
 *   - composeSessionStart(parts) / buildHookBanner(error) — pure assembly helpers (exported for tests).
 *   - FragmentsFlowDeps, FragmentsFlowError, FRAGMENTS_STALE_MARKER.
 *
 * Invariants:
 *   - Read-only: this module has NO write port. Hooks never write rules files or CLAUDE.md (D7, D13, D15).
 *   - Every failure carries a stable `code` (VALIDATION_ERROR | BUDGET_EXCEEDED); nothing is
 *     swallowed — render returns it for the D12 banner, check reports it as a finding.
 *   - Session-start output (block + notice + changed bodies/ids) is always <= HOOK_STRING_CAP.
 *   - All paths in `deps` are absolute; `deps.fs` is read with them verbatim.
 *   - Layers are discovered ONE AT A TIME so selection / checkOverrides see un-merged
 *     fragments (discoverFragments merges by id, which would hide a cross-layer override).
 *
 * Side-effect class: read-only IO through the injected FsReadPort.
 */
import { z } from "zod";
import {
  HOOK_STRING_CAP,
  LANGUAGE_NAMES,
  NOTICE_RESERVE,
  resolveContextConfig,
  type ContextConfigLayer,
  type Fragment,
  type FsReadPort,
  type OutletId,
} from "@lore/core";
import { discoverFragments, type FragmentRoots } from "../service/context-fragments/discover.js";
import { renderOutlet } from "../service/context-fragments/render.js";
import { isLoreRulesFileName, renderRulesFile } from "../service/context-fragments/section.js";
import { checkOverrides, selectFragments } from "../service/context-fragments/select.js";

/** Fixed marker the D7 backstop notice starts with (AC-CF-12). */
export const FRAGMENTS_STALE_MARKER = "lore:stale-managed-context";

/** A sentinel layer root that resolves to an empty layer on every FsReadPort. */
const EMPTY_LAYER_ROOT = "\u0000lore-no-layer";

/** Hook outlets `render` serves. */
export const HOOK_OUTLETS = ["hook:session-start", "hook:subagent-start"] as const;
export type HookOutlet = (typeof HOOK_OUTLETS)[number];

/** Why a flow step failed. `code` is what the D12 banner and `check` findings carry. */
export interface FragmentsFlowError {
  readonly code: "VALIDATION_ERROR" | "BUDGET_EXCEEDED";
  readonly message: string;
}

type FlowResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: FragmentsFlowError };

/** Where a Claude Code `language` setting lives and which config layer projects into it. */
export interface LanguageSettingsTarget {
  readonly scope: "user" | "project";
  /** Absolute path of the Claude Code settings file. */
  readonly path: string;
}

/** Everything the flows need, resolved by the adapter (paths absolute, configs already parsed). */
export interface FragmentsFlowDeps {
  readonly fs: FsReadPort;
  readonly roots: FragmentRoots;
  readonly globalConfig: ContextConfigLayer;
  readonly projectConfig: ContextConfigLayer;
  /**
   * Absolute path of the project CLAUDE.md; the project's lore rules files live in
   * `dirname(projectClaudeMdPath)/.claude/rules` (D15) and are what drift is measured against.
   */
  readonly projectClaudeMdPath: string;
  /** Absolute path of the shipped agents directory (`<assetsRoot>/agents`). */
  readonly agentsDir: string;
  readonly userSettings: LanguageSettingsTarget;
  readonly projectSettings: LanguageSettingsTarget;
}

// ─── discovery / selection helpers ──────────────────────────────────────────

const LAYERS = ["shipped", "user", "project"] as const;

async function discoverAllLayers(deps: FragmentsFlowDeps): Promise<FlowResult<Fragment[]>> {
  const all: Fragment[] = [];
  for (const layer of LAYERS) {
    const roots: FragmentRoots = {
      shipped: EMPTY_LAYER_ROOT,
      user: EMPTY_LAYER_ROOT,
      project: EMPTY_LAYER_ROOT,
      [layer]: deps.roots[layer],
    };
    const found = await discoverFragments(deps.fs, roots);
    if (!found.ok) return { ok: false, error: { code: "VALIDATION_ERROR", message: found.error.message } };
    all.push(...found.value);
  }
  return { ok: true, value: all };
}

/** `selectFragments` throws on an unregistered `when` key; surface it as a typed error. */
function selectSafely(
  all: readonly Fragment[],
  deps: FragmentsFlowDeps,
  outlet: OutletId,
  agentType: string | undefined,
): FlowResult<Fragment[]> {
  try {
    const config = resolveContextConfig(deps.globalConfig, deps.projectConfig, outlet);
    return { ok: true, value: selectFragments(all, { outlet, ...(agentType !== undefined ? { agentType } : {}), config }) };
  } catch (cause) {
    return {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: cause instanceof Error ? cause.message : String(cause) },
    };
  }
}

function renderSafely(selected: readonly Fragment[], outlet: OutletId): FlowResult<string> {
  const rendered = renderOutlet(selected, outlet);
  if (!rendered.ok) {
    // renderOutlet's error type is being moved to the shared LoreError; read it generically.
    const { code, message } = rendered.error as { code: string; message: string };
    return { ok: false, error: { code: code === "BUDGET_EXCEEDED" ? "BUDGET_EXCEEDED" : "VALIDATION_ERROR", message } };
  }
  return { ok: true, value: rendered.value.text };
}

// ─── rules-file drift (D7, D15) ─────────────────────────────────────────────

/** `<project>/.claude/rules`, derived from the project CLAUDE.md path (POSIX-absolute paths, like the rest of `deps`). */
function projectRulesDir(deps: FragmentsFlowDeps): string {
  const path = deps.projectClaudeMdPath;
  const slash = path.lastIndexOf("/");
  const root = slash <= 0 ? "" : path.slice(0, slash);
  return `${root}/.claude/rules`;
}

/** Outcome of comparing the project's lore rules files with a fresh `rules:project` render. */
export interface RulesDrift {
  readonly drifted: boolean;
  /** Fresh static main fragments whose rules file is missing or differs from the fresh render. */
  readonly changed: readonly Fragment[];
  /** One entry per drifted file (`lore-<id>.md` + why), for `check` findings. */
  readonly files: readonly { readonly fileName: string; readonly reason: "missing" | "changed" | "extra" }[];
}

/**
 * Compare the project's `lore-*.md` rules files against a fresh `rules:project` render: a winning
 * static main fragment whose file is missing or differs is drift, and so is a `lore-*.md` file for
 * a fragment that is no longer selected. Non-`lore-` files are never consulted.
 */
async function detectProjectRulesDrift(deps: FragmentsFlowDeps, all: readonly Fragment[]): Promise<FlowResult<RulesDrift>> {
  const selected = selectSafely(all, deps, "rules:project", undefined);
  if (!selected.ok) return selected;

  const present = (await deps.fs.listDir(projectRulesDir(deps))).filter(isLoreRulesFileName).sort();
  // reason: a project that was never put under `lore context` management (no CLAUDE.md, no lore rules
  // file yet) has nothing to be stale against - the same "no CLAUDE.md is not drift" rule the old Z1
  // check had - so the SHIPPED-only baseline of a fresh `lore init` stays clean (AC-CF-4 e2e control).
  // A project- or user-layer static fragment is explicit local intent, so its missing file is always drift.
  const adopted =
    present.length > 0 ||
    (await deps.fs.exists(deps.projectClaudeMdPath)) ||
    selected.value.some((fragment) => fragment.layer !== "shipped");
  if (!adopted) return { ok: true, value: { drifted: false, changed: [], files: [] } };

  const files: { fileName: string; reason: "missing" | "changed" | "extra" }[] = [];
  const changed: Fragment[] = [];
  const expectedNames = new Set<string>();

  for (const fragment of selected.value) {
    const rendered = renderRulesFile(fragment);
    if (!rendered.ok) return { ok: false, error: { code: "VALIDATION_ERROR", message: rendered.error.message } };
    expectedNames.add(rendered.value.fileName);
    const stored = await deps.fs.readFile(`${projectRulesDir(deps)}/${rendered.value.fileName}`);
    if (stored === null) {
      files.push({ fileName: rendered.value.fileName, reason: "missing" });
      changed.push(fragment);
    } else if (stored !== rendered.value.content) {
      files.push({ fileName: rendered.value.fileName, reason: "changed" });
      changed.push(fragment);
    }
  }

  for (const name of present) {
    if (!expectedNames.has(name)) files.push({ fileName: name, reason: "extra" });
  }

  return { ok: true, value: { drifted: files.length > 0, changed, files } };
}

// ─── render ─────────────────────────────────────────────────────────────────

/** Inputs of the pure session-start assembly. */
export interface SessionStartParts {
  /** Dynamic main fragment block (already within SESSION_FRAGMENT_CAP). */
  readonly block: string;
  /** Changed static fragments (empty when the rules files are fresh). */
  readonly changed: readonly { readonly id: string; readonly body: string }[];
  readonly stale: boolean;
}

const NOTICE_LINE =
  `${FRAGMENTS_STALE_MARKER}: the project .claude/rules/lore-*.md files differ from a fresh render. ` +
  "Run `lore context refresh` to update them; the changed content follows.";

function joinNonEmpty(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join("\n\n");
}

/**
 * Assemble the session-start string: block, then (when stale) the notice and the changed
 * bodies if they fit the remaining budget, else the changed ids with `+N more`.
 * Result length is always <= HOOK_STRING_CAP.
 */
export function composeSessionStart(parts: SessionStartParts): string {
  if (!parts.stale) return parts.block;

  const notice = NOTICE_LINE.length <= NOTICE_RESERVE ? NOTICE_LINE : NOTICE_LINE.slice(0, NOTICE_RESERVE);
  const head = joinNonEmpty([parts.block, notice]);
  if (parts.changed.length === 0) return head;

  const bodies = parts.changed.map((fragment) => fragment.body).join("\n\n");
  const withBodies = `${head}\n\n${bodies}`;
  if (withBodies.length <= HOOK_STRING_CAP) return withBodies;

  const prefix = `${head}\n\nChanged fragment ids: `;
  const room = HOOK_STRING_CAP - prefix.length;
  if (room <= 0) return head;
  const ids = parts.changed.map((fragment) => fragment.id);
  const shown: string[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const remaining = ids.length - i - 1;
    const tail = remaining > 0 ? `, +${remaining} more` : "";
    const candidate = [...shown, ids[i] as string].join(", ");
    // Always leave room for a `+N more` tail covering what would still be hidden.
    if (candidate.length + tail.length > room) break;
    shown.push(ids[i] as string);
  }
  const hidden = ids.length - shown.length;
  const list = shown.join(", ") + (hidden > 0 ? `${shown.length > 0 ? ", " : ""}+${hidden} more` : "");
  return `${prefix}${list}`.length <= HOOK_STRING_CAP ? `${prefix}${list}` : head;
}

/** Banner ceiling (D6/D12): the banner REPLACES the block and is at most NOTICE_RESERVE chars. */
export function buildHookBanner(error: FragmentsFlowError): string {
  const banner = `lore fragments ${error.code}: ${error.message}`;
  return banner.length <= NOTICE_RESERVE ? banner : `${banner.slice(0, NOTICE_RESERVE - 3)}...`;
}

/** One fragment's contribution, for `--explain`. */
export interface ExplainRow {
  readonly id: string;
  readonly layer: Fragment["layer"];
  readonly chars: number;
}

export interface FragmentsRenderOptions {
  readonly outlet: HookOutlet;
  readonly agentType?: string;
}

export interface FragmentsRenderOutput {
  readonly additionalContext: string;
  readonly explain: readonly ExplainRow[];
}

/**
 * Render one hook outlet.
 *
 * @returns ok with the additionalContext string, or the typed error the adapter turns into the D12 banner.
 */
export async function runFragmentsRender(
  deps: FragmentsFlowDeps,
  opts: FragmentsRenderOptions,
): Promise<FlowResult<FragmentsRenderOutput>> {
  const discovered = await discoverAllLayers(deps);
  if (!discovered.ok) return discovered;

  const selected = selectSafely(discovered.value, deps, opts.outlet, opts.agentType);
  if (!selected.ok) return selected;
  const block = renderSafely(selected.value, opts.outlet);
  if (!block.ok) return block;

  const explain = selected.value.map((fragment) => ({
    id: fragment.frontmatter.id,
    layer: fragment.layer,
    chars: fragment.body.length,
  }));

  if (opts.outlet === "hook:subagent-start") {
    return { ok: true, value: { additionalContext: block.value, explain } };
  }

  const drift = await detectProjectRulesDrift(deps, discovered.value);
  if (!drift.ok) return drift;
  const additionalContext = composeSessionStart({
    block: block.value,
    stale: drift.value.drifted,
    changed: drift.value.changed.map((fragment) => ({ id: fragment.frontmatter.id, body: fragment.body })),
  });
  return { ok: true, value: { additionalContext, explain } };
}

// ─── check ──────────────────────────────────────────────────────────────────

/** Name of the audience-wildcard "agent type" every check run includes. */
export const WILDCARD_AGENT_TYPE = "subagent:*";

export type FindingKind =
  | "discovery"
  | "override_refusal"
  | "cap"
  | "selection"
  | "rules_drift"
  | "language_drift"
  | "language_unknown"
  | "settings_unreadable"
  | "no_agent_types";

export interface CheckFinding {
  readonly kind: FindingKind;
  readonly code: FragmentsFlowError["code"];
  readonly message: string;
}

export interface CheckRow {
  readonly outlet: OutletId;
  /** Agent type for `hook:subagent-start`; null for outlets that ignore it. */
  readonly agentType: string | null;
  readonly chars: number;
  readonly fragmentIds: readonly string[];
}

export interface FragmentsCheckReport {
  readonly ok: boolean;
  readonly outlets: readonly OutletId[];
  /** Every agent type enumerated (`<assetsRoot>/agents/*.md` names + `subagent:*`). */
  readonly agentTypes: readonly string[];
  readonly checks: readonly CheckRow[];
  readonly findings: readonly CheckFinding[];
}

const CHECK_OUTLETS: readonly OutletId[] = [
  "rules:project",
  "rules:user",
  "hook:session-start",
  "hook:subagent-start",
];

const SettingsLanguageSchema = z.object({ language: z.string().optional() }).passthrough();

async function enumerateAgentTypes(deps: FragmentsFlowDeps): Promise<string[]> {
  const names = (await deps.fs.listDir(deps.agentsDir))
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -".md".length))
    .sort();
  return [...names, WILDCARD_AGENT_TYPE];
}

async function checkLanguageDrift(deps: FragmentsFlowDeps): Promise<CheckFinding[]> {
  const findings: CheckFinding[] = [];
  const targets = [
    { target: deps.userSettings, code: deps.globalConfig.context?.language, layer: "global" },
    { target: deps.projectSettings, code: deps.projectConfig.context?.language, layer: "project" },
  ] as const;

  for (const { target, code, layer } of targets) {
    if (code === undefined) continue;
    const expected = (LANGUAGE_NAMES as Readonly<Record<string, string>>)[code];
    if (expected === undefined) {
      findings.push({
        kind: "language_unknown",
        code: "VALIDATION_ERROR",
        message: `${layer} context.language "${code}" is not a known code (known: ${Object.keys(LANGUAGE_NAMES).join(", ")})`,
      });
      continue;
    }
    const raw = await deps.fs.readFile(target.path);
    if (raw === null) continue; // no settings file: nothing is set, so nothing disagrees
    let actual: string | undefined;
    try {
      actual = SettingsLanguageSchema.parse(JSON.parse(raw)).language;
    } catch (cause) {
      findings.push({
        kind: "settings_unreadable",
        code: "VALIDATION_ERROR",
        message: `${target.path} is not a readable Claude Code settings file: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
      continue;
    }
    if (actual !== undefined && actual !== expected) {
      findings.push({
        kind: "language_drift",
        code: "VALIDATION_ERROR",
        message:
          `language drift: ${target.path} has language "${actual}" but ${layer} context.language "${code}" projects to "${expected}". ` +
          "Re-run `lore setup` to re-project it.",
      });
    }
  }
  return findings;
}

/**
 * Check every outlet × agent type. Never throws; every problem is a finding, and `ok` is
 * true only when there are none.
 */
export async function runFragmentsCheck(deps: FragmentsFlowDeps): Promise<FragmentsCheckReport> {
  const findings: CheckFinding[] = [];
  const checks: CheckRow[] = [];
  const agentTypes = await enumerateAgentTypes(deps);
  if (agentTypes.length <= 1) {
    findings.push({
      kind: "no_agent_types",
      code: "VALIDATION_ERROR",
      message: `no agent files found in ${deps.agentsDir}; the agent-type set to check is empty`,
    });
  }

  const discovered = await discoverAllLayers(deps);
  if (!discovered.ok) {
    findings.push({ kind: "discovery", ...discovered.error });
  } else {
    const all = discovered.value;
    const overrides = checkOverrides(all, { global: deps.globalConfig, project: deps.projectConfig });
    if (!overrides.ok) {
      findings.push({ kind: "override_refusal", code: "VALIDATION_ERROR", message: overrides.error.message });
    }

    for (const outlet of CHECK_OUTLETS) {
      const types = outlet === "hook:subagent-start" ? agentTypes : [null];
      for (const agentType of types) {
        const typeArg = agentType === null || agentType === WILDCARD_AGENT_TYPE ? undefined : agentType;
        const selected = selectSafely(all, deps, outlet, typeArg);
        if (!selected.ok) {
          findings.push({ kind: "selection", ...selected.error });
          continue;
        }
        const rendered = renderSafely(selected.value, outlet);
        if (!rendered.ok) {
          const where = agentType === null ? outlet : `${outlet} (${agentType})`;
          findings.push({ kind: "cap", code: rendered.error.code, message: `${where}: ${rendered.error.message}` });
          continue;
        }
        checks.push({
          outlet,
          agentType,
          chars: rendered.value.length,
          fragmentIds: selected.value.map((fragment) => fragment.frontmatter.id),
        });
      }
    }

    const drift = await detectProjectRulesDrift(deps, all);
    if (!drift.ok) {
      findings.push({ kind: "rules_drift", ...drift.error });
    } else {
      for (const file of drift.value.files) {
        findings.push({
          kind: "rules_drift",
          code: "VALIDATION_ERROR",
          message:
            `${projectRulesDir(deps)}/${file.fileName}: lore rules file is ${file.reason} versus a fresh render` +
            ". Run `lore context refresh`.",
        });
      }
    }
  }

  findings.push(...(await checkLanguageDrift(deps)));

  return { ok: findings.length === 0, outlets: CHECK_OUTLETS, agentTypes, checks, findings };
}
