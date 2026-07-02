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
      // reason: "assessment" (SPEC-026) is written exclusively by `lore assess` — it
      // additionally requires a Zod-valid extra.assessment (not expressible in this
      // static string list; see knowledgeExtraSchema in @lore/core for the full contract).
      sub_type: [
        "ideation",
        "retro",
        "research",
        "reference",
        "assessment",
      ] as const,
    },
    task: {
      plan_id: "DocId (ULID)",
    },
  },
} as const;
