# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.

## [Unreleased]

### Added

- `context.memory_files.*` config section (`contextConfigSchema` in `@lore/core`
  `config.ts`) — the numbers SSOT for the project-CLAUDE.md content contract
  (spec-project-claude-md-content-contract-governance-injected §D1/D8):
  `filenames` (default `["CLAUDE.md"]`), `root` ceiling (default
  300 lines / 30720 bytes), `module` ceiling (default 200 lines / 16384 bytes),
  and `enabled` (default `true`). Exposed via `resolveMemoryFileBudgets(config)`.

### Compatibility

- **Binary version floor for configs carrying `context.*`**: `LoreConfigSchema`
  is `.strict()` at the top level, so any `.lore/config.yaml` /
  `~/.config/lore/config.yaml` that sets a `context:` key is rejected
  (`VALIDATION_ERROR`, unrecognized key) by any Lore binary built **before**
  this change landed. Teams sharing a config file across machines must
  upgrade every machine's `lore` binary before adopting `context.memory_files`
  overrides. This mirrors the existing back-compat contract for every prior
  `.strict()` top-level key addition (`workflow`, `audit`, `verify`,
  `feedback`, `setup`) — none of them are new to this pattern, only `context`
  is new as a key.
