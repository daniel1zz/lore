/**
 * `lore fragments render | check` flows — read-only, hook-facing context-fragment verbs.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D3, D6, D7, D12, D13).
 *
 * Public surface:
 *   - runFragmentsRender(deps, opts) — the additionalContext string one hook outlet emits
 *     (dynamic block, plus the D7 stale-Z1 notice at session start).
 *   - runFragmentsCheck(deps) — every outlet × agent type vs caps, Z1 drift, override refusal
 *     and Claude Code `language` drift; findings, never throws.
 *   - composeSessionStart(parts) / buildHookBanner(error) — pure assembly helpers (exported for tests).
 *   - FragmentsFlowDeps, FragmentsFlowError, FRAGMENTS_STALE_MARKER.
 *
 * Invariants:
 *   - Read-only: this module has NO write port. Hooks never write CLAUDE.md (D7, D13).
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
import { buildFragmentsSection, FRAGMENTS_SECTION_ID } from "../service/context-fragments/section.js";
import { checkOverrides, selectFragments } from "../service/context-fragments/select.js";
import { parseManagedSections } from "../service/context-projection.js";

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
  /** Absolute path of the project CLAUDE.md whose Z1 `fragments` section is compared. */
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

// ─── Z1 drift (D7) ──────────────────────────────────────────────────────────

/** Outcome of comparing the project CLAUDE.md `fragments` section with a fresh render. */
export interface Z1Drift {
  readonly drifted: boolean;
  /** Fresh static main fragments whose body is absent from the stored section (all of them when the section is missing). */
  readonly changed: readonly Fragment[];
}

/**
 * Compare the stored project CLAUDE.md `fragments` section against a fresh `claude-md:project` render.
 * No CLAUDE.md, or no section while the fresh render is empty, is NOT drift (nothing to be stale against).
 */
async function detectProjectZ1Drift(deps: FragmentsFlowDeps, all: readonly Fragment[]): Promise<FlowResult<Z1Drift>> {
  const content = await deps.fs.readFile(deps.projectClaudeMdPath);
  if (content === null) return { ok: true, value: { drifted: false, changed: [] } };

  const selected = selectSafely(all, deps, "claude-md:project", undefined);
  if (!selected.ok) return selected;
  const text = renderSafely(selected.value, "claude-md:project");
  if (!text.ok) return text;

  const parsed = parseManagedSections(content);
  if (!parsed.ok) {
    const message = "message" in parsed.error ? parsed.error.message : parsed.error.code;
    return { ok: false, error: { code: "VALIDATION_ERROR", message: `${deps.projectClaudeMdPath}: ${message}` } };
  }

  const stored = parsed.value.sections.find((section) => section.id === FRAGMENTS_SECTION_ID)?.body;
  const freshBody = buildFragmentsSection({ text: text.value, chars: text.value.length, fragmentIds: [] }, "project").body;
  const drifted = stored === undefined ? selected.value.length > 0 : stored.trimEnd() !== freshBody.trimEnd();
  const changed = drifted ? selected.value.filter((fragment) => stored === undefined || !stored.includes(fragment.body)) : [];
  return { ok: true, value: { drifted, changed } };
}

// ─── render ─────────────────────────────────────────────────────────────────

/** Inputs of the pure session-start assembly. */
export interface SessionStartParts {
  /** Dynamic main fragment block (already within SESSION_FRAGMENT_CAP). */
  readonly block: string;
  /** Changed static fragments (empty when Z1 is fresh). */
  readonly changed: readonly { readonly id: string; readonly body: string }[];
  readonly stale: boolean;
}

const NOTICE_LINE =
  `${FRAGMENTS_STALE_MARKER}: the project CLAUDE.md fragments section differs from a fresh render. ` +
  "Run `lore context refresh` to update it; the changed content follows.";

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

  const drift = await detectProjectZ1Drift(deps, discovered.value);
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
  | "z1_drift"
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
  "claude-md:project",
  "claude-md:user",
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

    const drift = await detectProjectZ1Drift(deps, all);
    if (!drift.ok) {
      findings.push({ kind: "z1_drift", ...drift.error });
    } else if (drift.value.drifted) {
      findings.push({
        kind: "z1_drift",
        code: "VALIDATION_ERROR",
        message:
          `${deps.projectClaudeMdPath}: the "${FRAGMENTS_SECTION_ID}" managed section differs from a fresh render` +
          (drift.value.changed.length > 0
            ? ` (changed: ${drift.value.changed.map((fragment) => fragment.frontmatter.id).join(", ")})`
            : "") +
          ". Run `lore context refresh`.",
      });
    }
  }

  findings.push(...(await checkLanguageDrift(deps)));

  return { ok: findings.length === 0, outlets: CHECK_OUTLETS, agentTypes, checks, findings };
}
