# Mode: discover

Self-evolution mode — given a platform/service name, automatically discover its CLI, MCP server, existing skills, and API documentation, then generate integration config.

## Usage

```
/lore-auto-wire discover <platform>
```

Example: `/lore-auto-wire discover stripe`

## Why This Mode Exists

Instead of manually researching and writing reference files for each new tool, this mode automates the discovery:
1. Finds the platform's CLI tool
2. Finds MCP servers that connect to it
3. Finds existing Claude Code skills for it
4. Reads official docs for setup patterns
5. Generates a tool reference file + updates the skill

The result: the skill grows itself. Each `discover` run teaches lore-auto-wire about a new platform.

## Procedure

### Step 1: Parallel Discovery (fan out 4 searches)

Run all searches simultaneously:

**1a. CLI Discovery**
```bash
# npm CLI tools
npm search <platform> cli --json 2>/dev/null | head -20

# Homebrew (macOS)
brew search <platform> 2>/dev/null

# Check if already installed
command -v <platform> 2>/dev/null || command -v <platform>-cli 2>/dev/null
```

**1b. MCP Server Discovery**
```bash
# Search npm for MCP servers
npm search "mcp <platform>" --json 2>/dev/null | head -10
npm search "@<platform>/mcp" --json 2>/dev/null | head -5

# Check already-connected MCP servers
# Look at ToolSearch results for mcp__<platform>__* tools
```

Also search:
- `ToolSearch` with keyword `<platform>` — checks connected MCP servers
- Known MCP registries: smithery.ai, mcp.run, glama.ai

**1c. Existing Skill Discovery**
```bash
# Check installed skills
ls ~/.claude/skills/ | grep -i <platform>

# Check plugin skills
ls ~/.claude/plugins/*/skills/ 2>/dev/null | grep -i <platform>
```

**1d. Documentation Discovery**
Use these tools in order (stop when found):
1. `context7`: `resolve-library-id` → `query-docs` for setup/CLI/API reference
2. `deepwiki`: `read_wiki_structure` for GitHub repos like `<platform>/<platform>-cli`
3. `WebSearch`: `"<platform> CLI setup" OR "<platform> developer API quickstart"`

### Step 2: Analyze Findings

Compile what was found into categories:

```
=== Discovery Report: <platform> ===

CLI Tools Found:
  - <package-name> (npm) — <description>
  - <formula> (brew) — <description>
  
MCP Servers Found:
  - <mcp-package> — <description>
  - Already connected: mcp__<platform>__* (N tools available)

Existing Skills:
  - <skill-name> — <description>
  
Official Docs:
  - Setup guide: <url>
  - API reference: <url>
  - Auth method: API key / OAuth / token
```

### Step 3: Generate Tool Reference

Create `references/tools/<platform>.md` with:

```markdown
# Tool: <platform>

## Overview
<one-line description from discovery>

## Installation
<CLI install command from Step 1a>

## Authentication
<auth method from docs — API key / OAuth / login command>

## Key Commands
<top 5-10 commands relevant to project setup>

## MCP Integration
<MCP server name and install command, if found>

## Env Vars
<required environment variables>

## Integration with lore-auto-wire
- init-project: <what this tool does during project creation>
- add: <how to add this service to existing project>
- rotate: <which secrets can be rotated>

## Source
- CLI: <npm package or brew formula>
- MCP: <mcp package name>
- Docs: <official docs URL>
- Discovered: <date>
```

### Step 4: Update Skill Configuration

**4a. Update mode-add.md** — add the new service to the supported services table:
```markdown
| `<platform>` | <description> | <ENV_VAR_1>, <ENV_VAR_2> |
```

**4b. Update mode-rotate.md** — if the service has rotatable secrets, add to the table.

**4c. Update SKILL.md** — add the platform name to the description triggers so the skill fires when user mentions it.

**4d. Suggest MCP installation** — if an MCP server was found:
```
Found MCP server: <package>
Install with: claude mcp add <name> -- npx <package>
This gives Claude direct access to <platform> APIs.
```

**4e. Suggest skill installation** — if a relevant skill was found:
```
Found skill: <skill-name>
This skill provides <description>.
The discover mode adds CLI/infra management; the existing skill adds workflow guidance.
```

### Step 5: Verify

```bash
# Check the generated reference file
cat ~/.claude/skills/lore-auto-wire/references/tools/<platform>.md

# If CLI was installed, verify
<platform> --version 2>/dev/null
```

## Output

```
✅ Discovered: <platform>

  CLI: <package> (installed / available via npm/brew)
  MCP: <mcp-package> (suggest: claude mcp add ...)
  Skill: <skill-name> (already installed / suggest install)
  Docs: <url>
  
  Generated: references/tools/<platform>.md
  Updated: mode-add.md (new service entry)
  
  To use: /lore-auto-wire add <platform>
```

## Discovery Heuristics

When search results are ambiguous:

1. **Multiple CLIs found** → prefer official (org-scoped `@platform/cli`), then most-downloaded
2. **Multiple MCP servers** → prefer official, then most recently updated
3. **No CLI found** → check if platform has a REST API → generate curl-based reference
4. **No MCP found** → note as "API-only integration" in the reference file
5. **Platform is an umbrella** (e.g., "AWS") → ask user which specific service (S3, Lambda, RDS...)

## Self-Evolution Pattern

Over time, the tools/ directory grows:

```
references/tools/
├── neonctl.md        ← from init-tools (built-in)
├── vercel-cli.md     ← from init-tools (built-in)
├── gcloud.md         ← from init-tools (built-in)
├── gh-cli.md         ← from init-tools (built-in)
├── stripe.md         ← from discover
├── resend.md         ← from discover
├── upstash.md        ← from discover
├── cloudflare.md     ← from discover
└── ...               ← each discover adds one
```

Each reference file follows the same structure, making the skill's knowledge uniform and searchable.
