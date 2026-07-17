# E-Commerce Domain

## Security Level
**HIGH** — payment data, user PII, inventory integrity

## Domain Terminology
| Term | Definition | Usage |
|------|-----------|-------|
| SKU | Stock Keeping Unit — unique product variant identifier | Immutable once created |
| Cart | Temporary collection of items before checkout | Ephemeral, session-bound |
| Order | Confirmed purchase with payment commitment | Immutable after placement |
| Fulfillment | Process of shipping order to customer | State machine: pending → processing → shipped → delivered |
| Inventory | Available stock count per SKU per warehouse | Requires locking for concurrent operations |
| Refund | Reversal of payment (full or partial) | Creates inverse transaction, never deletes original |

## Business Rules
- Inventory: optimistic locking with version field, decrement on order placement
- Price: stored as integer cents, currency explicit, includes tax calculation context
- Orders: state machine with defined transitions, no backward moves
- Cart → Order: atomic operation (validate stock + create order + decrement inventory + charge payment)
- Refunds: partial allowed, creates separate refund record linked to original order

## Data Patterns
- Product catalog: denormalized for read performance (search index)
- Order history: immutable append-only records
- Inventory: real-time count with reservation system for in-progress checkouts
- Addresses: structured fields (not free text), validated against postal service

## Integration Points
- Payment gateway (WeChat Pay / Alipay / Stripe)
- Shipping providers (tracking number, status webhooks)
- Search engine (Elasticsearch / Algolia for product search)
- Notification service (order confirmation, shipping updates)

## CLAUDE.md Section Template

```markdown
## E-Commerce Domain Rules
- Price as integer cents, currency explicit, tax context required
- Inventory with optimistic locking (version field), reservation for in-progress checkout
- Order state machine: created → paid → processing → shipped → delivered → completed
- Cart → Order is atomic: validate stock + create order + decrement inventory + charge
- Refunds create inverse records, never modify original order/transaction
- Product catalog denormalized for search, order history append-only
```
