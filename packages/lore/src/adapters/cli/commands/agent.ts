/**
 * lore agent — manage API keys for AI agents.
 * Subcommands: create, list, revoke
 * Source: SPEC-010 §3.2, §6
 */

import { defineCommand } from "citty";
import { setExitCode } from "../run-scope.js";
import { loadLoreApp } from "../loader.js";
import { formatTable } from "../utils.js";
import { invocationOf } from "../command-invocation.js";

const agentCreate = defineCommand({
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
          console.log(JSON.stringify({ ok: false, error: result.error }));
        } else {
          process.stderr.write(`Error: ${result.error.code} — ${
            "message" in result.error ? result.error.message : JSON.stringify(result.error)
          }\n`);
        }
        setExitCode(1);
        return;
      }

      const { rawKey, record } = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { name: record.name, api_key: rawKey, owner: record.owner } }));
        return;
      }

      console.log("Agent created:");
      console.log(`  Name:    ${record.name}`);
      console.log(`  API Key: ${rawKey}`);
      console.log(`  Owner:   ${record.owner}`);
      console.log("");
      console.log("Configure in .mcp.json:");
      console.log(`  "env": { "LORE_API_KEY": "${rawKey}" }`);
      console.log("");
      console.log("Store this key securely — it cannot be retrieved again.");
    } finally {
      app.close();
    }
  },
});

const agentList = defineCommand({
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
          console.log(JSON.stringify({ ok: false, error: result.error }));
        } else {
          process.stderr.write(`Error: ${"message" in result.error ? result.error.message : result.error.code}\n`);
        }
        setExitCode(1);
        return;
      }

      const keys = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: keys }));
        return;
      }

      if (keys.length === 0) {
        console.log("No API keys found. Run `lore agent create --name <name>` to create one.");
        return;
      }

      const rows = keys.map((k) => [
        k.name,
        k.owner,
        k.revoked_at !== null ? "revoked" : "active",
        k.created_at.slice(0, 19).replace("T", " "),
      ]);

      console.log(formatTable(["Name", "Owner", "Status", "Created"], rows));
    } finally {
      app.close();
    }
  },
});

const agentRevoke = defineCommand({
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
          console.log(JSON.stringify({ ok: false, error: result.error }));
        } else {
          process.stderr.write(`Error: ${"message" in result.error ? result.error.message : result.error.code}\n`);
        }
        setExitCode(1);
        return;
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { name: args.name, revoked: true } }));
        return;
      }

      console.log(`Agent '${args.name}' API key revoked.`);
    } finally {
      app.close();
    }
  },
});

export default defineCommand({
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
