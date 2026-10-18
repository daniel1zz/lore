/**
 * lore agent — manage API keys for AI agents.
 * Subcommands: create, list, revoke
 * Source: SPEC-010 §3.2, §6
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import { formatTable } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

const agentCreate = defineLoreCommand({
  meta: {
    name: "create",
    description: "Create a new API key for an agent",
  },
  args: {
    name: {
      type: "string",
      description: "Agent name (unique identifier)",
      required: true,
    },
    owner: {
      type: "string",
      description: "Owner identity (default: admin)",
      default: "admin",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const result = await app.apiKeyStore.create(args.name, args.owner ?? "admin");

      if (!result.ok) {
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }));
        } else {
          inv.io.stderr.write(`Error: ${result.error.code} — ${
            "message" in result.error ? result.error.message : JSON.stringify(result.error)
          }\n`);
        }
        return 1;
      }

      const { rawKey, record } = result.value;

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { name: record.name, api_key: rawKey, owner: record.owner } }));
        return;
      }

      printLine(inv.io.stdout, "Agent created:");
      printLine(inv.io.stdout, `  Name:    ${record.name}`);
      printLine(inv.io.stdout, `  API Key: ${rawKey}`);
      printLine(inv.io.stdout, `  Owner:   ${record.owner}`);
      printLine(inv.io.stdout, "");
      printLine(inv.io.stdout, "Configure in .mcp.json:");
      printLine(inv.io.stdout, `  "env": { "LORE_API_KEY": "${rawKey}" }`);
      printLine(inv.io.stdout, "");
      printLine(inv.io.stdout, "Store this key securely — it cannot be retrieved again.");
    } finally {
      app.close();
    }
  },
});

const agentList = defineLoreCommand({
  meta: {
    name: "list",
    description: "List all API keys",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const result = app.apiKeyStore.list();

      if (!result.ok) {
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }));
        } else {
          inv.io.stderr.write(`Error: ${"message" in result.error ? result.error.message : result.error.code}\n`);
        }
        return 1;
      }

      const keys = result.value;

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: keys }));
        return;
      }

      if (keys.length === 0) {
        printLine(inv.io.stdout, "No API keys found. Run `lore agent create --name <name>` to create one.");
        return;
      }

      const rows = keys.map((k) => [
        k.name,
        k.owner,
        k.revoked_at !== null ? "revoked" : "active",
        k.created_at.slice(0, 19).replace("T", " "),
      ]);

      printLine(inv.io.stdout, formatTable(["Name", "Owner", "Status", "Created"], rows));
    } finally {
      app.close();
    }
  },
});

const agentRevoke = defineLoreCommand({
  meta: {
    name: "revoke",
    description: "Revoke an agent's API key",
  },
  args: {
    name: {
      type: "positional",
      description: "Agent name to revoke",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const result = app.apiKeyStore.revoke(args.name);

      if (!result.ok) {
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }));
        } else {
          inv.io.stderr.write(`Error: ${"message" in result.error ? result.error.message : result.error.code}\n`);
        }
        return 1;
      }

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { name: args.name, revoked: true } }));
        return;
      }

      printLine(inv.io.stdout, `Agent '${args.name}' API key revoked.`);
    } finally {
      app.close();
    }
  },
});

export default defineLoreCommand({
  meta: {
    name: "agent",
    description: "Manage API keys for AI agents",
  },
  subCommands: {
    create: agentCreate,
    list: agentList,
    revoke: agentRevoke,
  },
});
