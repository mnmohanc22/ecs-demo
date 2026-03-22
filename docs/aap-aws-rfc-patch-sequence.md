# Sequence Diagram: AAP Workflow for AWS RFC Patching

**Version:** 1.0 | **Date:** 2026-03-21 | **Status:** Draft

---

## Overview

This diagram shows the end-to-end flow when a user raises a ServiceNow RFC ticket for AWS account patching. The initial AAP Job Template acts as a **dispatcher** — it receives the AWS Account ID, looks it up in an internal dictionary, and triggers the account-specific AAP Workflow.

---

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber

    actor User as 👤 User / Requester
    participant SN  as 🎫 ServiceNow ITSM
    participant JT  as ⚙️ AAP Job Template<br/>(Dispatcher)
    participant DIC as 📖 Account → Workflow<br/>Dictionary (AAP Vars)
    participant WF  as 🔄 AAP Workflow<br/>(Account-Specific)
    participant EC2 as 🖥️ AWS EC2<br/>Instances
    participant AUD as 📦 AWS S3 / SIEM<br/>(Audit)

    %% ── Phase 1: RFC Creation & Approval ──────────────────────────────
    rect rgb(230, 245, 255)
        Note over User,SN: Phase 1 · RFC Creation & Approval
        User->>SN: Create RFC Ticket<br/>(AWS Account ID: 123456789012,<br/>Patch Group, Maintenance Window)
        SN->>SN: Validate RFC Fields &<br/>Route for Approval
        SN-->>User: RFC Created (CHG0012345)<br/>Pending Approval
        User->>SN: Approve RFC
        SN->>SN: RFC State → "Approved"
    end

    %% ── Phase 2: AAP Dispatcher Trigger ───────────────────────────────
    rect rgb(255, 245, 230)
        Note over SN,DIC: Phase 2 · AAP Dispatcher Trigger
        SN->>JT: Webhook POST<br/>{ account_id: "123456789012",<br/>  rfc_number: "CHG0012345",<br/>  patch_group: "rhel8-prod",<br/>  maint_window: "sat-02:00-04:00-utc" }
        JT->>JT: Validate Webhook Payload<br/>& RFC State = Approved
        JT->>DIC: Lookup account_id<br/>"123456789012"
        DIC-->>JT: Return workflow_id<br/>"WF-042" (us-east-1-prod)
        JT->>JT: Resolve Workflow Template<br/>WF-042 in AAP Controller
    end

    %% ── Phase 3: Workflow Launch ───────────────────────────────────────
    rect rgb(240, 255, 240)
        Note over JT,WF: Phase 3 · Workflow Launch
        JT->>WF: Launch Workflow WF-042<br/>{ account_id, rfc_number,<br/>  patch_group, maint_window }
        WF->>SN: Update RFC State → "Implement"
        WF->>WF: Sync Dynamic Inventory<br/>(amazon.aws.aws_ec2 plugin,<br/>filter: tag:RFC=CHG0012345)
    end

    %% ── Phase 4: Pre-Patch Checks & Snapshot ──────────────────────────
    rect rgb(255, 250, 230)
        Note over WF,EC2: Phase 4 · Pre-Patch Checks & Snapshot
        WF->>EC2: Run Pre-Health Check<br/>(disk space, critical services,<br/>baseline kernel capture)
        EC2-->>WF: Health Status: ✅ OK<br/>(kernel=5.15.0, services up)
        WF->>EC2: Create EBS Snapshots<br/>(tag: RFC=CHG0012345,<br/>RetentionDays=30)
        EC2-->>WF: Snapshot IDs<br/>["snap-0abc123", "snap-0def456"]
    end

    %% ── Phase 5: Patch Execution ───────────────────────────────────────
    rect rgb(240, 240, 255)
        Note over WF,EC2: Phase 5 · Patch Execution (serial: 20%)
        WF->>EC2: Execute OS Patching<br/>(dnf/apt security-only,<br/>serial 20% rolling)
        EC2-->>WF: Patch Applied<br/>Reboot Required: true

        WF->>EC2: Reboot Instances<br/>(reboot_timeout: 600s)
        EC2-->>WF: Instance Online ✅<br/>kernel=5.15.1 (updated)
    end

    %% ── Phase 6: Post-Patch Validation ────────────────────────────────
    rect rgb(255, 240, 240)
        Note over WF,EC2: Phase 6 · Post-Patch Validation
        WF->>EC2: Run Post-Health Check<br/>(services, kernel diff, app response)
        EC2-->>WF: Post-Health: ✅ PASS<br/>(all services up, kernel upgraded)
    end

    %% ── Phase 7: Closure & Audit ───────────────────────────────────────
    rect rgb(240, 255, 250)
        Note over WF,AUD: Phase 7 · RFC Closure & Audit
        WF->>SN: Close RFC CHG0012345<br/>State → "Closed Complete"<br/>Close Notes: "Patched successfully"
        SN-->>User: RFC Closed ✅<br/>Email Notification Sent
        WF->>AUD: Write Audit Log to S3<br/>s3://company-aap-patch-logs/<br/>CHG0012345/2026-03-21.json
        AUD-->>WF: Audit Log Stored ✅
    end
```

---

## Failure / Rollback Path

```mermaid
sequenceDiagram
    autonumber

    participant WF  as 🔄 AAP Workflow
    participant EC2 as 🖥️ AWS EC2 Instances
    participant SN  as 🎫 ServiceNow ITSM
    participant OPS as 📟 Ops Team (PagerDuty)
    participant AUD as 📦 AWS S3 / SIEM

    rect rgb(255, 230, 230)
        Note over WF,EC2: Failure Path · Auto Rollback
        WF->>EC2: Patch Execution / Post-Health Check
        EC2-->>WF: ❌ FAILURE<br/>(service down / health check failed)
        WF->>EC2: Stop Instance
        WF->>EC2: Detach Failed Root Volume
        WF->>EC2: Restore EBS Snapshot<br/>(snap-0abc123)
        WF->>EC2: Re-attach Restored Volume
        WF->>EC2: Start Instance
        EC2-->>WF: Instance Restored ✅
        WF->>SN: Update RFC → "Closed Incomplete"<br/>Reason: "Auto-rollback triggered"
        WF->>OPS: PagerDuty Alert 🔔<br/>"Patching failed - rollback complete"
        WF->>AUD: Write Failure Audit Log to S3
    end
```

---

## Actor Reference

| Actor | Description |
|-------|-------------|
| **User / Requester** | Engineer or team requesting AWS account patching via ITSM |
| **ServiceNow ITSM** | RFC lifecycle management; sends approved RFC via webhook |
| **AAP Job Template (Dispatcher)** | Entry-point JT; validates payload and resolves workflow ID from dictionary |
| **Account → Workflow Dictionary** | AAP extra vars / custom credential storing `account_id → workflow_id` map |
| **AAP Workflow (Account-Specific)** | Per-account workflow handling inventory sync, health checks, patching, rollback |
| **AWS EC2 Instances** | Target patch hosts filtered by RFC tag via dynamic inventory |
| **AWS S3 / SIEM** | Audit log destination; receives structured JSON per patching run |

---

## Dictionary Structure (AAP Extra Variables)

```yaml
# AAP Job Template Extra Vars (or Custom Credential)
account_workflow_map:
  "111111111111": "WF-001"   # dev-account
  "222222222222": "WF-015"   # staging-us-east-1
  "333333333333": "WF-028"   # staging-us-west-2
  "123456789012": "WF-042"   # prod-us-east-1
  "987654321098": "WF-055"   # prod-us-west-2
  "555555555555": "WF-071"   # prod-eu-west-1
```

---

## Key Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Single dispatcher JT routes to account-specific workflows | Isolates blast radius; each account has tailored variables |
| 2 | Dictionary stored as AAP extra vars / credential | Avoids hardcoding; updatable without playbook changes |
| 3 | RFC approval checked before any AWS action | Enforces change control compliance |
| 4 | EBS snapshot taken before patching | Enables sub-30-min rollback without data loss |
| 5 | Serial patching at 20% | Prevents full fleet outage on failed patch |
| 6 | Post-health check gates RFC closure | RFC only closes on verified success |
