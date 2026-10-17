// Acceptance test pinned by specs/usage-reporting/spec.md,
// scenario "Report delivered on schedule". Black-box: observes only the
// system boundary the WHEN/THEN describes - never internal classes.
import { expect, test } from 'vitest';

test('report delivered on schedule (every 14 days)', async () => {
  // WHEN 14 days have passed since the last delivered report
  const last = await lastDeliveredReport(billingUser);
  await advanceDays(14);
  // THEN the system emails the billing user one CSV covering exactly those 14 days
  const mail = await lastEmailTo(billingUser);
  expect(mail.attachments[0].mimeType).toBe('text/csv');
  expect(csvCoversDays(mail.attachments[0].content)).toBe(14);
});
