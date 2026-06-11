/**
 * syncPush — logical replication from local SQLite to remote libsql client.
 * Source: SPEC-009 §3.3, D-006, R3
 *
 * Reads all rows from the 5 core tables and batch-inserts them into remote
 * using INSERT OR IGNORE (idempotent). Returns a per-table reconciliation
 * report with local_rows / remote_rows counts.
 */

import { createClient, type Client } from "@libsql/client";
import { ok, err } from "../../core/errors.js";
import type { Result, LoreError } from "../../core/errors.js";
import { existsSync } from "node:fs";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface TableReport {
  table: string;
  local_rows: number;
  remote_rows: number;
}

export interface PushReport {
  tables: TableReport[];
  total_rows: number;
}

// ─── Core tables to replicate (R3: all 5 must be covered) ────────────────────

const REPLICATED_TABLES = ["docs", "links", "versions", "audit", "api_keys"] as const;

/**
 * Maximum number of INSERT statements per batch() call.
 * D-006: batch INSERT is required; this constant controls the chunk size to
 * avoid hitting libsql's per-batch payload limits on large datasets.
 */
const BATCH_CHUNK_SIZE = 500;

type ReplicatedTable = (typeof REPLICATED_TABLES)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read all column names for a table via PRAGMA table_info.
 */
async function getColumns(client: Client, table: string): Promise<string[]> {
  const rs = await client.execute(`PRAGMA table_info(${table})`);
  return rs.rows.map((row) => String(row["name"]));
}

/**
 * Count total rows in a table.
 */
async function countRows(client: Client, table: string): Promise<number> {
  const rs = await client.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
  const row = rs.rows[0];
  if (!row) return 0;
  return Number(row["cnt"]);
}

/**
 * Read all rows from a table as plain objects (column→value maps).
 */
async function readAllRows(
  client: Client,
  table: string,
): Promise<Array<Record<string, unknown>>> {
  const rs = await client.execute(`SELECT * FROM ${table}`);
  return rs.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of rs.columns) {
      obj[col] = row[col] ?? null;
    }
    return obj;
  });
}

/**
 * Insert all rows from local into remote using INSERT OR IGNORE.
 * Idempotent: duplicate rows (by PK) are silently skipped.
 *
 * D-006: uses remoteClient.batch() to send rows in chunks of BATCH_CHUNK_SIZE,
 * avoiding N+1 serial round-trips. Each chunk is sent as a single "write" batch.
 */
async function pushTable(
  remoteClient: Client,
  table: string,
  rows: Array<Record<string, unknown>>,
  columns: string[],
): Promise<void> {
  if (rows.length === 0) return;

  const placeholders = columns.map(() => "?").join(", ");
  const colList = columns.join(", ");
  const sql = `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`;

  // Build all statement descriptors first, then send in BATCH_CHUNK_SIZE chunks.
  const stmts = rows.map((row) => ({
    sql,
    args: columns.map((col) => {
      const v = row[col];
      if (v === undefined || v === null) return null;
      return v as string | number | bigint | ArrayBuffer;
    }),
  }));

  for (let i = 0; i < stmts.length; i += BATCH_CHUNK_SIZE) {
    const chunk = stmts.slice(i, i + BATCH_CHUNK_SIZE);
    await remoteClient.batch(chunk, "write");
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Push all local rows from the 5 core tables to a remote libsql client.
 *
 * @param localPath - Absolute path to the local SQLite file.
 * @param remoteClient - Connected @libsql/client pointing at the remote DB.
 * @returns Result<PushReport, LoreError>
 *   ok: per-table reconciliation (local_rows, remote_rows after push)
 *   err: STORE_ERROR if localPath doesn't exist or any write fails
 */
export async function syncPush(
  localPath: string,
  remoteClient: Client,
): Promise<Result<PushReport, LoreError>> {
  // Fail loud when local path does not exist
  if (!existsSync(localPath)) {
    return err({
      code: "STORE_ERROR",
      message: `Local database not found: ${localPath}`,
    });
  }

  let localClient: Client | null = null;

  try {
    localClient = createClient({ url: `file:${localPath}` });

    const tableReports: TableReport[] = [];

    for (const table of REPLICATED_TABLES) {
      // Read local rows and column metadata
      const [localRows, columns] = await Promise.all([
        readAllRows(localClient, table),
        getColumns(localClient, table),
      ]);

      const local_rows = localRows.length;

      // Push to remote (INSERT OR IGNORE for idempotency)
      await pushTable(remoteClient, table, localRows, columns);

      // Count remote rows after push for reconciliation
      const remote_rows = await countRows(remoteClient, table);

      tableReports.push({ table, local_rows, remote_rows });
    }

    const total_rows = tableReports.reduce((acc, t) => acc + t.remote_rows, 0);

    return ok({ tables: tableReports, total_rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error during sync push";
    return err({ code: "STORE_ERROR", message, cause: e instanceof Error ? e : undefined });
  } finally {
    localClient?.close();
  }
}
