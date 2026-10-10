/**
 * Pure step definitions and step evaluation for `scripts/fresh-install-probe.ts` (AC-FIP-6; AS-16, BR-1007).
 *
 * The probe drives a COMPILED lore binary through the whole baseline loop in a throwaway consumer project. This
 * module holds everything that needs no process, filesystem or clock: the ordered step plan, the per-step output
 * predicates, the skill-file scan and the argv parser. The runner (scripts/fresh-install-probe.ts) is the only IO edge.
 *
 * Slugs are deterministic functions of the titles below (same titles as the manual probe,
 * knowledge-fresh-install-consumer-probe-2026-10-11-slice-3-exit), so steps can name them statically.
 */

export interface RunOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A step that runs `lore <argv>` and requires an exact exit code plus an output predicate. */
export interface CommandStep {
  readonly kind: "command";
  readonly name: string;
  readonly argv: readonly string[];
  readonly expectExit: number;
  /** Returns null when the output satisfies the expectation, else a human-readable failure reason. */
  readonly check: (out: RunOutput) => string | null;
}

/** A runner-side filesystem action (no lore invocation); the runner reports the failure reason itself. */
export interface ActionStep {
  readonly kind: "configure-judge" | "skill-scan";
  readonly name: string;
}

export type ProbeStep = CommandStep | ActionStep;

export interface StepVerdict {
  readonly pass: boolean;
  readonly reason: string;
}

export interface ProbeContext {
  /** Absolute path of the throwaway claude home used for the global skills install. */
  readonly claudeHome: string;
  /** Absolute path of the spec body file (skeleton-compliant markdown). */
  readonly specBodyFile: string;
}

export const SPEC_BODY = "## Overview/Goal\nCharge each order at most once.\n\n## Scope\nCheckout pay button.\n\n## Acceptance Criteria\nSee structured ACs.\n";

export const ACTOR = "agent:probe";
export const BASELINE_ROOT_SLUG = "baseline-probe-business-baseline";
export const PRD_SLUG = "prd-probe-strategy";
const BRANCH_SLUG = "baseline-checkout-branch";
const LEAF_SLUG = "baseline-pay-leaf";
const ARCH_ROOT_SLUG = "baseline-probe-architecture";
const ARCH_SECTION_SLUG = "baseline-error-handling-section";
const ARCH_STANDARD_SLUG = "baseline-result-type-standard";
const CITED_SPEC = "spec-pay-once-spec";
const UNCITED_SPEC = "spec-uncited-spec";

const SCRIPT_CMD = "true && echo ok";

// ── predicate helpers ──────────────────────────────────────────────────────────

const combined = (o: RunOutput): string => `${o.stdout}\n${o.stderr}`;

/** Requires every pattern to match the combined output. */
export function mustContain(...patterns: readonly (string | RegExp)[]): (o: RunOutput) => string | null {
  return (o) => {
    const text = combined(o);
    for (const p of patterns) {
      const hit = typeof p === "string" ? text.includes(p) : p.test(text);
      if (!hit) return `output does not contain ${String(p)}`;
    }
    return null;
  };
}

/** Parses stdout as a lore `--json` envelope and returns its `data` object, or a failure string. */
export function parseEnvelopeData(stdout: string): { data: Record<string, unknown> } | { error: string } {
  const start = stdout.indexOf("{");
  if (start < 0) return { error: "no JSON object in stdout" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch (e) {
    return { error: `stdout is not valid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  if (parsed === null || typeof parsed !== "object") return { error: "JSON payload is not an object" };
  const rec = parsed as Record<string, unknown>;
  const data = rec["data"];
  if (data === null || typeof data !== "object") return { error: "JSON envelope has no data object" };
  return { data: data as Record<string, unknown> };
}

function field(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** Wraps a `status --json` data predicate with envelope parsing. */
function statusJson(inner: (data: Record<string, unknown>) => string | null): (o: RunOutput) => string | null {
  return (o) => {
    const parsed = parseEnvelopeData(o.stdout);
    if ("error" in parsed) return parsed.error;
    return inner(parsed.data);
  };
}

export const checkAcCiteAudited = statusJson((data) => {
  const acCite = asRecord(field(data, "ac_cite"));
  if (acCite === undefined) return "status --json has no ac_cite object";
  const provenance = acCite["provenance"];
  if (provenance !== "audited") {
    return `ac_cite.provenance is ${JSON.stringify(provenance)}, expected "audited" (mode ${JSON.stringify(acCite["mode"])})`;
  }
  return null;
});

export const checkCensusZero = statusJson((data) => {
  for (const key of ["specs_without_citation", "specs_with_parent"] as const) {
    const bucket = asRecord(field(data, key));
    if (bucket === undefined) return `status --json has no ${key} object`;
    if (bucket["count"] !== 0) return `${key}.count is ${JSON.stringify(bucket["count"])}, expected 0`;
  }
  return null;
});

/** BR-1 plus AS-1 are the only live rules in the probe corpus: both trees must be counted (AC-FIP-4). */
export const checkRuleTotalsBothTrees = statusJson((data) => {
  const baseline = asRecord(field(data, "baseline"));
  if (baseline === undefined) return "status --json has no baseline object";
  if (baseline["rules_total"] !== 2) {
    return `baseline.rules_total is ${JSON.stringify(baseline["rules_total"])}, expected 2 (BR-1 + AS-1)`;
  }
  return null;
});

// ── skill scan ─────────────────────────────────────────────────────────────────

export interface ScannedFile {
  readonly path: string;
  readonly text: string;
}

const SPEC_PARENT_PATTERNS: readonly { readonly label: string; readonly re: RegExp }[] = [
  { label: "`create spec ... --parent` on one line", re: /\bcreate\s+spec\b(?:(?!\bcreate\s+\w)[^|\n])*--parent\b/ },
  { label: "required-flags table row `spec | --parent`", re: /^\s*\|\s*`?spec`?\s*\|[^\n]*--parent\b/ },
  { label: '"every spec needs a parent"', re: /every\s+spec\s+(needs|requires|must have)\s+a\s+parent/i },
];

/** Lines of installed skill/rule text that pair `spec` with `--parent` (a spec takes no parent, BR-2). */
export function scanForSpecParentPairing(files: readonly ScannedFile[]): string[] {
  const findings: string[] = [];
  for (const file of files) {
    const lines = file.text.split("\n");
    lines.forEach((line, i) => {
      for (const { label, re } of SPEC_PARENT_PATTERNS) {
        if (re.test(line)) findings.push(`${file.path}:${String(i + 1)} ${label}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  return findings;
}

export function evaluateSkillScan(files: readonly ScannedFile[]): StepVerdict {
  if (files.length === 0) return { pass: false, reason: "no installed skill/rule files found to scan" };
  const findings = scanForSpecParentPairing(files);
  if (findings.length > 0) {
    return { pass: false, reason: `${String(findings.length)} spec+--parent pairing(s): ${findings.slice(0, 3).join(" | ")}` };
  }
  return { pass: true, reason: `${String(files.length)} files scanned, no spec+--parent pairing` };
}

// ── step plan ──────────────────────────────────────────────────────────────────

function cmd(name: string, argv: readonly string[], expectExit: number, check: CommandStep["check"]): CommandStep {
  return { kind: "command", name, argv, expectExit, check };
}

export function buildSteps(ctx: ProbeContext): readonly ProbeStep[] {
  const ok = (): null => null;
  return [
    cmd("init", ["init", "--author", ACTOR], 0, ok),
    cmd("setup-project", ["setup", "--project", "--yes"], 0, ok),
    cmd("setup-global-skills", ["setup", "--claude-dir", ctx.claudeHome, "--yes"], 0, ok),
    { kind: "configure-judge", name: "configure-stub-judge" },
    cmd("status-ac-cite-audited", ["status", "--json"], 0, checkAcCiteAudited),
    { kind: "skill-scan", name: "skills-no-spec-parent-pairing" },
    cmd("create-prd", ["create", "prd", "--title", "Probe Strategy", "--content", "Strategy: why the probe product exists."], 0, ok),
    cmd("baseline-root", ["baseline", "add", PRD_SLUG, "--node", "root", "--label", "Probe", "--title", "Probe Business Baseline"], 0, ok),
    cmd("baseline-branch", ["baseline", "add", BASELINE_ROOT_SLUG, "--node", "branch", "--label", "Checkout", "--title", "Checkout Branch"], 0, ok),
    cmd("baseline-leaf", ["baseline", "add", BRANCH_SLUG, "--node", "leaf", "--label", "Pay", "--title", "Pay Leaf"], 0, ok),
    cmd(
      "rule-add-br",
      ["rule", "add", LEAF_SLUG, "--statement", "A payment is charged at most once per order.", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "Double-click on Pay charges once."],
      0,
      mustContain("Added BR-1"),
    ),
    cmd("baseline-arch-root", ["baseline", "add", PRD_SLUG, "--tree", "architecture", "--node", "root", "--label", "Arch", "--title", "Probe Architecture"], 0, ok),
    cmd("baseline-arch-section", ["baseline", "add", ARCH_ROOT_SLUG, "--tree", "architecture", "--node", "section", "--label", "Errors", "--title", "Error Handling Section"], 0, ok),
    cmd("baseline-arch-standard", ["baseline", "add", ARCH_SECTION_SLUG, "--tree", "architecture", "--node", "standard", "--label", "Result", "--title", "Result Type Standard"], 0, ok),
    cmd(
      "rule-add-as-four-part",
      [
        "rule", "add", ARCH_STANDARD_SLUG,
        "--statement", "Service functions return a Result instead of throwing.",
        "--confidence", "established", "--enforced-by", "guaranteed",
        "--example", "createDoc returns err(VALIDATION_ERROR).",
        "--current-reality", "Two modules still throw.",
        "--target-rule", "No exception crosses a service boundary.",
        "--current-exceptions-none",
        "--migration", "Convert remaining throwers to Result.",
      ],
      0,
      mustContain("Added AS-1"),
    ),
    cmd("create-spec-cited", ["create", "spec", "--title", "Pay Once Spec", "--content-file", ctx.specBodyFile], 0, mustContain(CITED_SPEC)),
    cmd("create-spec-with-parent-refused", ["create", "spec", "--title", "Pay Parent Spec", "--parent", PRD_SLUG, "--content-file", ctx.specBodyFile], 4, mustContain(/takes no parent/)),
    cmd("create-spec-uncited", ["create", "spec", "--title", "Uncited Spec", "--content-file", ctx.specBodyFile], 0, mustContain(UNCITED_SPEC)),
    cmd("ac-add-cited", ["ac", "add", CITED_SPEC, "AC-PAY-1", "--statement", "Pay charges once per order", "--mode", "script", "--oracle", "other", "--command", SCRIPT_CMD, "--cite", "BR-1"], 0, ok),
    cmd("review-cited", ["review", CITED_SPEC], 0, mustContain(/Decision:\s*approve/i, /tree_position\s+pass/)),
    cmd("approve-cited", ["approve", CITED_SPEC], 0, mustContain(/approved/i)),
    cmd("ac-add-uncited", ["ac", "add", UNCITED_SPEC, "AC-UNC-1", "--statement", "Something checkable", "--mode", "script", "--oracle", "other", "--command", SCRIPT_CMD], 0, ok),
    cmd("review-uncited", ["review", UNCITED_SPEC], 0, mustContain(/Decision:\s*approve/i)),
    cmd("approve-uncited-refused", ["approve", UNCITED_SPEC], 4, mustContain(/cites no live (business|architecture)[^\n]*rule/i, /cannot be approved/)),
    cmd("get-spec-implements", ["get", CITED_SPEC], 0, mustContain("Implements", "BR-1")),
    cmd("get-leaf-implemented-by", ["get", LEAF_SLUG], 0, mustContain("Implemented by", `BR-1: ${CITED_SPEC}`)),
    cmd("status-check-prd-budget", ["status", "--check-prd-budget"], 0, mustContain(/within budget/)),
    cmd("ac-cite-uncited", ["ac", "cite", UNCITED_SPEC, "AC-UNC-1", "BR-1"], 0, ok),
    cmd("status-census-zero", ["status", "--json"], 0, checkCensusZero),
    cmd("status-rule-totals-both-trees", ["status", "--json"], 0, checkRuleTotalsBothTrees),
    cmd("status-check-tree", ["status", "--check-tree"], 0, mustContain(/consistent/)),
    cmd("migrate-spec-parents-preview", ["migrate", "spec-parents"], 0, mustContain("Specs would clear: 0")),
    cmd("bootstrap-root-and-strategy", ["bootstrap"], 0, mustContain(new RegExp(`Root:\\s*${BASELINE_ROOT_SLUG}\\b`), new RegExp(`Strategy:\\s*${PRD_SLUG}\\b`))),
    cmd("tree-help-default-root", ["tree", "--help"], 0, (o) => {
      const text = combined(o);
      if (/default:\s*first PRD/i.test(text)) return 'tree --help still says the default root is the "first PRD"';
      return /default[^\n]*baseline/i.test(text) ? null : "tree --help does not name the business baseline root as the default root";
    }),
    cmd("tree-default-root", ["tree"], 0, mustContain("Probe Business Baseline")),
  ];
}

// ── evaluation ─────────────────────────────────────────────────────────────────

/** Exact exit code first (a wrong exit is always a failure), then the output predicate. */
export function evaluateCommandStep(step: CommandStep, out: RunOutput): StepVerdict {
  if (out.exitCode !== step.expectExit) {
    const tail = combined(out).trim().split("\n").slice(-2).join(" / ").slice(0, 200);
    return { pass: false, reason: `expected exit ${String(step.expectExit)}, got ${String(out.exitCode)}: ${tail}` };
  }
  const failure = step.check(out);
  return failure === null ? { pass: true, reason: "ok" } : { pass: false, reason: failure };
}

export function formatStepLine(name: string, exitCode: number | "-", verdict: StepVerdict): string {
  return `${verdict.pass ? "PASS" : "FAIL"} ${name} (exit ${String(exitCode)}) ${verdict.reason}`;
}

export function formatSummary(verdicts: readonly StepVerdict[]): string {
  const failed = verdicts.filter((v) => !v.pass).length;
  return `${String(verdicts.length - failed)}/${String(verdicts.length)} steps passed, ${String(failed)} failed`;
}

// ── argv ───────────────────────────────────────────────────────────────────────

export interface ProbeArgs {
  readonly bin: string;
  readonly keep: boolean;
}

export class ProbeUsageError extends Error {}

/** `--bin <path>` is required (fail loud, exit 2 at the runner); `--keep` retains the temp project. */
export function parseProbeArgs(argv: readonly string[]): ProbeArgs {
  let bin: string | undefined;
  let keep = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep") keep = true;
    else if (arg === "--bin") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new ProbeUsageError("--bin requires a path");
      bin = value;
      i++;
    } else throw new ProbeUsageError(`unknown argument: ${String(arg)}`);
  }
  if (bin === undefined) throw new ProbeUsageError("--bin <path-to-compiled-lore> is required");
  return { bin, keep };
}
