# Tasks

## 1. Delivery

- [x] 1.1 Platform cron fires the report job once every 14 days, verify by inspecting the cron entry and one dry-run firing at +14 days
- [x] 1.2 Report window query returns exactly the days since the last delivered report, verify by `npm test -- usage-report.window`
- [x] 1.3 Mailer sends the CSV to every billing user, verify by `npm test -- usage-report.delivery`
- [x] 1.4 Acceptance: "Report delivered on schedule" passes end to end, verify by `npm test -- tests/acceptance/usage-reporting.schedule.test.ts`

## Done When Traceability

| Done When criterion | Verified by tasks |
|---|---|
| A billing user receives exactly one CSV per 14-day window | 1.1, 1.3, 1.4 |
| The report covers exactly the 14 days since the last delivered report | 1.2 |
