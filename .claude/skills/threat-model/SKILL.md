---
name: threat-model
description: Generate STRIDE threat model from architecture document with trust boundaries, threat enumeration, and mitigation planning. Use this skill after architecture is complete, when security analysis is needed, or when preparing for security review.
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, AskUserQuestion
argument-hint: [path-to-architecture-doc]
user-invocable: true
---

# Threat Model Generation

**Input**: `$ARGUMENTS` (path to architecture document)
**Output**: STRIDE threat analysis with mitigations

## Process Overview

```
Architecture Analysis → Asset Identification → STRIDE Analysis → Mitigation Plan
```

## Step 1: Architecture Analysis

Read the architecture document and extract:

### System Components
- Frontend applications
- Backend services
- Databases
- External integrations
- Message queues
- File storage

### Data Flows
- User → Frontend → Backend → Database
- Backend → External APIs
- Background jobs
- File uploads/downloads

### Trust Boundaries
- Public internet ↔ Load balancer
- Load balancer ↔ Application
- Application ↔ Database
- Application ↔ External services

## Step 2: Data Classification

| Classification | Definition | Examples |
|---------------|------------|----------|
| **Public** | No sensitivity | Marketing content |
| **Internal** | Internal use only | Internal docs |
| **Confidential** | Business sensitive | Financial data |
| **Restricted** | Highest sensitivity | PII, credentials |

## Step 3: STRIDE Analysis

For each component and data flow, analyze:

### S - Spoofing Identity
Can an attacker pretend to be someone else?
- Credential theft, phishing, brute force
- Service impersonation, MITM
- Mitigations: MFA, certificate pinning, request signing

### T - Tampering with Data
Can an attacker modify data?
- Data modification in transit/storage
- SQL injection, log manipulation
- Mitigations: TLS, parameterized queries, integrity checks

### R - Repudiation
Can an attacker deny their actions?
- Missing audit trails
- Mitigations: Comprehensive logging, digital signatures

### I - Information Disclosure
Can an attacker access unauthorized data?
- Data exfiltration, verbose errors, log leakage
- Mitigations: Encryption, least privilege, error sanitization

### D - Denial of Service
Can an attacker make the system unavailable?
- DDoS, resource exhaustion, expensive queries
- Mitigations: Rate limiting, CDN/WAF, query timeouts

### E - Elevation of Privilege
Can an attacker gain unauthorized permissions?
- IDOR, role bypass, JWT manipulation
- Mitigations: RBAC, input validation, secure defaults

## Step 4: Risk Scoring

Calculate risk as: **Impact × Likelihood**

| | Low Impact | Medium Impact | High Impact |
|---|---|---|---|
| **High Likelihood** | Medium | High | Critical |
| **Medium Likelihood** | Low | Medium | High |
| **Low Likelihood** | Low | Low | Medium |

## Step 5: Generate Threat Model Document

**Save to**: `plan/security/[project-name]-threat-model.md`

Include:
- System Overview (description, diagram, components, dependencies)
- Data Classification
- Trust Boundaries
- STRIDE Analysis (threats, mitigations per category)
- Risk Matrix (counts by level, required actions)
- Security Controls Summary
- Action Items (prioritized)
- OWASP Top 10 Mapping

---

**Begin threat model generation. Start by reading the architecture document.**
