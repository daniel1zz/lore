# Security Essentials — Secret Management

## Secret Management

```typescript
// NEVER: Hardcoded secrets
const apiKey = "sk-proj-xxxxx"

// ALWAYS: Environment variables
const apiKey = process.env.OPENAI_API_KEY

if (!apiKey) {
  throw new Error('OPENAI_API_KEY not configured')
}
```

## Agent Support

- Use `Skill(review, args="security")` for inline security audits, or dispatch **lore-reader** agent for isolated review in long sessions
