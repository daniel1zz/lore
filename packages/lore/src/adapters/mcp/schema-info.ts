/**
 * Static corpus schema info returned by lore_schema.
 * Immutable — edit here when SPEC-002 changes.
 */

export const CORPUS_SCHEMA_INFO = {
  doc_types: ["prd", "spec", "adr", "plan", "knowledge", "task"] as const,
  link_types: [
    "parent",
    "implements",
    "informs",
    "supersedes",
    "relates-to",
    "blocks",
    "governs",
  ] as const,
  status_values: [
    "draft",
    "in-review",
    "approved",
    "active",
    "archived",
    "deprecated",
  ] as const,
  required_fields: {
    prd: ["title"],
    spec: ["title", "parent_id"],
    adr: ["title", "extra.decision_status"],
    plan: ["title"],
    knowledge: ["title", "extra.sub_type"],
    task: ["title", "extra.plan_id"],
  },
  extra_required: {
    adr: {
      decision_status: [
        "proposed",
        "accepted",
        "deprecated",
        "superseded",
      ] as const,
    },
    knowledge: {
      // reason: "assessment" (the retired plan-outcome assessment) is deliberately absent — it can no longer be
      // created; archived docs of that sub_type stay readable. See knowledgeExtraSchema in @lore/core.
      sub_type: [
        "ideation",
        "retro",
        "research",
        "reference",
      ] as const,
    },
    task: {
      plan_id: "DocId (ULID)",
    },
  },
} as const;
