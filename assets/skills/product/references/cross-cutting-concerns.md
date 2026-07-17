# Cross-Cutting Concerns Framework

> Ethics, privacy, inclusive design, and sustainability are not NFR checkboxes — they are product decisions that affect every mode. This framework provides mandatory integration points.

## 1. Ethics & Responsible Design

### Dark Pattern Detection

Before shipping any feature, verify absence of:

| Pattern | Test Question |
|---------|--------------|
| **Forced continuity** | Can users cancel as easily as they subscribed? |
| **Hidden costs** | Are all costs visible before the commitment point? |
| **Misdirection** | Does the UI guide users toward THEIR goal, not ours? |
| **Confirmshaming** | Do opt-out labels use neutral language (not guilt)? |
| **Roach motel** | Is data export and account deletion straightforward? |
| **Privacy zuckering** | Are privacy defaults protective, not permissive? |
| **Bait and switch** | Does the product deliver what was promised at signup? |

### AI Ethics Considerations

| Concern | Check |
|---------|-------|
| **Transparency** | Do users know when they're interacting with AI? |
| **Bias** | Has training data been audited for demographic bias? |
| **Explainability** | Can the system explain why it made a recommendation? |
| **Override** | Can users override or opt out of automated decisions? |
| **Accountability** | Is there a human-in-the-loop for high-stakes decisions? |
| **Harm potential** | Could this feature be weaponized or cause unintended harm? |

### Ethical Decision Framework

When a feature raises ethical questions:
1. **Newspaper test**: Would you be proud if this was on the front page?
2. **Vulnerable user test**: How does this affect the most vulnerable user?
3. **Scale test**: What happens if 1M people use this in ways we didn't intend?
4. **Reversal test**: If a competitor did this to OUR users, would we object?

## 2. Data Privacy & Security

### Privacy by Design Principles

| Principle | Application |
|-----------|-------------|
| **Data minimization** | Collect only what the product requires. Default to not collecting. |
| **Purpose limitation** | Each data point has a documented purpose. No "might be useful later." |
| **Storage limitation** | Define retention periods. Auto-delete when purpose fulfilled. |
| **Consent architecture** | Granular, informed, revocable consent. Not a wall-of-text checkbox. |
| **Right to access/delete** | Users can export and delete their data without contacting support. |
| **Breach notification** | Plan exists for notifying users within regulatory timeframes. |

### Privacy Impact Assessment (Quick)

For each new feature that handles user data:

| Question | Answer |
|----------|--------|
| What data is collected? | {enumerate specifically} |
| Why is it needed? | {link to requirement} |
| Where is it stored? | {system + jurisdiction} |
| Who can access it? | {roles + access controls} |
| How long is it kept? | {retention period + deletion trigger} |
| What if it leaks? | {impact assessment + mitigation} |

### Regulatory Checklist

| Regulation | Key Requirements |
|-----------|-----------------|
| **GDPR** (EU) | Consent, right to erasure, DPO, data portability, 72h breach notification |
| **CCPA/CPRA** (California) | Right to know, delete, opt-out of sale, non-discrimination |
| **COPPA** (Children) | Parental consent for <13, data minimization, no behavioral advertising |
| **Sector-specific** | HIPAA (health), PCI-DSS (payments), SOC2 (enterprise) |

## 3. Inclusive Design

### Beyond WCAG Compliance

WCAG is the floor, not the ceiling. Consider:

| Dimension | Questions |
|-----------|-----------|
| **Visual** | Works with screen readers? Sufficient contrast? No color-only information? Resizable text? |
| **Motor** | Keyboard-navigable? Touch targets ≥44px? No fine motor requirements? |
| **Cognitive** | Clear language? Consistent navigation? Error prevention? Manageable complexity? |
| **Situational** | Works in bright sunlight? One-handed? In noisy environment? On slow connection? |
| **Cultural** | No cultural assumptions? RTL support? Date/number/currency localization? Color meaning varies? |
| **Economic** | Works on low-end devices? Reasonable data usage? Offline capability? |

### Inclusive Design Heuristics

1. **Recognize exclusion**: Who can't use this? (permanent, temporary, situational)
2. **Solve for one, extend to many**: Captions for deaf users → also helps in noisy bars
3. **Learn from diversity**: Test with diverse users, not just "average" users
4. **Offer multiple means**: Multiple ways to complete every critical action

### Accessibility Testing Requirements

| Level | When | What |
|-------|------|------|
| **Automated** | Every build | axe-core/Lighthouse audit, zero critical violations |
| **Manual** | Each feature | Keyboard navigation, screen reader test, zoom to 200% |
| **User testing** | Quarterly | Include participants with disabilities in research |

## 4. Sustainability & Digital Wellbeing

### Environmental Responsibility

| Concern | Product Decision |
|---------|-----------------|
| **Page weight** | Minimize asset size. Lazy-load below-fold content. |
| **API efficiency** | Batch requests. Cache aggressively. Avoid polling when push available. |
| **Compute** | Right-size infrastructure. Prefer efficient algorithms. |
| **Dark mode** | Offer dark mode (OLED screens use less power). |

### Digital Wellbeing

| Concern | Product Decision |
|---------|-----------------|
| **Attention respect** | No unnecessary notifications. Respect DND settings. |
| **Time well spent** | Does usage feel productive to the user, not just to our engagement metrics? |
| **Addiction patterns** | No infinite scroll without pause points. No variable-ratio reward schedules. |
| **Data dignity** | Users own their data. No lock-in through data hostage. |

## Mandatory Integration Points

### In Discovery Mode (add to Phase 3 synthesis)
- [ ] Privacy impact: Does the opportunity require sensitive data? Is it worth the privacy cost?
- [ ] Ethical risk: Could this be used harmfully at scale?
- [ ] Inclusivity: Who is excluded from the target market and why?

### In PRD Mode (add to quality checklist)
- [ ] Privacy: Data collection justified and minimized? Consent architecture defined?
- [ ] Ethics: Dark pattern audit passed? AI ethics checklist completed (if applicable)?
- [ ] Accessibility: WCAG AA target stated? Specific a11y requirements in NFRs?
- [ ] Inclusivity: Multiple interaction modes? Cultural considerations documented?

### In Roadmap Mode (add to prioritization)
- [ ] Privacy debt: Are we accumulating data we shouldn't be?
- [ ] Accessibility debt: Are we shipping without a11y and planning to "add it later" (usually never)?
- [ ] Ethical review: Has any roadmap item been flagged for ethical review?

### In Tech Assessment Mode (add to evaluation criteria)
- [ ] Privacy: Does the vendor/library meet our privacy requirements?
- [ ] Security: Has the solution been audited? Active security maintenance?
- [ ] Accessibility: Does the solution support a11y out of the box?

### In UX Research Mode (add to research ethics)
- [ ] Informed consent obtained?
- [ ] Data anonymized before analysis?
- [ ] Vulnerable populations identified and protected?
- [ ] Compensation fair but not coercive?

## Triggers
"Ethics review", "Privacy impact", "Accessibility check", "Inclusive design",
"Dark patterns", "GDPR compliance", "Data handling", "Responsible AI"
