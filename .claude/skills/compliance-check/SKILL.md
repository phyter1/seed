---
name: compliance-check
description: Validate compliance posture against regulatory frameworks (SOC2, HIPAA, GDPR, PCI-DSS) with evidence collection. Use this skill when preparing for audits, validating security controls, or assessing regulatory readiness.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch, Task
argument-hint: [framework: SOC2|HIPAA|GDPR|PCI-DSS|ISO27001]
user-invocable: true
---

# Compliance Validation

**Input**: `$ARGUMENTS` (framework name, e.g., SOC2, HIPAA, GDPR)
**Output**: Compliance report with findings, evidence gaps, and remediation plan

## Supported Frameworks

| Framework | Key Focus | Controls |
|-----------|-----------|----------|
| `SOC2` | Security, Availability, Processing Integrity | 64 Trust Service Criteria |
| `HIPAA` | PHI Protection | 18 Security Standards |
| `GDPR` | Data Subject Rights, Consent | 99 Articles |
| `PCI-DSS` | Cardholder Data | 12 Requirements |
| `ISO27001` | Information Security Management | 114 Controls |

## Process Overview

```
Framework Selection → Code Analysis → Policy Check → Evidence Audit → Report
```

## Step 1: Load Framework Controls

Load control requirements for selected framework:
- Control ID and description
- Evidence requirements
- Automated check availability

## Step 2: Code Analysis

Scan codebase for:

### Security Controls
- Authentication implementation
- Authorization checks
- Encryption usage
- Input validation
- Logging practices

### Data Protection
- PII handling
- Data classification
- Retention policies
- Access controls

### Infrastructure
- Network security
- Secrets management
- Dependency scanning
- Vulnerability management

## Step 3: Evidence Collection

For each control, identify:
- **Evidence Present**: Documentation, code, configs
- **Evidence Gap**: Missing documentation or implementation
- **Automated Evidence**: What can be collected automatically

## Step 4: Generate Report

**Save to**: `plan/compliance/[framework]-compliance-[date].md`

Include:
- Executive Summary
- Framework Overview
- Control-by-Control Assessment
- Evidence Matrix
- Gap Analysis
- Remediation Plan (prioritized)
- Evidence Collection Checklist

## Compliance Status Levels

| Status | Meaning |
|--------|---------|
| **Compliant** | Control met with evidence |
| **Partial** | Control partially implemented |
| **Non-Compliant** | Control not met |
| **Not Applicable** | Control doesn't apply |

---

**Begin compliance check. Parse the framework argument and load controls.**
