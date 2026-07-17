# Mode: Security Testing

**Purpose**: Vulnerability assessment, security verification, and threat-based test case derivation.

## Loop Specialization

| Step | Security specifics |
|------|-------------------|
| ANALYZE | Attack surface mapping, OWASP Top 10 relevance, permission boundaries, data flow, trust zones |
| DESIGN | Threat model (STRIDE) → derive test cases from threats. Permission matrix. Injection surface map |
| SETUP | Test credentials (never production), isolated environment, scan tool configuration |
| EXECUTE | Automated scans first (SAST → SCA → secrets → DAST), then targeted manual tests |
| GATE | 0 critical/high findings. Medium requires triage: fix or accept with justification |
| CLEANUP | Revoke test credentials, remove test payloads, collect scan reports |
| PERSIST | Update test-plan with: findings summary, severity distribution, remediation status |

## Tool Chain

### SAST (Static Application Security Testing)

| Tool | Install | Strength |
|------|---------|----------|
| **Semgrep** | `pip install semgrep` or Docker | Custom rules, fast, multi-language |
| **CodeQL** | GitHub native | Deep dataflow analysis, free for OSS |
| **Snyk Code** | `npm i -g snyk` | IDE integration, real-time |

```bash
# Semgrep: quick scan with OWASP rules
semgrep scan --config=p/owasp-top-ten --json -o sast-results.json .

# Semgrep: full security audit
semgrep scan --config=p/security-audit --config=p/secrets --json -o sast-full.json .

# Custom Semgrep rule example (detect SQL injection)
# rules/sql-injection.yaml
rules:
  - id: raw-sql-user-input
    patterns:
      - pattern: db.query($SQL, ...)
      - pattern-not: db.query($SQL, [...])
    message: "Potential SQL injection — use parameterized queries"
    severity: ERROR
```

### SCA (Software Composition Analysis)

```bash
# npm audit (built-in)
npm audit --json > sca-npm.json

# Snyk (more comprehensive)
snyk test --json > sca-snyk.json

# Socket.dev (supply chain focus)
npx socket check --json > sca-socket.json
```

### Secrets Detection

```bash
# GitLeaks: scan current state + git history
gitleaks detect --source=. --report-format=json --report-path=secrets-report.json

# TruffleHog: entropy + pattern matching
trufflehog filesystem . --json > secrets-trufflehog.json
```

### DAST (Dynamic Application Security Testing)

| Tool | Use Case |
|------|----------|
| **OWASP ZAP** | Automated proxy-based scanning |
| **Burp Suite** | Manual + automated (commercial) |
| **Nuclei** | Template-based vulnerability scanning |

```bash
# ZAP baseline scan (quick, CI-friendly)
docker run --rm -t zaproxy/zap-stable zap-baseline.py \
  -t http://localhost:3000 -J zap-report.json

# ZAP full scan (deeper, takes longer)
docker run --rm -t zaproxy/zap-stable zap-full-scan.py \
  -t http://localhost:3000 -J zap-full.json
```

## OWASP Top 10 Test Matrix

| Category | Test Focus | Test Pattern | Automated? |
|----------|-----------|--------------|------------|
| **A01 Broken Access Control** | Horizontal/vertical escalation, IDOR, missing auth | See permission matrix below | Partial |
| **A02 Crypto Failures** | TLS config, weak algorithms, data at rest | Semgrep crypto rules + manual | Yes |
| **A03 Injection** | SQL, NoSQL, command, template, XSS | Parameterized input fuzzing | Yes (SAST+DAST) |
| **A04 Insecure Design** | Business logic flaws, abuse cases, rate limiting | Manual threat modeling | Manual |
| **A05 Security Misconfiguration** | Default creds, unnecessary features, error exposure, CORS | Config audit + DAST | Yes |
| **A06 Vulnerable Components** | Outdated deps, known CVEs, transitive vulns | SCA scans | Yes |
| **A07 Auth Failures** | Brute force, session mgmt, password policies, MFA | Auth flow tests | Partial |
| **A08 Data Integrity** | Deserialization, CI/CD pipeline, update verification | SAST + manual | Manual |
| **A09 Logging Failures** | Sensitive data in logs, insufficient audit trail | Log grep + review | Manual |
| **A10 SSRF** | Internal resource access, cloud metadata (169.254.169.254) | URL validation tests | Partial |

## Security Test Patterns (Code Examples)

### API Authentication / Authorization

```typescript
describe('security: access control', () => {
  describe('happy path', () => {
    it('allows admin to access admin endpoint', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe('negative cases', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(401);
    });

    it('rejects regular user from admin endpoints', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });

    it('prevents IDOR: user cannot access other user data', async () => {
      const res = await request(app)
        .get('/api/users/other-user-id/profile')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('boundary values', () => {
    it('rejects expired JWT token', async () => {
      const expiredToken = createToken({ exp: Math.floor(Date.now() / 1000) - 1 });
      const res = await request(app)
        .get('/api/me')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
    });

    it('rejects malformed Authorization header', async () => {
      const res = await request(app)
        .get('/api/me')
        .set('Authorization', 'not-a-valid-token');
      expect(res.status).toBe(401);
    });
  });
});
```

### Input Validation / Injection Prevention

```typescript
describe('security: injection prevention', () => {
  const injectionPayloads = [
    { name: 'SQL injection', value: "'; DROP TABLE users; --" },
    { name: 'NoSQL injection', value: '{"$gt": ""}' },
    { name: 'XSS reflected', value: '<script>alert("xss")</script>' },
    { name: 'XSS attribute', value: '" onmouseover="alert(1)"' },
    { name: 'Command injection', value: '; cat /etc/passwd' },
    { name: 'Template injection', value: '{{7*7}}' },
    { name: 'Path traversal', value: '../../etc/passwd' },
  ];

  it.each(injectionPayloads)(
    'sanitizes $name payload in search endpoint',
    async ({ value }) => {
      const res = await request(app)
        .get('/api/search')
        .query({ q: value });
      expect(res.status).not.toBe(500); // no server crash
      expect(res.text).not.toContain(value); // no reflection
    }
  );
});
```

### Sensitive Data Exposure

```typescript
describe('security: data exposure', () => {
  it('error responses do not leak stack traces', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.body).not.toHaveProperty('stack');
    expect(JSON.stringify(res.body)).not.toMatch(/at\s+\w+\s+\(/); // no stack frames
  });

  it('user endpoint does not expose password hash', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.body).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('logs do not contain sensitive data', async () => {
    // Capture logs during a login attempt
    const logs = await captureLogsDuring(async () => {
      await request(app).post('/api/login').send({ email: 'test@x.com', password: 'secret123' });
    });
    const logText = logs.join('\n');
    expect(logText).not.toContain('secret123');
    expect(logText).not.toContain('password');
  });
});
```

## Permission Matrix Testing

Define and test the complete roles × resources × actions matrix:

```typescript
const permissionMatrix = [
  // [role, resource, action, expected]
  ['admin', '/api/users', 'GET', 200],
  ['admin', '/api/users', 'DELETE', 200],
  ['user', '/api/users', 'GET', 403],
  ['user', '/api/users', 'DELETE', 403],
  ['user', '/api/me', 'GET', 200],
  ['guest', '/api/me', 'GET', 401],
] as const;

it.each(permissionMatrix)(
  '%s accessing %s via %s → %i',
  async (role, resource, method, expected) => {
    const token = tokens[role];
    const res = await request(app)[method.toLowerCase()](resource)
      .set('Authorization', token ? `Bearer ${token}` : '');
    expect(res.status).toBe(expected);
  }
);
```

## Threat Model (Lightweight STRIDE)

```
1. Assets: What are we protecting? (user data, credentials, API keys, sessions)
2. Threats per STRIDE:
   - Spoofing → auth bypass, token forgery
   - Tampering → data modification, request manipulation
   - Repudiation → missing audit logs, unsigned actions
   - Info Disclosure → data leaks, verbose errors, side channels
   - Denial of Service → rate limiting gaps, resource exhaustion
   - Elevation → privilege escalation, role confusion
3. Controls: What prevents each threat?
4. Gaps: Where are controls missing? → These become test cases
```

## False Positive Handling

- Triage every finding: true positive → fix, false positive → document + suppress
- Suppression requires justification: `// nosemgrep: <rule-id> reason`
- Review suppressions quarterly or on dependency update

## CI/CD Integration

```yaml
# Security gates in PR pipeline
- name: SAST
  run: semgrep scan --config=p/owasp-top-ten --error
- name: SCA
  run: npm audit --audit-level=high
- name: Secrets
  run: gitleaks detect --source=. --exit-code=1
# DAST in nightly pipeline (requires running app)
```

## Retest Protocol

1. After fix: rerun the specific scan/test that found the issue
2. Verify fix doesn't introduce new issues (regression scan)
3. Update finding status: `found → fixed → verified`

## Official Docs (MANDATORY)

- OWASP Top 10: https://owasp.org/Top10/
- OWASP Testing Guide, ASVS, Cheat Sheet Series
- context7: resolve-library-id for semgrep / zap → query-docs for rules configuration
