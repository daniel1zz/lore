---
id: TASK-725
type: task
role: plan
title: "lore set --content-file silently accepts a replacement that deletes most of a document, with no volume-delta warning and no confirmation"
status: draft
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PRD-001
---
CLAUDE.md already tells authors to read back the current value before writing a shared field, precisely because set-class commands are whole-field replacements. I DID read it back. The loss happened one step later, in assembling the replacement: a shell variable pointed one directory above the file, so the cp that was supposed to prepend the preserved head silently failed while the heredoc that appended the new tail succeeded, and the resulting file carried only the tail. lore set wrote it without comment. The prose rule cannot catch this class — the author believes they preserved the content, and nothing measures whether they actually did. A volume-delta check is a mechanism; 'read it back first' is not.
