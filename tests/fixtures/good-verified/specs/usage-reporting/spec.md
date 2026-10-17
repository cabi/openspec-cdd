# Spec Delta

## Purpose

Lets billing users see their usage mid-cycle so they can react before the invoice arrives.

## ADDED Requirements

### Requirement: Scheduled usage report

The system SHALL email every billing user a CSV usage report covering exactly the last 14 days, once every 14 days.

Code: `src/usage-report/**`

#### Scenario: Report delivered on schedule

- **WHEN** 14 days have passed since the last delivered report
- **THEN** the system emails the billing user one CSV covering exactly those 14 days
- **Verified by** tests/acceptance/usage-reporting.schedule.test.ts
