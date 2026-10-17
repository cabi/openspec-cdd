# Proposal

## Why

Billing users discover usage overruns up to 30 days late because usage is visible only on the monthly invoice; they need it mid-cycle to react.

## What Changes

- The system emails every billing user a CSV usage report every 14 days.

## Solutions Considered

- `usage-reporting`:
  - platform `cron` + existing mailer service: covers scheduling and delivery mechanics - adopt, because a purpose-built scheduler would reinvent a solved problem.
  - existing `invoice-export` spec: covers the monthly PDF invoice export - reject, because this change needs CSV mid-cycle, a different cadence and format.

## Non-Goals

- PDF formatting and invoice layout (owned by `invoice-export`).
- A usage dashboard UI.
- Threshold-based alerting.

## Done When

- [ ] A billing user receives exactly one CSV per 14-day window (scenario "Report delivered on schedule" passes).
- [ ] The report covers exactly the 14 days since the last delivered report.

## Capabilities

### New Capabilities

- `usage-reporting`: scheduled CSV usage reports for billing users.

### Modified Capabilities
