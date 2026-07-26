---
id: KN-100
type: knowledge
role: knowledge
title: "g1 hook false denies: help flag gated, unparseable content flag, backtick heredoc trigger"
status: approved
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: [retro, gate-hook, g1, dogfood, false-deny]
parent: SPEC-050
links:
  - {id: SPEC-072, type: relates-to}
---
## Overview

Three g1-spec-create hook false-deny modes observed live during SPEC-072 spec authoring (2026-07-24), all rooted in the same design fact: the PreToolUse shim parses the RAW Bash command string line-by-line with sed and runs the gate against whatever it managed to extract — an unparseable `--content` degrades to EMPTY content, producing a misleading MISSING_SKELETON deny against a fully conformant spec, and quote/heredoc-blind segmentation lets mere MENTIONS of the trigger phrase fire the gate.

## Findings

1. **`lore create spec --help` is gate-denied.** The command-position trigger matches the create-spec phrase regardless of `--help`; extract_flag finds no title/parent/content; the gate runs on an empty payload and denies with PARENT_REQUIRED + MISSING_SKELETON. A help invocation performs no write and should never be gated. Repair: bail to allow when the matched segment contains `--help` before payload assembly.

2. **Unexpanded shell variables and multiline `--content` values produce misleading MISSING_SKELETON denies.** `--content "$content"` reaches the hook as the literal string `$content` (hooks see the pre-expansion command); a multiline double-quoted content never matches the line-based sed capture. Both degrade to empty CONTENT and a deny whose feeding pack points at skeleton rules the real content satisfies. The hook's own comment declares this "intentional" (gate surfaces the violation), but the UX is a false deny with a misleading diagnosis, and the BUG-014 branch already demonstrates the correct posture for exactly this situation (unresolvable input → fail open, service-layer GateEnforcer re-gates the real content at write time). Repair options: (a) detect an unrecoverable `--content` (contains `$`, or no closing quote on the same line) and fail OPEN with an UNRESOLVED_CONTENT stderr log, mirroring UNRESOLVED_CONTENT_FILE; (b) at minimum append to the deny reason that the shim could not parse the content and that `--content-file` with a path under the corpus or tmp is the parseable authoring path.

3. **Backtick-wrapped mentions of the trigger phrase inside heredoc bodies fire the gate.** A Bash call writing a markdown file via heredoc, whose BODY contained the create-spec phrase in inline code (backticks), was denied: is_command_position_match normalizes backticks to segment separators with zero quote/heredoc awareness, so the text after the backtick became a segment start = command position. This is exactly the SPEC-066 lesson (stripHeredocs before segmentation, command-position anchoring) applied to the git-safety gate but NOT to the g1-g4 gate hook shims. Repair: port the SPEC-066 stripHeredocs preprocessing into the shared segment-matching used by g1-g4 (or extract that matcher into one shared sourced shim so the fix lands once).

## Working path (for the next session hitting this)

Author the doc body with the Write tool into a scratchpad file, then create the doc with a `--content-file` absolute path under TARGET_CWD, /tmp, /private/tmp, or $TMPDIR (the BUG-014 allowlist) — the hook cats the file itself and the gate judges the real content. Keep the trigger phrase out of the command line entirely.

## Meta

This incident class is itself the use case for SPEC-072 (upstream issue reporting): a consuming agent hitting a false gate deny needs a structured channel to file it upstream. Recorded here because the defects were found in the lore repo itself; a consumer would have had no channel — until SPEC-072 lands. Candidate mechanization: a follow-up spec porting SPEC-066 preprocessing + a --help allowlist into the g1-g4 shims, with golden-fixture parity tests (SPEC-057 sanitizer precedent).
