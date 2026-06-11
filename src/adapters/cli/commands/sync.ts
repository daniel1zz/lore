/**
 * lore sync — manage remote Turso sync configuration.
 * Subcommands: setup, status, push, pull
 * Source: SPEC-009 §5, D-004 (auth_token_env stores NAME only, never plaintext token)
 */

import { defineCommand } from "citty";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { createClient } from "@libsql/client";
import { loadConfig, saveConfig, resolveSyncCredentials } from "../../../core/config.js";
import type { LoreConfig } from "../../../core/config.js";
import type { Result, LoreError } from "../../../core/errors.js";
import { err, ok } from "../../../core/errors.js";
import { syncPush, type PushReport } from "../../http/sync-push.js";
import { TursoStore } from "../../../store/turso-store.js";

// ─── Push / Pull implementations ─────────────────────────────────────────────

/**
 * Logical replication push: read all local rows and INSERT OR IGNORE into remote.
 * Returns a PushReport with per-table row counts on success.
 */
export async function performPush(
  localPath: string,
  remoteUrl: string,
  authToken: string,
): Promise<Result<PushReport, LoreError>> {
  const remoteClient = createClient({ url: remoteUrl, authToken });
  try {
    return await syncPush(localPath, remoteClient);
  } finally {
    remoteClient.close();
  }
}

/**
 * Embedded-replica pull: sync remote frames to local embedded replica.
 * Uses TursoStore.sync() which calls @libsql/client client.sync().
 * Returns { frameNo, framesSynced } on success.
 */
export async function performPull(
  localPath: string,
  remoteUrl: string,
  authToken: string,
): Promise<Result<{ frameNo: number; framesSynced: number } | void, LoreError>> {
  const store = new TursoStore({
    localPath,
    remoteUrl,
    authToken,
  });
  try {
    return await store.sync();
  } finally {
    store.close();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Discover the lore project directory by walking up from cwd.
 * Returns the directory containing .lore/, or null if not found.
 */
function findLoreDir(): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".lore", "lore.db");
    if (existsSync(candidate)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── sync setup ───────────────────────────────────────────────────────────────

const syncSetup = defineCommand({
  meta: {
    name: "setup",
    description: "Configure remote Turso sync connection",
  },
  args: {
    url: {
      type: "string",
      description: "libsql:// remote URL (required)",
    },
    "token-env": {
      type: "string",
      description: "Name of env var holding the Turso auth token (default: LORE_SYNC_TOKEN)",
    },
    interval: {
      type: "string",
      description: "Sync interval in seconds (default: 60)",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    // Validate --url is present
    if (!args.url) {
      const msg = "Missing required option --url (libsql://...)";
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    // Validate --url must start with libsql://
    if (!args.url.startsWith("libsql://")) {
      const msg = `Invalid URL — must start with libsql:// (got: ${args.url})`;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const loreDir = findLoreDir();
    if (loreDir === null) {
      const msg = "No Lore project found. Run `lore init` first.";
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    // Load existing config (may not have sync section)
    const configResult = loadConfig(loreDir);
    if (!configResult.ok) {
      const msg = `Failed to load config: ${configResult.error.code}`;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const tokenEnv = (args["token-env"] as string | undefined) ?? "LORE_SYNC_TOKEN";
    const intervalSeconds = args.interval !== undefined ? parseInt(String(args.interval), 10) : 60;
    const safeInterval = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 60;

    // Build updated config with sync section (D-004: write env var NAME, never token value)
    const updatedConfig: LoreConfig = {
      ...configResult.value,
      sync: {
        enabled: true,
        remote_url: args.url,
        auth_token_env: tokenEnv,
        interval: safeInterval,
      },
    };

    const saveResult = saveConfig(loreDir, updatedConfig);
    if (!saveResult.ok) {
      const msg = `Failed to save config: ${saveResult.error.message}`;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    if (args.json) {
      console.log(
        JSON.stringify({
          ok: true,
          data: {
            remote_url: args.url,
            auth_token_env: tokenEnv,
            interval: safeInterval,
            enabled: true,
          },
        }),
      );
    } else {
      console.log(`Sync configured.`);
      console.log(`  Remote URL:    ${args.url}`);
      console.log(`  Token env var: ${tokenEnv}`);
      console.log(`  Interval:      ${safeInterval}s`);
      console.log(`  Config:        ${join(loreDir, ".lore", "config.yaml")}`);
    }

    process.exit(0);
  },
});

// ─── sync status ──────────────────────────────────────────────────────────────

const syncStatus = defineCommand({
  meta: {
    name: "status",
    description: "Show current sync configuration and state",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const loreDir = findLoreDir();
    if (loreDir === null) {
      const msg = "No Lore project found. Run `lore init` first.";
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const configResult = loadConfig(loreDir);
    if (!configResult.ok) {
      const msg = `Failed to load config: ${configResult.error.code}`;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const config = configResult.value;
    const syncSection = config.sync;

    // No sync section or sync disabled
    if (syncSection === undefined) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { configured: false, status: "not configured" } }));
      } else {
        console.log("Sync is not configured (local-only mode).");
        console.log("Run `lore sync setup --url libsql://...` to configure remote sync.");
      }
      process.exit(0);
    }

    if (!syncSection.enabled) {
      if (args.json) {
        console.log(
          JSON.stringify({
            ok: true,
            data: {
              configured: true,
              enabled: false,
              status: "disabled",
              remote_url: syncSection.remote_url,
              auth_token_env: syncSection.auth_token_env,
              interval: syncSection.interval,
            },
          }),
        );
      } else {
        console.log("Sync is disabled.");
        console.log(`  Remote URL:    ${syncSection.remote_url ?? "(none)"}`);
        console.log(`  Token env var: ${syncSection.auth_token_env}`);
        console.log(`  Interval:      ${syncSection.interval}s`);
      }
      process.exit(0);
    }

    // Sync is enabled
    if (args.json) {
      console.log(
        JSON.stringify({
          ok: true,
          data: {
            configured: true,
            enabled: true,
            status: "enabled",
            remote_url: syncSection.remote_url,
            auth_token_env: syncSection.auth_token_env,
            interval: syncSection.interval,
          },
        }),
      );
    } else {
      console.log("Sync is enabled.");
      console.log(`  Remote URL:    ${syncSection.remote_url ?? "(none)"}`);
      console.log(`  Token env var: ${syncSection.auth_token_env}`);
      console.log(`  Interval:      ${syncSection.interval}s`);
    }

    process.exit(0);
  },
});

// ─── sync push ────────────────────────────────────────────────────────────────

const syncPushCmd = defineCommand({
  meta: {
    name: "push",
    description: "Upload local DB to remote Turso (logical replication)",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const loreDir = findLoreDir();
    if (loreDir === null) {
      const msg = "No Lore project found. Run `lore init` first.";
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const configResult = loadConfig(loreDir);
    if (!configResult.ok) {
      const msg = `Failed to load config: ${configResult.error.code}`;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const credResult = resolveSyncCredentials(configResult.value);
    if (!credResult.ok) {
      const msg =
        credResult.error.code === "VALIDATION_ERROR" && credResult.error.field === "sync"
          ? "Sync is not configured. Run `lore sync setup --url libsql://...` first."
          : `Sync credentials unavailable: ${credResult.error.message}`;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const localDbPath = join(loreDir, ".lore", "lore.db");
    const pushResult = await performPush(localDbPath, credResult.value.url, credResult.value.token);

    if (!pushResult.ok) {
      const msg = pushResult.error.message;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const report = pushResult.value;

    if (args.json) {
      console.log(JSON.stringify({ ok: true, data: { pushed: true, report } }));
    } else {
      console.log("Push complete.");
      for (const t of report.tables) {
        console.log(`  ${t.table}: ${t.local_rows} local → ${t.remote_rows} remote`);
      }
      console.log(`  Total: ${report.total_rows} rows`);
    }

    process.exit(0);
  },
});

// ─── sync pull ────────────────────────────────────────────────────────────────

const syncPullCmd = defineCommand({
  meta: {
    name: "pull",
    description: "Sync remote Turso changes to local DB (embedded replica)",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const loreDir = findLoreDir();
    if (loreDir === null) {
      const msg = "No Lore project found. Run `lore init` first.";
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const configResult = loadConfig(loreDir);
    if (!configResult.ok) {
      const msg = `Failed to load config: ${configResult.error.code}`;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const credResult = resolveSyncCredentials(configResult.value);
    if (!credResult.ok) {
      const msg =
        credResult.error.code === "VALIDATION_ERROR" && credResult.error.field === "sync"
          ? "Sync is not configured. Run `lore sync setup --url libsql://...` first."
          : `Sync credentials unavailable: ${credResult.error.message}`;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const localDbPath = join(loreDir, ".lore", "lore.db");
    const pullResult = await performPull(localDbPath, credResult.value.url, credResult.value.token);

    if (!pullResult.ok) {
      const msg = pullResult.error.message;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    const syncInfo = pullResult.value;

    if (args.json) {
      console.log(JSON.stringify({ ok: true, data: { pulled: true, sync: syncInfo ?? null } }));
    } else {
      console.log("Pull complete.");
      if (syncInfo) {
        console.log(`  Frame: ${syncInfo.frameNo}, synced: ${syncInfo.framesSynced}`);
      }
    }

    process.exit(0);
  },
});

// ─── sync command group ───────────────────────────────────────────────────────

export default defineCommand({
  meta: {
    name: "sync",
    description: "Manage remote Turso sync configuration",
  },
  subCommands: {
    setup: syncSetup,
    status: syncStatus,
    push: syncPushCmd,
    pull: syncPullCmd,
  },
});
