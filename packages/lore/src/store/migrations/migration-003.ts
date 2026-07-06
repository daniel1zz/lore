/**
 * Migration 003 — review_judgments + calibration_records tables (SPEC-034 data layer).
 * SQL is inlined as a string constant so bun build --compile can bundle it
 * without requiring filesystem access to .sql files at runtime.
 * Never edit migration-001/002 in place — this is a NEW migration, additive only.
 */

export const MIGRATION_003_SQL = `-- Migration: 003-review-judgment-calibration
-- Schema version: 3

CREATE TABLE IF NOT EXISTS review_judgments (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES docs(id),
  doc_version INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approve','reject','escalate')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  reasons TEXT NOT NULL,
  checks TEXT NOT NULL,
  blocking_questions TEXT NOT NULL DEFAULT '[]',
  judge_provider TEXT NOT NULL,
  judge_model TEXT NOT NULL,
  judge_prompt_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_judgments_doc ON review_judgments(doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_judgments_prompt ON review_judgments(judge_prompt_version);

CREATE TABLE IF NOT EXISTS calibration_records (
  id TEXT PRIMARY KEY,
  judgment_id TEXT NOT NULL REFERENCES review_judgments(id),
  doc_id TEXT NOT NULL REFERENCES docs(id),
  doc_type TEXT NOT NULL,
  human_outcome TEXT NOT NULL CHECK(human_outcome IN ('confirmed','overridden')),
  delta_reasons TEXT NOT NULL DEFAULT '[]',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calibration_window ON calibration_records(doc_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calibration_judgment ON calibration_records(judgment_id);

PRAGMA user_version = 3;
`;
