# SaaS Domain

## Security Level
**HIGH** — multi-tenant data isolation, subscription billing, user management

## Domain Terminology
| Term | Definition | Usage |
|------|-----------|-------|
| Tenant | Isolated organizational unit (company/team) | All data scoped by tenant_id |
| Subscription | Recurring billing plan tied to a tenant | State: trialing → active → past_due → canceled |
| Seat | Licensed user slot within a tenant | Billable unit for per-seat pricing |
| Feature Flag | Runtime toggle for feature availability per plan/tenant | Managed via feature flag service |
| Workspace | Collaboration boundary within a tenant | Optional sub-tenant scoping |
| Quota | Usage limit per plan (API calls, storage, seats) | Enforced at middleware level |

## Multi-Tenancy
- Tenant ID on every database query — no exceptions
- Row-level security (RLS) or query-scoped middleware
- Shared database with tenant_id column (not separate DBs per tenant)
- Admin operations must explicitly bypass tenant scope with audit logging
- Cross-tenant data access is a critical security violation

## Billing Patterns
- Subscription state machine: trialing → active → past_due → canceled → expired
- Webhook-driven billing events (never poll payment provider)
- Grace period for failed payments before downgrade
- Prorated upgrades/downgrades
- Usage-based billing: meter events → aggregate → invoice

## Feature Access
- Plan-based feature gates: check at API + UI level
- Graceful degradation: show feature as locked, not hidden
- Trial includes all features (reduce friction)
- Feature flags separate from plan gates (rollout vs entitlement)

## Data Patterns
- All queries include `WHERE tenant_id = ?` (enforced at repository layer)
- Soft delete with `deleted_at` — preserve billing audit trail
- User roles per tenant (same user can be admin in one, viewer in another)
- Invitation flow: email → token → accept → join tenant

## CLAUDE.md Section Template

```markdown
## SaaS Domain Rules
- Multi-tenant: tenant_id on every query, RLS or repository-enforced scoping
- Cross-tenant data access is a critical security violation
- Subscription state machine: trialing → active → past_due → canceled
- Plan-based feature gates at API + UI level, graceful degradation (locked not hidden)
- Usage quotas enforced at middleware, metered billing via event aggregation
- User roles are per-tenant (same user, different roles in different tenants)
- Soft delete with deleted_at for billing audit trail preservation
```
