/**
 * lore template — read the corpus templates that govern structured documents.
 *
 *   show  <type> [--kind <k>] [--blank] [--json]   The latest approved template of a type (and kind): its fields, the
 *                                                  dimension questions, the checks and the render sections.
 *                                                  `--blank` prints a fill-in YAML skeleton instead.
 *   check <doc> [--json]                           Validate a templated document against its pinned template and run
 *                                                  the cross-field checks on demand. Writes nothing.
 *
 * Both read only: no document, version or audit row is written.
 *
 * Exit codes (SPEC-003 §5):
 *   0 = shown / the document is clean
 *   3 = the document was not found
 *   4 = no approved template for the type/kind, an unresolvable template_ref, or `check` found problems or findings
 *
 * Source: spec-every-document-is-stored-as-structured-fields-validated-by (Authoring, Validation), AC-ST-3
 */

import type { CheckFinding, JsonSchemaNode, Template, TemplateProblem } from "@lore/core";
import { defineLoreCommand } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import type { ResolvedTemplate } from "../../../service/template-service.js";
import { applicableDimensions, blankDimensions, blankFields, renderBlankYaml } from "../../../service/template-blank.js";

function isNode(value: unknown): value is JsonSchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One line per top-level field: `name  type  (required)  [markers]  title/description`. */
function describeFieldLines(template: Template): string[] {
  const schema = template.fields as JsonSchemaNode;
  const required = new Set(Array.isArray(schema["required"]) ? (schema["required"] as unknown[]).filter((r): r is string => typeof r === "string") : []);
  const properties = isNode(schema["properties"]) ? (schema["properties"] as Record<string, unknown>) : {};
  return Object.entries(properties).map(([name, raw]) => {
    const node = isNode(raw) ? raw : {};
    const type = Array.isArray(node["type"]) ? node["type"].join("|") : typeof node["type"] === "string" ? node["type"] : "any";
    const markers = Object.keys(node).filter((key) => key.startsWith("x-") && node[key] === true);
    const note = typeof node["description"] === "string" ? node["description"] : typeof node["title"] === "string" ? node["title"] : "";
    return [`  ${name}`, type, required.has(name) ? "required" : "optional", markers.length > 0 ? `[${markers.join(", ")}]` : "", note]
      .filter((part) => part !== "")
      .join("  ");
  });
}

function formatShow(resolved: ResolvedTemplate, kind: string | undefined): string[] {
  const { template } = resolved;
  const lines = [`${resolved.ref}  ${template.doc_type}${template.kind === undefined ? "" : `/${template.kind}`}`, "", "Fields:"];
  lines.push(...describeFieldLines(template));
  lines.push("", "Dimensions (every document answers each):");
  const applicable = new Set(applicableDimensions(template, kind).map((dimension) => dimension.id));
  for (const dimension of template.dimensions) {
    const flags = [
      dimension.needs_refs === true ? "needs refs" : "",
      dimension.applies_to === undefined ? "" : `applies to ${dimension.applies_to.join(", ")}`,
      applicable.has(dimension.id) ? "" : "not for this kind",
    ].filter((flag) => flag !== "");
    lines.push(`  ${dimension.id}${flags.length > 0 ? ` (${flags.join("; ")})` : ""}: ${dimension.question}`);
  }
  lines.push("", `Checks at promote: ${template.checks.length === 0 ? "none" : template.checks.join(", ")}`, "", "Render sections:");
  for (const section of template.render) lines.push(`  ${section.heading}: ${section.fields.join(", ")}`);
  return lines;
}

function formatProblem(problem: TemplateProblem): string {
  return "field" in problem ? `  [${problem.code}] ${problem.field}: ${problem.problem}` : `  [${problem.code}] dimension ${problem.dimension}: ${problem.problem}`;
}

function formatFinding(finding: CheckFinding): string {
  return `  [${finding.check}] ${finding.entry}: ${finding.problem}`;
}

const show = defineLoreCommand({
  meta: { name: "show", description: "Show the approved template of a document type: fields, dimension questions, checks, render" },
  args: {
    type: { type: "positional", description: "Document type (prd, spec, adr, plan, task, knowledge, baseline, ...)", required: true },
    kind: { type: "string", description: "Kind: spec kind, knowledge sub-type, baseline node" },
    blank: { type: "boolean", description: "Print a fill-in YAML skeleton: required fields and one entry per dimension" },
    json: { type: "boolean", description: "Output result as JSON" },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    const service = app.templateService;
    if (service === undefined) {
      inv.io.stderr.write("Error: TemplateService not wired on this App instance.\n");
      return 1;
    }
    const kind = typeof args.kind === "string" && args.kind !== "" ? args.kind : undefined;
    const resolved = await service.resolveTemplate(args.type as string, kind);
    if (!resolved.ok) {
      inv.io.stderr.write(formatErrorFor(inv, resolved.error) + "\n");
      return exitCode(resolved.error);
    }
    const { template } = resolved.value;

    if (args.json) {
      const blank = args.blank
        ? { fields: blankFields(template.fields as JsonSchemaNode), dimensions: blankDimensions(template, kind) }
        : undefined;
      printLine(
        inv.io.stdout,
        JSON.stringify(
          {
            ok: true,
            data: {
              ref: resolved.value.ref,
              slug: resolved.value.slug,
              version: resolved.value.version,
              doc_type: template.doc_type,
              ...(template.kind === undefined ? {} : { kind: template.kind }),
              fields: template.fields,
              dimensions: template.dimensions,
              checks: template.checks,
              render: template.render,
              ...(blank === undefined ? {} : { blank }),
            },
          },
          null,
          2,
        ),
      );
      return 0;
    }

    if (args.blank) {
      inv.io.stdout.write(renderBlankYaml(template, kind));
      return 0;
    }
    for (const line of formatShow(resolved.value, kind)) printLine(inv.io.stdout, line);
    return 0;
  },
});

const check = defineLoreCommand({
  meta: { name: "check", description: "Validate a document against its pinned template and run the cross-field checks (writes nothing)" },
  args: {
    doc: { type: "positional", description: "Document ID or slug", required: true },
    json: { type: "boolean", description: "Output result as JSON" },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    const service = app.templateService;
    if (service === undefined) {
      inv.io.stderr.write("Error: TemplateService not wired on this App instance.\n");
      return 1;
    }
    const fetched = await app.corpusService.get(args.doc as string);
    if (!fetched.ok) {
      inv.io.stderr.write(formatErrorFor(inv, fetched.error) + "\n");
      return exitCode(fetched.error);
    }
    const doc = fetched.value.doc;

    const problems = await service.validate(doc);
    if (!problems.ok) {
      inv.io.stderr.write(formatErrorFor(inv, problems.error) + "\n");
      return exitCode(problems.error);
    }
    const findings = await service.checks(doc);
    if (!findings.ok) {
      inv.io.stderr.write(formatErrorFor(inv, findings.error) + "\n");
      return exitCode(findings.error);
    }
    const clean = problems.value.length === 0 && findings.value.length === 0;

    if (args.json) {
      printLine(
        inv.io.stdout,
        JSON.stringify(
          {
            ok: true,
            data: {
              doc: doc.slug,
              template_ref: doc.extra["template_ref"],
              clean,
              problems: problems.value,
              findings: findings.value,
            },
          },
          null,
          2,
        ),
      );
      return clean ? 0 : 4;
    }

    if (clean) {
      printLine(inv.io.stdout, `${doc.slug} is clean against ${String(doc.extra["template_ref"])}.`);
      return 0;
    }
    printLine(inv.io.stdout, `${doc.slug} does not satisfy ${String(doc.extra["template_ref"])}:`);
    if (problems.value.length > 0) {
      printLine(inv.io.stdout, `${String(problems.value.length)} problem(s):`);
      for (const problem of problems.value) printLine(inv.io.stdout, formatProblem(problem));
    }
    if (findings.value.length > 0) {
      printLine(inv.io.stdout, `${String(findings.value.length)} cross-field finding(s):`);
      for (const finding of findings.value) printLine(inv.io.stdout, formatFinding(finding));
    }
    return 4;
  },
});

export default defineLoreCommand({
  meta: { name: "template", description: "Show the template that governs a document type, or check a document against its template" },
  subCommands: { show, check },
});
