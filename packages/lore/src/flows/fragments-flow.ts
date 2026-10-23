/**
 * `lore fragments render | check` flows — read-only, hook-facing context-fragment verbs.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D3, D6, D7, D12, D13);
 * spec-fragment-injection-timing-one-inject-enum-a-per-turn (hook:user-prompt, `inject` routing).
 *
 * Public surface:
 *   - runFragmentsRender(deps, opts) — the additionalContext string a hook outlet emits
 *     (`hook:subagent-start`, `hook:user-prompt`). `hook:session-start` is retired (BR-912): its stale-rules notice (BR-909,
 *     BR-910) is gone and the upgrade reminder lives in session-start-resume.mjs.
 *   - runFragmentsCheck(deps) — every outlet × agent type vs caps, lore rules-file and project skill drift,
 *     override refusal, Claude Code `language` drift, plus the rule-store findings (duplicate_line,
 *     selection_unknown_id, selection_in_config, skill_collision; spec-rule-store-... Scope 6) and the
 *     `shipped_user_prompt` finding (a shipped fragment may not name the per-turn timing);
 *     findings, never throws. Any finding makes `ok` false (the adapter maps that to exit 4).
 *   - buildHookBanner(error) — pure banner assembly (exported for tests).
 *   - FragmentsFlowDeps, FragmentsFlowError.
 *
 * Invariants:
 *   - Read-only: this module has NO write port. Hooks never write rules files or CLAUDE.md (D7, D13, D15).
 *   - Every failure carries a stable `code` (VALIDATION_ERROR | BUDGET_EXCEEDED); nothing is
 *     swallowed — render returns it for the D12 banner, check reports it as a finding.
 *   - Helper-start output is always <= SUBAGENT_FRAGMENT_CAP and per-turn output <= USER_PROMPT_FRAGMENT_CAP
 *     (render refuses an over-cap block, BR-907).
 *   - The per-turn render reaches the main session, so it runs `checkOverrides` and fails on an illegal
 *     override (helper start does not, BR-911).
 *   - All paths in `deps` are absolute; `deps.fs` is read with them verbatim.
 *   - Layers are discovered ONE AT A TIME so selection / checkOverrides see un-merged
 *     fragments (discoverFragments merges by id, which would hide a cross-layer override).
 *
 * Side-effect class: read-only IO through the injected FsReadPort.
 */
import { z } from "zod";
import {
  HOOK_BANNER_CAP,
  LANGUAGE_NAMES,
  resolveContextConfig,
  type ContextConfigLayer,
  type Fragment,
  type FsReadPort,
  type OutletId,
} from "@lore/core";
import { discoverFragments, type FragmentRoots } from "../service/context-fragments/discover.js";
import { renderOutlet } from "../service/context-fragments/render.js";
import { expandFragments } from "../service/context-fragments/expand.js";
import { LORE_CONTEXT_VARIABLES, configVariableValues } from "../service/context-variables-registry.js";
import { findDuplicateLines, type ReadingGroup } from "../service/context-fragments/duplicates.js";
import {
  isLoreRulesFileName,
  parseSkillFile,
  renderRulesFile,
  renderSkillFile,
  SKILL_DIR_PREFIX,
  SKILL_FILE_NAME,
  skillDirName,
} from "../service/context-fragments/section.js";
import { checkOverrides, selectFragments } from "../service/context-fragments/select.js";
import {
  emptySelection,
  parseSelection,
  selectionToLayer,
  SELECTION_FILE,
  type Selection,
  type SelectionScope,
} from "../service/context-fragments/selection.js";

/** Hook outlets `render` serves (`hook:session-start` is retired, BR-912). */
export const HOOK_OUTLETS = ["hook:subagent-start", "hook:user-prompt"] as const;
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
  /** Absolute path of the user-scope agents directory (`<claude dir>/agents`); its `*.md` names are agent types too. */
  readonly userAgentsDir: string;
  /** Absolute path of the project agents directory (`<project>/.claude/agents`); its `*.md` names are agent types too. */
  readonly projectAgentsDir: string;
  /** Absolute path of the user-scope rules directory (`<claude dir>/rules`), where `lore context refresh --scope user` writes `lore-*.md`. */
  readonly userRulesDir: string;
  readonly userSettings: LanguageSettingsTarget;
  readonly projectSettings: LanguageSettingsTarget;
  /**
   * Raw text of the project / user `selection.yaml` (BR-1060). `null` or absent = no such file =
   * nothing disabled (an absent file is a legitimate state, not a missing input). The adapter reads the
   * files; the flow never touches env or the user config dir.
   */
  readonly userSelectionText?: string | null;
  readonly projectSelectionText?: string | null;
  /**
   * Skill directory names shipped with lore (`lore-*` entries under the embedded manifest's `skills/`),
   * supplied by the adapter. A skill fragment whose `lore-<id>` equals one is a `skill_collision` (BR-1064).
   * REQUIRED: a missing list would silently disable the collision check (lore forbids silent fallbacks).
   */
  readonly shippedSkillNames: readonly string[];
}

// ─── discovery / selection helpers ──────────────────────────────────────────

/** A selection problem found while folding `selection.yaml` into the config layers. */
interface SelectionProblem {
  readonly kind: "selection" | "selection_in_config";
  readonly message: string;
}

interface AppliedSelection {
  /** `deps` whose config layers carry the selection's disable lists (what every selectFragments call must use). */
  readonly deps: FragmentsFlowDeps;
  readonly problems: readonly SelectionProblem[];
  readonly selections: Readonly<Record<SelectionScope, Selection>>;
}

/**
 * Fold both scopes' `selection.yaml` into the config layers (BR-1062): the selection file, not the
 * settings file, owns `fragments.disable`. A bad selection file or a settings-file disable list is a
 * problem (never thrown); that scope then keeps its un-folded layer so checking can continue.
 */
function applySelection(deps: FragmentsFlowDeps): AppliedSelection {
  const problems: SelectionProblem[] = [];
  const scopes = [
    { scope: "user", text: deps.userSelectionText ?? null, layer: deps.globalConfig, source: `<user config dir>/${SELECTION_FILE.user}` },
    { scope: "project", text: deps.projectSelectionText ?? null, layer: deps.projectConfig, source: SELECTION_FILE.project },
  ] as const;
  const layers: Record<SelectionScope, ContextConfigLayer> = { user: deps.globalConfig, project: deps.projectConfig };
  const selections: Record<SelectionScope, Selection> = { user: emptySelection(), project: emptySelection() };

  for (const { scope, text, layer, source } of scopes) {
    if (text !== null) {
      const parsed = parseSelection(text, source);
      if (!parsed.ok) {
        problems.push({ kind: "selection", message: parsed.error.message });
        continue;
      }
      selections[scope] = parsed.value;
    }
    const folded = selectionToLayer(selections[scope], layer, scope);
    if (!folded.ok) {
      problems.push({ kind: "selection_in_config", message: folded.error.message });
      continue;
    }
    layers[scope] = folded.value;
  }
  return {
    deps: { ...deps, globalConfig: layers.user, projectConfig: layers.project },
    problems,
    selections,
  };
}

const LAYERS = ["shipped", "user", "project"] as const;

async function discoverAllLayers(deps: FragmentsFlowDeps): Promise<FlowResult<Fragment[]>> {
  const all: Fragment[] = [];
  for (const layer of LAYERS) {
    const roots: FragmentRoots = { [layer]: deps.roots[layer] };
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
    const selected = selectFragments(all, { outlet, ...(agentType !== undefined ? { agentType } : {}), config });
    // reason: the ONE expansion point of this flow - render, check (caps, duplicates), rules/skills drift all read
    // the selection through here, so they measure the same expanded text (D10).
    const expanded = expandFragments(
      selected,
      outlet,
      { invocation: configVariableValues(deps.globalConfig, deps.projectConfig, outlet) },
      LORE_CONTEXT_VARIABLES,
    );
    if (!expanded.ok) {
      const { message } = expanded.error as { message: string };
      return { ok: false, error: { code: "VALIDATION_ERROR", message } };
    }
    return { ok: true, value: [...expanded.value] };
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

/** `<project>/.claude`, derived from the project CLAUDE.md path (POSIX-absolute paths, like the rest of `deps`). */
function projectClaudeDir(deps: FragmentsFlowDeps): string {
  const path = deps.projectClaudeMdPath;
  const slash = path.lastIndexOf("/");
  const root = slash <= 0 ? "" : path.slice(0, slash);
  return `${root}/.claude`;
}

/** `<project>/.claude/rules`. */
function projectRulesDir(deps: FragmentsFlowDeps): string {
  return `${projectClaudeDir(deps)}/rules`;
}

/** `<project>/.claude/skills`. */
function projectSkillsDir(deps: FragmentsFlowDeps): string {
  return `${projectClaudeDir(deps)}/skills`;
}

/** Outcome of comparing the project's lore rules files with a fresh `rules:project` render. */
export interface RulesDrift {
  readonly drifted: boolean;
  /** One entry per drifted file (`lore-<id>.md` + why), for `check` findings. */
  readonly files: readonly { readonly fileName: string; readonly reason: "missing" | "changed" | "extra" }[];
}

/** Where one rules scope lives and which outlet renders it. */
interface RulesScopeTarget {
  readonly outlet: "rules:project" | "rules:user";
  readonly dir: string;
}

/**
 * Whether a scope is already under `lore context` management, so a missing rules file is drift.
 * A switch (not a stored callback) keeps every call site statically nameable.
 */
async function isRulesScopeAdopted(
  deps: FragmentsFlowDeps,
  outlet: RulesScopeTarget["outlet"],
  present: readonly string[],
  selected: readonly Fragment[],
): Promise<boolean> {
  if (present.length > 0) return true;
  switch (outlet) {
    case "rules:project":
      // reason: a project that was never put under `lore context` management (no CLAUDE.md, no lore rules
      // file yet) has nothing to be stale against - the same "no CLAUDE.md is not drift" rule the old Z1
      // check had - so the SHIPPED-only baseline of a fresh `lore init` stays clean (AC-CF-4 e2e control).
      // A project- or user-layer static fragment is explicit local intent, so its missing file is always drift.
      return (await deps.fs.exists(deps.projectClaudeMdPath)) || selected.some((fragment) => fragment.layer !== "shipped");
    case "rules:user":
      // DC2-27: only user-layer fragments reach this outlet and each is explicit local intent.
      return selected.length > 0;
    default: {
      const unreachable: never = outlet;
      throw new Error(`unhandled rules outlet ${String(unreachable)}`);
    }
  }
}

/**
 * Compare a scope's `lore-*.md` rules files against a fresh render of its outlet: a winning
 * static main fragment whose file is missing or differs is drift, and so is a `lore-*.md` file for
 * a fragment that is no longer selected. Non-`lore-` files are never consulted.
 */
async function detectRulesDrift(deps: FragmentsFlowDeps, all: readonly Fragment[], target: RulesScopeTarget): Promise<FlowResult<RulesDrift>> {
  const selected = selectSafely(all, deps, target.outlet, undefined);
  if (!selected.ok) return selected;

  const present = (await deps.fs.listDir(target.dir)).filter(isLoreRulesFileName).sort();
  if (!(await isRulesScopeAdopted(deps, target.outlet, present, selected.value))) return { ok: true, value: { drifted: false, files: [] } };

  const files: { fileName: string; reason: "missing" | "changed" | "extra" }[] = [];
  const expectedNames = new Set<string>();

  for (const fragment of selected.value) {
    const rendered = renderRulesFile(fragment);
    if (!rendered.ok) return { ok: false, error: { code: "VALIDATION_ERROR", message: rendered.error.message } };
    expectedNames.add(rendered.value.fileName);
    const stored = await deps.fs.readFile(`${target.dir}/${rendered.value.fileName}`);
    if (stored === null) {
      files.push({ fileName: rendered.value.fileName, reason: "missing" });
    } else if (stored !== rendered.value.content) {
      files.push({ fileName: rendered.value.fileName, reason: "changed" });
    }
  }

  for (const name of present) {
    if (!expectedNames.has(name)) files.push({ fileName: name, reason: "extra" });
  }

  return { ok: true, value: { drifted: files.length > 0, files } };
}

/** The project scope's drift target (`rules:project` -> `<project>/.claude/rules`). */
function projectRulesTarget(deps: FragmentsFlowDeps): RulesScopeTarget {
  return { outlet: "rules:project", dir: projectRulesDir(deps) };
}

/** The user scope's drift target (`rules:user` -> `<claude dir>/rules`, DC2-27). */
function userRulesTarget(deps: FragmentsFlowDeps): RulesScopeTarget {
  return { outlet: "rules:user", dir: deps.userRulesDir };
}

/** One drifted project skill directory (`lore-<id>` + why), for `check` findings. */
export interface SkillsDriftFile {
  readonly dirName: string;
  readonly reason: "missing" | "changed" | "extra";
}

/**
 * Mirror of `detectProjectRulesDrift` for `<project>/.claude/skills`: a selected `skills:project`
 * fragment whose `lore-<id>/SKILL.md` is missing or differs from `renderSkillFile` is drift, and so is
 * an intact lore-owned skill dir (fingerprinted SKILL.md) for a fragment no longer selected. Dirs
 * without a lore fingerprint (shipped or team skills) are never consulted.
 */
async function detectProjectSkillsDrift(
  deps: FragmentsFlowDeps,
  all: readonly Fragment[],
): Promise<FlowResult<readonly SkillsDriftFile[]>> {
  const selected = selectSafely(all, deps, "skills:project", undefined);
  if (!selected.ok) return selected;

  const skillsDir = projectSkillsDir(deps);
  const presentLore: string[] = [];
  for (const name of (await deps.fs.listDir(skillsDir)).filter((n) => n.startsWith(SKILL_DIR_PREFIX)).sort()) {
    const stored = await deps.fs.readFile(`${skillsDir}/${name}/${SKILL_FILE_NAME}`);
    const parsed = stored === null ? null : parseSkillFile(stored);
    if (parsed !== null && parsed.intact && parsed.name === name && skillDirName(parsed.id) === name) presentLore.push(name);
  }
  // reason: same adoption rule as rules files - a never-managed project (no lore skill dir, no CLAUDE.md,
  // only shipped skill fragments) has nothing to be stale against.
  const adopted =
    presentLore.length > 0 ||
    (await deps.fs.exists(deps.projectClaudeMdPath)) ||
    selected.value.some((fragment) => fragment.layer !== "shipped");
  if (!adopted) return { ok: true, value: [] };

  const files: SkillsDriftFile[] = [];
  const expected = new Set<string>();
  for (const fragment of selected.value) {
    const rendered = renderSkillFile(fragment);
    if (!rendered.ok) return { ok: false, error: { code: "VALIDATION_ERROR", message: rendered.error.message } };
    expected.add(rendered.value.dirName);
    const stored = await deps.fs.readFile(`${skillsDir}/${rendered.value.dirName}/${SKILL_FILE_NAME}`);
    if (stored === null) files.push({ dirName: rendered.value.dirName, reason: "missing" });
    else if (stored !== rendered.value.content) files.push({ dirName: rendered.value.dirName, reason: "changed" });
  }
  for (const name of presentLore) {
    if (!expected.has(name)) files.push({ dirName: name, reason: "extra" });
  }
  return { ok: true, value: files };
}

// ─── render ─────────────────────────────────────────────────────────────────

/** Banner ceiling (D6/D12): the banner REPLACES the block and is at most HOOK_BANNER_CAP chars. */
export function buildHookBanner(error: FragmentsFlowError): string {
  const banner = `lore fragments ${error.code}: ${error.message}`;
  return banner.length <= HOOK_BANNER_CAP ? banner : `${banner.slice(0, HOOK_BANNER_CAP - 3)}...`;
}

/** One fragment's contribution, for `--explain`. */
export interface ExplainRow {
  readonly id: string;
  readonly layer: Fragment["layer"];
  readonly chars: number;
  /** Absolute path of the fragment file — `lore run register` hashes these bytes for the run's composition record. */
  readonly path: string;
}

export interface FragmentsRenderOptions {
  readonly outlet: OutletId;
  readonly agentType?: string;
}

export interface FragmentsRenderOutput {
  readonly additionalContext: string;
  readonly explain: readonly ExplainRow[];
}

/**
 * Render one hook outlet (helper start, per-turn; `hook:session-start` is retired, BR-912).
 *
 * @returns ok with the additionalContext string, or the typed error the adapter turns into the D12 banner.
 */
export async function runFragmentsRender(
  rawDeps: FragmentsFlowDeps,
  opts: FragmentsRenderOptions,
): Promise<FlowResult<FragmentsRenderOutput>> {
  const applied = applySelection(rawDeps);
  const firstProblem = applied.problems[0];
  if (firstProblem !== undefined) return { ok: false, error: { code: "VALIDATION_ERROR", message: firstProblem.message } };
  const deps = applied.deps;
  const discovered = await discoverAllLayers(deps);
  if (!discovered.ok) return discovered;

  if (opts.outlet === "hook:user-prompt") {
    // reason: the per-turn block reaches the main session, where BR-905 ownership governs, so an illegal
    // override fails the render (banner path); helper start stays lenient (BR-911).
    const overrides = checkOverrides(discovered.value, { global: deps.globalConfig, project: deps.projectConfig });
    if (!overrides.ok) return { ok: false, error: { code: "VALIDATION_ERROR", message: overrides.error.message } };
  }

  const selected = selectSafely(discovered.value, deps, opts.outlet, opts.agentType);
  if (!selected.ok) return selected;
  const block = renderSafely(selected.value, opts.outlet);
  if (!block.ok) return block;

  const explain = selected.value.map((fragment) => ({
    id: fragment.frontmatter.id,
    layer: fragment.layer,
    chars: fragment.body.length,
    path: fragment.path,
  }));

  return { ok: true, value: { additionalContext: block.value, explain } };
}

// ─── check ──────────────────────────────────────────────────────────────────

/** Name of the any-helper "agent type" (a `subagent-start` fragment without `agents`) every check run includes. */
export const WILDCARD_AGENT_TYPE = "subagent:*";

export type FindingKind =
  | "discovery"
  | "override_refusal"
  | "cap"
  | "selection"
  | "rules_drift"
  | "shipped_user_prompt"
  | "duplicate_line"
  | "selection_unknown_id"
  | "selection_in_config"
  | "skill_collision"
  | "skills_drift"
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

const CHECK_OUTLETS: readonly OutletId[] = ["rules:project", "rules:user", "hook:user-prompt", "hook:subagent-start"];

const SettingsLanguageSchema = z.object({ language: z.string().optional() }).passthrough();

/** Names of the `*.md` agent files in `dir` (a missing directory lists as empty). */
async function listAgentNames(deps: FragmentsFlowDeps, dir: string): Promise<string[]> {
  return (await deps.fs.listDir(dir)).filter((name) => name.endsWith(".md")).map((name) => name.slice(0, -".md".length));
}

/**
 * Every agent type a `hook:subagent-start` render can be asked for (DC2-27): shipped, user-scope and
 * project agent files, plus each type a fragment's `agents` list names, then `subagent:*` (the any-helper row).
 */
async function enumerateAgentTypes(deps: FragmentsFlowDeps, fragments: readonly Fragment[]): Promise<string[]> {
  const names = new Set<string>();
  for (const dir of [deps.agentsDir, deps.userAgentsDir, deps.projectAgentsDir]) {
    for (const name of await listAgentNames(deps, dir)) names.add(name);
  }
  for (const fragment of fragments) {
    for (const type of fragment.frontmatter.agents ?? []) names.add(type);
  }
  return [...[...names].sort(), WILDCARD_AGENT_TYPE];
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

/** BR-1066: every id in a scope's `disable` list must name a discovered fragment (any layer). */
function checkSelectionIds(
  selections: Readonly<Record<SelectionScope, Selection>>,
  all: readonly Fragment[],
): CheckFinding[] {
  const known = new Set(all.map((fragment) => fragment.frontmatter.id));
  const findings: CheckFinding[] = [];
  for (const scope of ["project", "user"] as const) {
    for (const id of selections[scope].disable) {
      if (known.has(id)) continue;
      findings.push({
        kind: "selection_unknown_id",
        code: "VALIDATION_ERROR",
        message: `${scope} ${SELECTION_FILE[scope]} disables unknown fragment id "${id}"; no discovered fragment has that id. Remove it or fix the spelling.`,
      });
    }
  }
  return findings;
}

/**
 * Per-turn cost is the user's or the project's choice: a shipped fragment naming `user-prompt` would load
 * into every lore user's every turn, so it is refused (spec D7).
 */
function checkShippedUserPrompt(all: readonly Fragment[]): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const fragment of all) {
    if (fragment.layer !== "shipped" || !fragment.frontmatter.inject.includes("user-prompt")) continue;
    findings.push({
      kind: "shipped_user_prompt",
      code: "VALIDATION_ERROR",
      message: `shipped fragment "${fragment.frontmatter.id}" (${fragment.path}) names inject: user-prompt; a shipped fragment must not be injected on every turn. Give it launch or subagent-start.`,
    });
  }
  return findings;
}

/** BR-1064: a skill fragment must not render onto a skill directory lore itself ships. */
function checkSkillCollisions(shippedSkillNames: readonly string[], all: readonly Fragment[]): CheckFinding[] {
  const shipped = new Set(shippedSkillNames);
  const findings: CheckFinding[] = [];
  for (const fragment of all) {
    if (!fragment.frontmatter.inject.includes("on-demand")) continue;
    const dirName = skillDirName(fragment.frontmatter.id);
    if (!shipped.has(dirName)) continue;
    findings.push({
      kind: "skill_collision",
      code: "VALIDATION_ERROR",
      message: `skill fragment "${fragment.frontmatter.id}" (${fragment.path}) would render as skill directory ${dirName}, which lore already ships; rename the fragment id.`,
    });
  }
  return findings;
}

/**
 * BR-1067: one finding per (line, fragment pair), naming every reading group that reads both
 * (a wildcard-audience pair is read by every helper type; it is reported once, not once per type).
 */
function checkDuplicateLines(groups: readonly ReadingGroup[]): CheckFinding[] {
  const merged = new Map<string, { line: string; kind: string; first: string; second: string; groups: string[] }>();
  for (const duplicate of findDuplicateLines(groups)) {
    const key = JSON.stringify([duplicate.line, duplicate.first.id, duplicate.second.id, duplicate.kind]);
    const entry = merged.get(key);
    if (entry !== undefined) {
      entry.groups.push(duplicate.group);
      continue;
    }
    merged.set(key, {
      line: duplicate.line,
      kind: duplicate.kind,
      first: `${duplicate.first.id} (${duplicate.first.path})`,
      second: `${duplicate.second.id} (${duplicate.second.path})`,
      groups: [duplicate.group],
    });
  }
  return [...merged.values()].map((entry) => ({
    kind: "duplicate_line",
    code: "VALIDATION_ERROR",
    message: `duplicate line (${entry.kind}) "${entry.line}" in ${entry.first} and ${entry.second}; read together by: ${entry.groups.join(", ")}. Keep it in one fragment.`,
  }));
}

/**
 * Check every outlet × agent type. Never throws; every problem is a finding, and `ok` is
 * true only when there are none.
 */
export async function runFragmentsCheck(rawDeps: FragmentsFlowDeps): Promise<FragmentsCheckReport> {
  const findings: CheckFinding[] = [];
  const checks: CheckRow[] = [];
  const applied = applySelection(rawDeps);
  const deps = applied.deps;
  for (const problem of applied.problems) {
    findings.push({ kind: problem.kind, code: "VALIDATION_ERROR", message: problem.message });
  }
  const discovered = await discoverAllLayers(deps);
  const agentTypes = await enumerateAgentTypes(deps, discovered.ok ? discovered.value : []);
  if (agentTypes.length <= 1) {
    findings.push({
      kind: "no_agent_types",
      code: "VALIDATION_ERROR",
      message: `no agent files found in ${deps.agentsDir}, ${deps.userAgentsDir} or ${deps.projectAgentsDir}, and no fragment names an agents filter; the agent-type set to check is empty`,
    });
  }

  if (!discovered.ok) {
    findings.push({ kind: "discovery", ...discovered.error });
  } else {
    const all = discovered.value;
    const overrides = checkOverrides(all, { global: deps.globalConfig, project: deps.projectConfig });
    if (!overrides.ok) {
      findings.push({ kind: "override_refusal", code: "VALIDATION_ERROR", message: overrides.error.message });
    }

    findings.push(...checkSelectionIds(applied.selections, all));
    findings.push(...checkSkillCollisions(rawDeps.shippedSkillNames, all));
    findings.push(...checkShippedUserPrompt(all));

    // Reading groups (BR-1067): what ONE session reads together. Main = both rules outlets
    // + both skills outlets + the per-turn outlet; each helper type = its own subagent-start row.
    const mainFragments: Fragment[] = [];
    const helperGroups: ReadingGroup[] = [];
    for (const skillsOutlet of ["skills:project", "skills:user"] as const) {
      const selectedSkills = selectSafely(all, deps, skillsOutlet, undefined);
      if (!selectedSkills.ok) findings.push({ kind: "selection", ...selectedSkills.error });
      else mainFragments.push(...selectedSkills.value);
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
        if (outlet === "hook:subagent-start") helperGroups.push({ group: agentType === WILDCARD_AGENT_TYPE ? agentType : `subagent:${agentType}`, fragments: selected.value });
        else mainFragments.push(...selected.value);
      }
    }

    findings.push(...checkDuplicateLines([{ group: "main", fragments: mainFragments }, ...helperGroups]));

    for (const target of [projectRulesTarget(deps), userRulesTarget(deps)]) {
      const drift = await detectRulesDrift(deps, all, target);
      if (!drift.ok) {
        findings.push({ kind: "rules_drift", ...drift.error });
        continue;
      }
      for (const file of drift.value.files) {
        findings.push({
          kind: "rules_drift",
          code: "VALIDATION_ERROR",
          message:
            `${target.dir}/${file.fileName}: lore rules file is ${file.reason} versus a fresh render` +
            (target.outlet === "rules:user" ? ". Run `lore context refresh --scope user`." : ". Run `lore context refresh`."),
        });
      }
    }

    const skillsDrift = await detectProjectSkillsDrift(deps, all);
    if (!skillsDrift.ok) {
      findings.push({ kind: "skills_drift", ...skillsDrift.error });
    } else {
      for (const file of skillsDrift.value) {
        findings.push({
          kind: "skills_drift",
          code: "VALIDATION_ERROR",
          message:
            `${projectSkillsDir(deps)}/${file.dirName}/${SKILL_FILE_NAME}: lore skill is ${file.reason} versus a fresh render` +
            ". Run `lore context refresh`.",
        });
      }
    }
  }

  findings.push(...(await checkLanguageDrift(deps)));

  return { ok: findings.length === 0, outlets: CHECK_OUTLETS, agentTypes, checks, findings };
}
