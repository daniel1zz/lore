# Mode: security - Security-Focused Review

**Purpose**: Security-focused code review (PR/commit scope)

## Boundary
- `review:security` = **Reactive** - PR security checks on changed files only
- `diagnose:security` = **Proactive** - Full security audit, vuln assessment

## Workflow

```yaml
workflow:
  1_automation:
    action: "Ask if security tools ran. Recommend and note results."
    tools: [npm audit, Semgrep, CodeQL, git-secrets, truffleHog, Snyk, Socket.dev]
    note: "Tool results are evidence — cite them in findings"

  2_doc_check:
    action: "Check project security docs + auth library official docs"
    tools: [lore search, context7, mcp-deepwiki]

  3_threat_model:
    action: "Lightweight threat model for the changed code scope"
    procedure: "See §1 Threat Model below"

  4_taint_analysis:
    action: "Source-to-sink taint analysis on changed code"
    procedure: "See §2 Taint Analysis below"

  5_auth_verification:
    action: "Verify authentication and authorization for changed endpoints"
    procedure: "See §3 Auth/AuthZ Verification below"

  6_pattern_check:
    action: "Review against OWASP + security-patterns.md for remaining categories"
    reference: "references/security-patterns.md"

  7_output:
    action: "Report findings with evidence. Security BLOCKERs MUST block merge."
```

---

## §1 Lightweight Threat Model (per-PR scope)

For each PR, build a scoped threat model covering only the changed code surface.

```yaml
threat_model_procedure:
  step_1_assets:
    action: "Identify what data/functionality the changed code exposes or processes"
    ask:
      - "What sensitive data does this code touch? (PII, credentials, financial, health)"
      - "What operations does this code enable? (create, read, update, delete, transfer)"
    output: "Asset list with sensitivity classification (public/internal/confidential/restricted)"

  step_2_entry_points:
    action: "Identify all user-facing inputs in changed code"
    sources:
      - "HTTP request: body, params, query, headers, cookies"
      - "WebSocket messages"
      - "File uploads"
      - "URL parameters and path segments"
      - "Environment variables sourced from user config"
      - "Database values that originated from user input"
    tool: "serena search_for_pattern — search for req.body, req.params, req.query, request., ctx.body, event., input"

  step_3_trust_boundaries:
    action: "Map where trust level changes in the data flow"
    boundaries:
      - "client → server (never trust client data)"
      - "public → authenticated (auth middleware present?)"
      - "user → admin (privilege check present?)"
      - "internal → external service (API key exposed? response validated?)"
      - "application → database (parameterized? ORM?)"
    tool: "serena find_referencing_symbols — trace middleware chain for each route"

  step_4_abuse_cases:
    action: "For each entry point, enumerate what an attacker could do"
    prompts:
      - "What if this input is 10x larger than expected?"
      - "What if this input contains SQL/JS/shell metacharacters?"
      - "What if the user ID in the request doesn't match the authenticated user?"
      - "What if this request is replayed 1000 times in 1 second?"
      - "What if the auth token is missing/expired/forged?"
      - "What if the external service returns malicious data?"

  step_5_mitigations:
    action: "For each abuse case, verify a control exists in the code"
    check: "Is the control applied BEFORE the dangerous operation (not after)?"

  step_6_residual_risk:
    action: "Document what remains unmitigated"
    severity: "Unmitigated abuse case with realistic attack vector → BLOCKER"
```

### Threat Model Output Template

```markdown
### Threat Model (PR-scoped)

| Asset | Sensitivity | Entry Point | Abuse Case | Mitigation | Status |
|-------|-------------|-------------|------------|------------|--------|
| {data/function} | {level} | {input source} | {attack} | {control} | ✅/❌/⚠️ |

**Residual Risks**: {list or "None identified"}
```

---

## §2 Source-to-Sink Taint Analysis

Systematic procedure to trace untrusted data from input to dangerous operations.

```yaml
taint_analysis_procedure:
  step_1_identify_sources:
    action: "List all untrusted data entry points in changed code"
    categories:
      http_input: "req.body, req.params, req.query, req.headers, req.cookies, req.files"
      url_input: "URL.searchParams, window.location, document.referrer"
      storage_input: "localStorage, sessionStorage, document.cookie (client-side)"
      message_input: "postMessage data, WebSocket message, SSE data"
      file_input: "File upload content, filename, MIME type, file size"
      db_derived: "Database values that were originally user-supplied (second-order)"
    tool: "serena search_for_pattern with patterns: req\\.(body|params|query|headers|cookies), request\\., ctx\\.(body|query|params), event\\.(body|data), input\\."

  step_2_identify_sinks:
    action: "List all dangerous operations in changed code"
    categories:
      sql_sink: "Raw SQL queries, query builders with string interpolation, .raw(), .query()"
      command_sink: "exec(), execSync(), spawn({shell:true}), child_process, eval(), Function()"
      html_sink: "innerHTML, outerHTML, document.write(), dangerouslySetInnerHTML, template engines without auto-escape"
      file_sink: "fs.writeFile with user-controlled path, path.join with user input (path traversal)"
      redirect_sink: "res.redirect(userInput), window.location = userInput (open redirect)"
      deserialize_sink: "JSON.parse of untrusted input used to construct objects, yaml.load()"
      http_sink: "fetch(userUrl), axios.get(userUrl) — SSRF potential"
      log_sink: "logger.info(sensitiveData) — information disclosure"
    tool: "serena search_for_pattern with patterns for each sink category"

  step_3_trace_paths:
    action: "For each source, trace data flow to each reachable sink"
    procedure:
      - "Start at the source (e.g., req.body.name)"
      - "Follow variable assignments, function calls, destructuring, spread"
      - "Use serena find_referencing_symbols to trace across function boundaries"
      - "Track transformations: is the data sanitized, validated, or encoded along the path?"
      - "Record the full path: source → transform1 → transform2 → ... → sink"
    per_path_assessment:
      safe: "Appropriate sanitization exists between source and sink (e.g., parameterized query for SQL sink)"
      insufficient: "Sanitization exists but doesn't match sink type (e.g., HTML encoding before SQL query)"
      missing: "No sanitization between source and sink → BLOCKER"
      bypassable: "Sanitization can be circumvented (encoding tricks, type coercion, prototype pollution) → BLOCKER"

  step_4_verify_sanitization:
    action: "For each sanitization found, verify it's correct for the sink type"
    rules:
      sql_sink: "Must use parameterized queries or ORM. String concat/template = BLOCKER"
      command_sink: "Must use execFile with array args or allowlist. Shell=true with user input = BLOCKER"
      html_sink: "Must use framework auto-escaping or DOMPurify. Raw insertion = BLOCKER"
      file_sink: "Must validate path doesn't contain .. or resolve to expected directory"
      redirect_sink: "Must validate URL against allowlist of domains/paths"
      http_sink: "Must validate URL against allowlist. Private IP ranges blocked."
    tool: "context7/mcp-deepwiki — verify sanitization library usage follows official docs"

  step_5_second_order:
    action: "Check for second-order injection — data stored unsanitized, then used in sink later"
    check:
      - "Is user input stored to DB without sanitization?"
      - "Is that DB field later used in a sink (SQL, HTML, command) without re-sanitization?"
      - "This is often missed because the store and use are in different code paths"
```

### Taint Analysis Output Template

```markdown
### Taint Analysis

| # | Source | Path | Sink | Sanitization | Verdict |
|---|--------|------|------|-------------|---------|
| 1 | `req.body.name` | → `createUser(name)` → `db.query(...)` | SQL | Parameterized ✅ | SAFE |
| 2 | `req.query.redirect` | → `res.redirect(url)` | Redirect | None ❌ | BLOCKER |
| 3 | `req.body.bio` | → `db.save()` → later `render(bio)` | HTML | None (2nd order) ❌ | BLOCKER |

**Paths traced**: {n} | **Safe**: {n} | **Vulnerable**: {n}
```

---

## §3 Auth/AuthZ Verification Procedure

Systematic check that every endpoint in changed code has proper authentication and authorization.

```yaml
auth_verification_procedure:
  step_1_enumerate_endpoints:
    action: "List all routes/endpoints/handlers in changed code"
    tool: "serena search_for_pattern — router.get, router.post, app.get, @Get, @Post, export default function handler, export async function GET/POST"
    output: "Endpoint list with HTTP method and path"

  step_2_verify_authentication:
    action: "For each endpoint, verify authentication is required (unless intentionally public)"
    check:
      - "Is there auth middleware on this route? (e.g., requireAuth, isAuthenticated, withAuth)"
      - "Is the middleware applied at the route level, router level, or app level?"
      - "Can the route be accessed by skipping the middleware? (alternative path, direct handler call)"
    tool: "serena find_referencing_symbols — trace the middleware chain for each route"
    bypass_checks:
      - "Does the framework support both authenticated and unauthenticated paths to the same handler?"
      - "Is there a catch-all route that skips auth?"
      - "Are WebSocket connections authenticated? (often missed)"

  step_3_verify_authorization:
    action: "For each authenticated endpoint, verify the user is authorized for the specific operation"
    checks:
      idor:
        rule: "Resource lookups MUST be scoped to the authenticated user"
        bad: "db.findById(req.params.id) — any user can access any resource"
        good: "db.findOne({ id: req.params.id, ownerId: req.user.id })"
        tool: "serena search_for_pattern — findById, findUnique, findOne WITHOUT ownerId/userId/user.id scope"
      privilege_escalation:
        rule: "Role checks must guard admin/elevated operations"
        check: "Is there a role check (isAdmin, hasRole, can) before privileged operations?"
        bad: "Object.assign(user, req.body) — user can set their own role"
        good: "Allowlist fields: pick(req.body, ['name', 'email'])"
      horizontal_access:
        rule: "User A cannot access User B's resources"
        check: "Are cross-user queries prevented at the data layer?"

  step_4_session_token:
    action: "Verify session/token handling follows security best practices"
    checks:
      - "JWT: algorithm explicitly set (not 'none')? Secret strength ≥256 bits? Expiration set?"
      - "Session: regenerated on login? HttpOnly + Secure + SameSite cookie flags?"
      - "Token: stored safely? (not in localStorage if XSS-vulnerable)"
    tool: "context7 — check auth library docs for recommended configuration"
```

---

## OWASP Quick Checklist (pattern matching — after procedures above)

After completing the systematic procedures (§1-§3), do a final scan for remaining OWASP categories not covered by taint analysis or auth checks:

- **A03 Injection**: Covered by §2 Taint Analysis
- **A01 Broken Access Control**: Covered by §3 Auth/AuthZ Verification
- **A02 Cryptographic Failures**: Sensitive data in logs? Hardcoded secrets? Insecure transmission (HTTP vs HTTPS)?
- **A05 Security Misconfiguration**: Default creds? Debug mode in prod? Permissive CORS? Missing security headers?
- **A04 Insecure Design**: Missing rate limiting? Business logic flaws? (covered partially by §1 Threat Model)
- **A06 Vulnerable Components**: Outdated dependencies with known CVEs? (npm audit output)

## Tools
- Code: serena (find_symbol, search_for_pattern, find_referencing_symbols — critical for tracing data flow)
- PR: github (get_diff, get_files, add_comment_to_pending_review)
- Docs: context7, mcp-deepwiki (for auth/crypto libraries)

**MANDATORY**: Read `references/security-patterns.md` for vulnerability pattern quick reference.

## Exit Criteria (security-specific)

```yaml
security_exit_gates:
  taint_complete: "All source→sink paths in changed code traced and assessed"
  auth_complete: "All endpoints in changed code verified for authn + authz"
  threat_model: "At least entry points + abuse cases documented"
  no_unresolved: "No BLOCKER findings left without a fix suggestion"
  evidence: "Every security finding has: code path, attack scenario, and fix"
```
