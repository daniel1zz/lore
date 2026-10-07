/** @spec_ref AC-CORE-001 */
import { describe, it, expect } from "vitest";
import {
  DOC_TYPE_ROLE_MAP,
  type DocRecord,
  type LinkRecord,
  type VersionRecord,
  type AuditEntry,
  type DocId,
  type Slug,
  type DocType,
  type DocRole,
  type DocStatus,
  type Priority,
  type LinkType,
  type VersionAction,
  type DocSummary,
  type AdrExtra,
  type KnowledgeExtra,
  type TaskExtra,
  type PlanExtra,
} from "@lore/core";

// Test plan for types module:
// HAPPY: all interfaces constructable, DOC_TYPE_ROLE_MAP correct
// NEGATIVE: N/A — pure TypeScript interfaces, compile-time only
// BOUNDARY: null fields, optional fields absent, empty strings/arrays
// ERROR: N/A — no external dependencies
// STATE: N/A — stateless types/constants
// REGRESSION: N/A — no known regressions

describe("DocRecord interface (AC-CORE-001.01)", () => {
  it("constructs a minimal valid DocRecord with all required fields", () => {
    const doc: DocRecord = {
      id: "01J5X7KZRF4AXRHX9WKE6DVP6P" as DocId,
      slug: "spec-auth-v2" as Slug,
      type: "spec",
      role: "spec",
      title: "Auth Service v2",
      status: "draft",
      priority: "high",
      content: "# Auth Service v2\n\nSpec content.",
      parent_id: "01J5X7KZRF4AXRHX9WKE6DVP7Q" as DocId,
      extra: {},
      tags: ["auth", "security"],
      version: 1,
      created_at: "2026-06-08T00:00:00Z",
      updated_at: "2026-06-08T00:00:00Z",
      created_by: "agent-001",
      deleted_at: null,
    };
    expect(doc.id).toBe("01J5X7KZRF4AXRHX9WKE6DVP6P");
    expect(doc.type).toBe("spec");
    expect(doc.parent_id).not.toBeNull();
  });

  it("constructs a root DocRecord with null parent_id", () => {
    const doc: DocRecord = {
      id: "01J5X7KZRF4AXRHX9WKE6DVP6P" as DocId,
      slug: "prd-lore" as Slug,
      type: "prd",
      role: "intent",
      title: "Lore PRD",
      status: "approved",
      priority: "critical",
      content: "",
      parent_id: null,
      extra: {},
      tags: [],
      version: 3,
      created_at: "2026-06-08T00:00:00Z",
      updated_at: "2026-06-08T12:00:00Z",
      created_by: "user-1",
      deleted_at: null,
    };
    expect(doc.parent_id).toBeNull();
    expect(doc.version).toBe(3);
  });

  it("constructs a soft-deleted DocRecord", () => {
    const doc: DocRecord = {
      id: "01J5X7KZRF4AXRHX9WKE6DVP6P" as DocId,
      slug: "spec-old" as Slug,
      type: "spec",
      role: "spec",
      title: "Old spec",
      status: "archived",
      priority: "low",
      content: "",
      parent_id: null,
      extra: {},
      tags: [],
      version: 2,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-08T00:00:00Z",
      created_by: "user-1",
      deleted_at: "2026-06-08T10:00:00Z",
    };
    expect(doc.deleted_at).not.toBeNull();
  });

  it("[boundary] accepts empty string content", () => {
    const doc: DocRecord = {
      id: "01J5" as DocId,
      slug: "prd-x" as Slug,
      type: "prd",
      role: "intent",
      title: "X",
      status: "draft",
      priority: "low",
      content: "",
      parent_id: null,
      extra: {},
      tags: [],
      version: 1,
      created_at: "2026-06-08T00:00:00Z",
      updated_at: "2026-06-08T00:00:00Z",
      created_by: "u",
      deleted_at: null,
    };
    expect(doc.content).toBe("");
    expect(doc.tags).toHaveLength(0);
  });
});

describe("LinkRecord interface (AC-CORE-001.02)", () => {
  it("constructs a valid LinkRecord", () => {
    const link: LinkRecord = {
      from_id: "01J5X7KZRF4AXRHX9WKE6DVP6P" as DocId,
      to_id: "01J5X7KZRF4AXRHX9WKE6DVP7Q" as DocId,
      link_type: "implements",
      created_at: "2026-06-08T00:00:00Z",
      created_by: "user-1",
    };
    expect(link.link_type).toBe("implements");
  });

  it("accepts all 6 link types", () => {
    const linkTypes: LinkType[] = [
      "parent",
      "implements",
      "informs",
      "supersedes",
      "relates-to",
      "blocks",
    ];
    for (const lt of linkTypes) {
      const link: LinkRecord = {
        from_id: "A" as DocId,
        to_id: "B" as DocId,
        link_type: lt,
        created_at: "2026-06-08T00:00:00Z",
        created_by: "u",
      };
      expect(link.link_type).toBe(lt);
    }
  });
});

describe("VersionRecord interface (AC-CORE-001.03)", () => {
  it("constructs a valid VersionRecord", () => {
    const vr: VersionRecord = {
      doc_id: "01J5X7KZRF4AXRHX9WKE6DVP6P" as DocId,
      version: 1,
      content: "# Content",
      extra: {},
      status: "draft",
      title: "Auth Service",
      action: "create",
      created_at: "2026-06-08T00:00:00Z",
      created_by: "user-1",
    };
    expect(vr.version).toBe(1);
    expect(vr.action).toBe("create");
  });

  it("constructs VersionRecord with optional change_summary", () => {
    const vr: VersionRecord = {
      doc_id: "01J5" as DocId,
      version: 2,
      content: "updated",
      extra: {},
      status: "in-review",
      title: "T",
      action: "update",
      created_at: "2026-06-08T00:00:00Z",
      created_by: "u",
      change_summary: "Added section 3",
    };
    expect(vr.change_summary).toBe("Added section 3");
  });

  it("accepts all 6 VersionAction values", () => {
    const actions: VersionAction[] = [
      "create",
      "update",
      "approve",
      "reject",
      "restore",
      "delete",
    ];
    for (const action of actions) {
      const vr: VersionRecord = {
        doc_id: "A" as DocId,
        version: 1,
        content: "",
        extra: {},
        status: "draft",
        title: "T",
        action,
        created_at: "2026-06-08T00:00:00Z",
        created_by: "u",
      };
      expect(vr.action).toBe(action);
    }
  });

  it("[boundary] version 1 is valid", () => {
    const vr: VersionRecord = {
      doc_id: "A" as DocId,
      version: 1,
      content: "",
      extra: {},
      status: "draft",
      title: "T",
      action: "create",
      created_at: "2026-06-08T00:00:00Z",
      created_by: "u",
    };
    expect(vr.version).toBe(1);
  });
});

describe("AuditEntry interface (AC-CORE-001.04)", () => {
  it("constructs a minimal AuditEntry without optional fields", () => {
    const entry: AuditEntry = {
      timestamp: "2026-06-08T00:00:00Z",
      actor: "user-1",
      session_id: "sess-abc",
      action: "create",
    };
    expect(entry.actor).toBe("user-1");
    expect(entry.doc_id).toBeUndefined();
  });

  it("constructs an AuditEntry with all optional fields", () => {
    const entry: AuditEntry = {
      timestamp: "2026-06-08T00:00:00Z",
      actor: "agent-001",
      session_id: "sess-xyz",
      action: "update",
      doc_id: "01J5X7KZRF4AXRHX9WKE6DVP6P" as DocId,
      details: { field: "content", change: "added section" },
    };
    expect(entry.doc_id).toBe("01J5X7KZRF4AXRHX9WKE6DVP6P");
    expect(entry.details).toBeDefined();
  });
});

describe("DocSummary interface", () => {
  it("constructs a valid DocSummary", () => {
    const summary: DocSummary = {
      id: "01J5" as DocId,
      slug: "spec-auth" as Slug,
      type: "spec",
      title: "Auth Service",
      status: "draft",
      updated_at: "2026-06-08T00:00:00Z",
      tags: ["auth"],
      priority: "high",
    };
    expect(summary.slug).toBe("spec-auth");
  });

  it("[boundary] meta is optional — absent for prd", () => {
    const summary: DocSummary = {
      id: "01J5" as DocId,
      slug: "prd-lore" as Slug,
      type: "prd",
      title: "Lore PRD",
      status: "approved",
      updated_at: "2026-06-08T00:00:00Z",
      tags: [],
      priority: "medium",
    };
    expect(summary.meta).toBeUndefined();
  });

  it("accepts a type-differentiated meta variant", () => {
    const summary: DocSummary = {
      id: "01J5" as DocId,
      slug: "spec-auth" as Slug,
      type: "spec",
      title: "Auth Service",
      status: "draft",
      updated_at: "2026-06-08T00:00:00Z",
      tags: [],
      priority: "medium",
      meta: { t: "spec", kind: "feature" },
    };
    expect(summary.meta).toEqual({ t: "spec", kind: "feature" });
  });
});

describe("Type-specific extra interfaces", () => {
  it("AdrExtra requires decision_status", () => {
    const extra: AdrExtra = {
      decision_status: "accepted",
    };
    expect(extra.decision_status).toBe("accepted");
  });

  it("AdrExtra with optional superseded_by", () => {
    const extra: AdrExtra = {
      decision_status: "superseded",
      superseded_by: "01J5X7" as DocId,
    };
    expect(extra.superseded_by).toBeDefined();
  });

  it("KnowledgeExtra requires sub_type", () => {
    const extra: KnowledgeExtra = {
      sub_type: "ideation",
    };
    expect(extra.sub_type).toBe("ideation");
  });

  it("KnowledgeExtra accepts all 4 sub_type values", () => {
    const subTypes: KnowledgeExtra["sub_type"][] = [
      "ideation",
      "retro",
      "research",
      "reference",
    ];
    for (const sub_type of subTypes) {
      const e: KnowledgeExtra = { sub_type };
      expect(e.sub_type).toBe(sub_type);
    }
  });

  it("TaskExtra requires plan_id", () => {
    const extra: TaskExtra = {
      plan_id: "01J5X7KZRF4AXRHX9WKE6DVP6P" as DocId,
    };
    expect(extra.plan_id).toBeDefined();
  });

  it("TaskExtra with all optional fields", () => {
    // reason: task_status was removed from TaskExtra/taskExtraSchema (SPEC-025 D6 —
    // zero business-logic consumers, superseded by computed readiness). This test now
    // exercises the remaining optional fields (assignee, phase) instead.
    const extra: TaskExtra = {
      plan_id: "01J5" as DocId,
      assignee: "agent-001",
      phase: "P1",
    };
    expect(extra.assignee).toBe("agent-001");
    expect(extra.phase).toBe("P1");
  });

  it("PlanExtra with optional phase", () => {
    const extra: PlanExtra = {
      phase: "P1",
    };
    expect(extra.phase).toBe("P1");
  });

  it("[boundary] PlanExtra without phase is valid", () => {
    const extra: PlanExtra = {};
    expect(extra.phase).toBeUndefined();
  });
});

describe("DOC_TYPE_ROLE_MAP (AC-CORE-001.05)", () => {
  it("maps prd to intent", () => {
    expect(DOC_TYPE_ROLE_MAP.prd).toBe("intent");
  });

  it("maps spec to spec", () => {
    expect(DOC_TYPE_ROLE_MAP.spec).toBe("spec");
  });

  it("maps adr to decision", () => {
    expect(DOC_TYPE_ROLE_MAP.adr).toBe("decision");
  });

  it("maps plan to plan", () => {
    expect(DOC_TYPE_ROLE_MAP.plan).toBe("plan");
  });

  it("maps knowledge to knowledge", () => {
    expect(DOC_TYPE_ROLE_MAP.knowledge).toBe("knowledge");
  });

  it("maps task to plan", () => {
    expect(DOC_TYPE_ROLE_MAP.task).toBe("plan");
  });

  it("maps phase to plan (SPEC-056 T4)", () => {
    expect(DOC_TYPE_ROLE_MAP.phase).toBe("plan");
  });

  it("covers all 7 DocType values", () => {
    const allTypes: DocType[] = [
      "prd",
      "spec",
      "adr",
      "plan",
      "knowledge",
      "task",
      "phase",
    ];
    for (const t of allTypes) {
      expect(DOC_TYPE_ROLE_MAP[t]).toBeDefined();
    }
  });

  it("[negative/AC-CORE-001.N02] does not include invalid types", () => {
    const validTypes = Object.keys(DOC_TYPE_ROLE_MAP);
    expect(validTypes).toHaveLength(8);
    expect(validTypes).not.toContain("unknown");
  });
});

describe("DocStatus union type (AC-CORE-001.N01)", () => {
  it("all 6 valid status values can be assigned", () => {
    const statuses: DocStatus[] = [
      "draft",
      "in-review",
      "approved",
      "active",
      "archived",
      "deprecated",
    ];
    expect(statuses).toHaveLength(6);
  });
});

describe("DocRole union type", () => {
  it("all 5 valid role values can be assigned", () => {
    const roles: DocRole[] = [
      "intent",
      "spec",
      "decision",
      "plan",
      "knowledge",
    ];
    expect(roles).toHaveLength(5);
  });
});

describe("Priority union type", () => {
  it("all 4 priority values can be assigned", () => {
    const priorities: Priority[] = ["critical", "high", "medium", "low"];
    expect(priorities).toHaveLength(4);
  });
});
