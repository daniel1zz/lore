# Mode: Tech Assessment

**Purpose**: Assess technical feasibility with business context

## Default Stance: Adopt First, Build Only When Justified

### Step 1: Search (MANDATORY before any build recommendation)
- `WebSearch('{problem domain} SaaS/library/SDK')`
- Search GitHub for OSS alternatives
- Evaluate via context7/deepwiki for docs and maturity
- Output: ≥3 candidate solutions with maturity assessment

### Step 2: Evaluate Candidates

| Criterion | Check |
|-----------|-------|
| Maturity | Stars, contributors, release frequency, last commit |
| Fit | Covers ≥80% of PRD requirements? |
| Cost | TCO over 2 years (license + integration + maintenance) |
| Risk | Vendor lock-in, sunset risk, community health |

### Step 3: Decide

| Decision | Condition |
|----------|-----------|
| **Adopt** | Any candidate ≥70% fit AND actively maintained |
| **Build** | ALL: no candidate ≥50% fit + core differentiator + team capability + maintenance budget committed |
| **Hybrid** | Candidate covers core but needs extension/wrapper |

Build gate: Must satisfy ≥2 build conditions.

### Anti-Patterns
- Assuming build before searching
- Rejecting solutions for minor gaps
- NIH syndrome
- Comparing ideal custom build vs real-world vendor

## Hidden Costs

| Building | Adopting |
|----------|----------|
| Maintenance 3-5x initial build | Integration/migration effort |
| Opportunity cost of eng time | Vendor dependency |
| Knowledge silos, bus factor | Learning curve |
| Security patching ownership | Feature gaps needing workarounds |

## Key Questions Beyond "Can We Build It?"
- Should we build this given our capabilities?
- Ongoing maintenance cost?
- How does this affect ability to pivot?
- What tech debt are we taking on?

## Required Output
- Existing solution landscape (≥3 candidates evaluated)
- Honest feasibility assessment
- Risks with mitigations
- Build vs adopt recommendation with reasoning
- Long-term maintenance implications
- Artifact: `lore template show spec --kind tech --blank > f.yaml` → fill → `lore create spec --title ... --kind tech --fields-file f.yaml`

## Triggers
"Can we build this", "Technical feasibility", "Build or buy", "Tech assessment", "What library/service should we use"
