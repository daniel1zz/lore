# Security Anti-Patterns (Quick Reference)

## Injection Detection Patterns

| Type | Vulnerable Pattern | Secure Alternative |
|------|-------------------|-------------------|
| SQL | String concat/template with SQL | Parameterized queries, ORM |
| Command | `exec(userInput)` | `execFile` with array args, `spawn` without shell |
| XSS | `innerHTML = userInput` | Framework auto-escaping, DOMPurify |

### Key Detection Signals
- SQL: string concat with SQL keywords, template literals with SQL, raw queries with user input
- Command: `exec()`, `execSync()`, `spawn({shell:true})`, `eval()`
- XSS: `innerHTML`, `outerHTML`, `document.write()`, `dangerouslySetInnerHTML`

## Auth Issues

| Issue | Vulnerable | Secure |
|-------|-----------|--------|
| Password storage | md5/sha256/plaintext | bcrypt(12+), Argon2, scrypt |
| Password compare | `===` (timing attack) | `bcrypt.compare()` (constant-time) |
| Session | Predictable ID, no regen on login | `crypto.randomBytes`, regen on login |
| JWT | No algorithm check, weak secret, no expiry | Explicit algorithm whitelist, 256-bit secret, exp/iss/aud claims |
| Cookie | Missing flags | httpOnly, secure, sameSite:'strict', maxAge |

## Authorization Flaws

| Issue | Vulnerable | Secure |
|-------|-----------|--------|
| IDOR | No ownership check after auth | Scope queries to user: `where: { id, ownerId }` |
| Privilege escalation | `Object.assign(user, req.body)` | Whitelist allowed fields, separate admin endpoints |

## Data Exposure

| Issue | Fix |
|-------|-----|
| Secrets in logs | Redact: password, token, secret, api_key, credit_card, ssn, authorization |
| Hardcoded secrets | Use env vars or secret manager. Detect: git-secrets, truffleHog |
| Verbose errors | Log detailed server-side, generic message + requestId to client |

## Config Issues

| Issue | Fix |
|-------|-----|
| CORS | Whitelist origins explicitly. Never `*` with credentials |
| Security headers | Use `helmet()`. Required: HSTS, X-Content-Type-Options, X-Frame-Options, CSP |

## Crypto
- Random: `crypto.randomBytes(32)` not `Math.random()`
- Hashing: SHA-256/SHA-3 (integrity), bcrypt/Argon2 (passwords)
- Encryption: AES-256-GCM. Avoid: MD5, SHA1, DES, ECB mode
