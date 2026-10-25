/**
 * Severity and category are stated as required by the CLI help, the MCP schema and the report hint.
 *
 * @spec_ref spec-defect-reports-carry-their-own-context-a-checked-repro AC-RI-5
 */

import { describe, expect, it } from "vitest";

import reportIssueCommand from "../../../src/adapters/cli/commands/report-issue.js";
import { buildReportIssueHint } from "../../../src/adapters/cli/report-issue-hint.js";
import { LoreReportIssueSchema } from "../../../src/adapters/mcp/tools.js";

const REQUIRED_FLAGS = ["--title", "--description", "--expected", "--actual", "--severity", "--category"];

describe("AC-RI-5", () => {
  it("CLI help marks --severity and --category required and neither says (optional)", () => {
    const cliArgs = reportIssueCommand.args as Record<string, { description?: string }>;
    for (const flag of ["severity", "category"]) {
      const description = cliArgs[flag]?.description ?? "";
      expect(description, flag).toContain("(required)");
      expect(description, flag).not.toContain("(optional)");
    }
  });

  it("MCP schema describes both as required while the shape keeps them optional", () => {
    for (const field of ["severity", "category"] as const) {
      const shape = LoreReportIssueSchema.shape[field];
      expect(shape.description, field).toMatch(/^Required\./);
      expect(shape.isOptional(), field).toBe(true);
    }
  });

  it("the hint example carries every required flag in both the configured and unconfigured variants", () => {
    for (const configured of [true, false]) {
      const hint = buildReportIssueHint("gate", configured);
      expect(hint, `configured=${configured}`).not.toBeNull();
      for (const flag of REQUIRED_FLAGS) expect(hint, `${flag} configured=${configured}`).toContain(flag);
      expect(hint).not.toContain("\n");
    }
  });
});
