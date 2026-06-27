/**
 * Migration 002 — API keys table for Phase 2 simplified auth.
 * SQL is inlined as a string constant so bun build --compile can bundle it
 * without requiring filesystem access to .sql files at runtime.
 */

export const MIGRATION_002_SQL = `-- Migration: 002-api-keys
-- Schema version: 2

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash  TEXT PRIMARY KEY,             -- SHA-256 hex hash of the raw key
  name      TEXT NOT NULL UNIQUE,          -- human-readable agent name
  owner     TEXT NOT NULL DEFAULT 'admin', -- who created this key
  rate_limit INTEGER NOT NULL DEFAULT 60,  -- writes per minute
  created_at TEXT NOT NULL,                -- ISO 8601
  revoked_at TEXT                           -- NULL = active, ISO 8601 = revoked
);

CREATE INDEX IF NOT EXISTS idx_api_keys_name ON api_keys(name);

PRAGMA user_version = 2;
`;
