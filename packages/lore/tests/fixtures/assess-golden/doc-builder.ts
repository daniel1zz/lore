/**
 * Minimal DocRecord builder for the `lore assess` golden-fixture harness
 * (SPEC-040 §T3 D7). Fixtures need structurally-valid DocRecord-shaped plan/spec/task
 * objects (`PlanBundle`'s `isDocRecordOfType` predicate checks `id`/`type`/`title`/
 * `content` + a `type` match — see `@lore/core`'s `assessment.ts`) without the ceremony
 * of hand-writing every field on every fixture doc.
 *
 * Fixed, deterministic timestamps (never `Date.now()`) — fixture identity must not
 * depend on when the test suite happens to run.
 */

import type { DocRecord, DocType, DocStatus, Priority } from "@lore/core";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";

/** Fixed creation/update timestamp for every fixture doc — determinism, not realism. */
const FIXTURE_TIMESTAMP = "2026-01-01T00:00:00.000Z";

export interface MakeDocInput {
  id: string;
  slug: string;
  type: DocType;
  title: string;
  content: string;
  status?: DocStatus;
  priority?: Priority;
  parent_id?: string | null;
  extra?: Record<string, unknown>;
  tags?: string[];
  version?: number;
}

/** Build a structurally-valid, deterministic DocRecord for a golden fixture. */
export function makeDoc(input: MakeDocInput): DocRecord {
  return {
    id: input.id,
    slug: input.slug,
    type: input.type,
    role: DOC_TYPE_ROLE_MAP[input.type],
    title: input.title,
    status: input.status ?? "approved",
    priority: input.priority ?? "medium",
    content: input.content,
    parent_id: input.parent_id ?? null,
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    created_by: "assess-golden-fixture",
    version: input.version ?? 1,
    deleted_at: null,
    tags: input.tags ?? [],
    extra: input.extra ?? {},
  };
}
