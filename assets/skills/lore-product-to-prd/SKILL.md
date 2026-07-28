---
name: lore-product-to-prd
description: "Turn an ALREADY-CONVERGED conversation into a PRD and publish it to the project issue tracker, synthesizing only what is already known — it interviews nobody, derives nothing, and validates nothing, so every requirement it emits is tagged unvalidated. Use when the user wants to capture a discussion that has already settled. NOT for a new product or a new user-facing bet — that is `/lore-product prd`, which enforces the benchmark → opportunity → validate chain."
---

This skill takes the current conversation context and codebase understanding and produces a PRD. Do NOT interview the user — just synthesize what you already know.

⛔ **This skill deliberately bypasses the `lore-product` chain** (benchmark → ideation → discovery → opportunity → validate). It synthesizes what is already in the conversation; it derives nothing and validates nothing. Therefore every requirement it emits inherits `validation: ⚠️ unvalidated`, and the PRD must say so. For a new product or a new user-facing bet, run `/lore-product prd` instead — this skill is for capturing a discussion that has already converged.

The issue tracker and triage label vocabulary should have been provided to you — run `/setup-matt-pocock-skills` if not.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the PRD, and respect any ADRs in the area you're touching.

2. Sketch out the major modules you will need to build or modify to complete the implementation. Actively look for opportunities to extract deep modules that can be tested in isolation.

A deep module (as opposed to a shallow module) is one which encapsulates a lot of functionality in a simple, testable interface which rarely changes.

Check with the user that these modules match their expectations. Check with the user which modules they want tests written for.

3. Write the PRD using the template below, then publish it to the project issue tracker. Apply the `ready-for-agent` triage label - no need for additional triage.

<prd-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

Each story carries a validation tag, so the document cannot be mistaken for a validated one:

`1. As an <actor>, I want a <feature>, so that <benefit>  — validation: ⚠️ unvalidated (source: conversation)`

⛔ Every story emitted by this skill is `⚠️ unvalidated` by construction — nothing here ran an experiment. Do not upgrade a tag because the conversation sounded confident; conversational conviction is E6 evidence. If a story genuinely rests on a real experiment or on observed behaviour, cite that evidence inline instead.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.

</prd-template>
