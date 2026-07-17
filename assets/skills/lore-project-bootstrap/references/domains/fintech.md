# Fintech Domain

## Security Level
**CRITICAL** — financial data, PII, regulatory compliance

## Domain Terminology
| Term | Definition | Usage |
|------|-----------|-------|
| Transaction | Atomic financial operation (debit/credit) | Never partial — all-or-nothing |
| Ledger | Immutable record of all transactions | Append-only, double-entry |
| Settlement | Final transfer of funds between parties | Async, may take days |
| Reconciliation | Matching internal records with external sources | Daily batch process |
| KYC | Know Your Customer identity verification | Required before account activation |
| AML | Anti-Money Laundering checks | Continuous monitoring |

## Security Requirements
- All PII encrypted at rest (AES-256) and in transit (TLS 1.3)
- Audit trail on every data mutation (who, what, when, from_value, to_value)
- Rate limiting on all financial operations
- Idempotency keys on all payment/transfer endpoints
- Two-factor authentication for high-value operations
- No financial amounts in logs — mask to last 4 digits
- Separate read/write database connections with different permission levels

## Data Patterns
- Money as integer cents (never floating point)
- Currency always explicit — never assume
- All timestamps in UTC with timezone
- Double-entry bookkeeping: every transaction has debit + credit entries
- Soft delete only — never hard delete financial records

## Compliance
- Data retention policies per regulatory requirement
- Right to erasure: pseudonymize, don't delete financial records
- Geographic data residency requirements
- Regular security audits and penetration testing

## CLAUDE.md Section Template

```markdown
## Fintech Domain Rules
- Money as integer cents, currency always explicit, never float
- Double-entry bookkeeping: every transaction = debit + credit
- Audit trail on all mutations (who, what, when, old_value, new_value)
- PII encrypted at rest (AES-256) + transit (TLS 1.3)
- Idempotency keys on all payment/transfer endpoints
- Soft delete only — never hard delete financial records
- No financial amounts in logs — mask to last 4 digits
- All timestamps UTC with timezone
```
