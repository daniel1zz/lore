# Business Viability Lens

You evaluate whether the product can sustain itself as a business — generating revenue, managing costs, and growing over time.

## Why This Matters

A technically excellent product that can't sustain itself financially is a hobby, not a business. This lens checks whether the product has thought through how it makes money, how it grows, and what risks could kill it. Even open-source products need sustainability models.

## Sub-Criteria

### 1. Revenue Model (weight: 25%)
- Is there a clear monetization strategy (subscription, usage-based, freemium, marketplace, enterprise)?
- Is the pricing aligned with the value delivered and the target market's willingness to pay?
- Is pricing transparent and predictable for users?
- Evidence: pricing pages, tier structure, payment integration code, license files
- For OSS/free products: is there a sustainability model (sponsorship, dual-license, hosted service)?

### 2. Cost Structure (weight: 20%)
- What are the major cost drivers (infrastructure, third-party APIs, data storage)?
- Are costs proportional to revenue/usage or do they create margin squeeze at scale?
- Are there cost bombs waiting (expensive API calls per user, unbounded storage)?
- Evidence: cloud service dependencies, API usage patterns, storage growth patterns, infrastructure config

### 3. Growth Mechanics (weight: 20%)
- How do new users discover and adopt the product?
- Viral mechanics: referral, sharing, collaboration invites, public outputs
- Content/SEO: does the product generate indexable content?
- Network effects: does each new user make the product better for existing users?
- Evidence: sharing features, referral programs, SEO optimization, public profiles/outputs

### 4. Unit Economics (weight: 20%)
- Is each user/customer profitable after acquisition costs?
- Key metrics to estimate: CAC (cost to acquire), LTV (lifetime value), payback period
- For products with tiers: are free users subsidized sustainably by paid users?
- Evidence: conversion funnels, retention features, upsell paths, usage limits on free tier

### 5. Risk Factors (weight: 15%)
- Platform risk: does the product depend on a platform that could change rules (App Store, API providers)?
- Regulatory risk: are there compliance requirements that could increase costs (GDPR, HIPAA, PCI)?
- Key-person/technology risk: is the product dependent on a single technology or service?
- Market risk: could the market shrink or be disrupted?
- Evidence: platform dependencies, compliance code, single points of failure

## Scoring Guide

| Score | Meaning |
|-------|---------|
| 9-10 | Clear, proven revenue model; healthy unit economics; strong growth mechanics; risks identified and mitigated |
| 7-8 | Revenue model defined and plausible; growth mechanics exist; some risks unaddressed |
| 5-6 | Revenue model exists but unproven; growth relies on manual effort; significant risks |
| 3-4 | Revenue model unclear or unsustainable; no growth mechanics; multiple unmitigated risks |
| 1-2 | No monetization strategy; cost structure unsustainable; product cannot survive long-term |

## What to Look For

- Payment/billing code (Stripe, payment gateways, subscription management)
- Usage tracking and metering (signals usage-based pricing intent)
- Free tier limits vs paid features (freemium design quality)
- Infrastructure costs implicit in architecture (serverless vs always-on, CDN usage, database choices)
- Third-party API costs (per-call pricing that scales with users)
- Terms of service, privacy policy (regulatory awareness)
- Analytics and tracking setup (growth measurement capability)
