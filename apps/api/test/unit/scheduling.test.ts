import { describe, expect, it } from 'vitest';
import { computeReminderPlan } from '../../src/services/reminders.js';

describe('computeReminderPlan', () => {
  const now = new Date('2026-07-19T10:00:00Z');

  it("pianifica 48h e 3h prima dell'appuntamento", () => {
    const startsAt = new Date('2026-07-25T14:00:00Z');
    const plan = computeReminderPlan(startsAt, now);
    expect(plan).toHaveLength(2);
    const p48 = plan.find((p) => p.kind === 'reminder_48h')!;
    const p3 = plan.find((p) => p.kind === 'reminder_3h')!;
    expect(p48.scheduledFor.toISOString()).toBe('2026-07-23T14:00:00.000Z');
    expect(p3.scheduledFor.toISOString()).toBe('2026-07-25T11:00:00.000Z');
    expect(p48.status).toBe('pending');
    expect(p3.status).toBe('pending');
  });

  it('appuntamento a meno di 48 ore: il 48h nasce skipped, il 3h pending', () => {
    const startsAt = new Date('2026-07-20T10:00:00Z'); // tra 24 ore
    const plan = computeReminderPlan(startsAt, now);
    expect(plan.find((p) => p.kind === 'reminder_48h')!.status).toBe('skipped');
    expect(plan.find((p) => p.kind === 'reminder_3h')!.status).toBe('pending');
  });

  it('appuntamento a meno di 3 ore: entrambi skipped (mai messaggi in ritardo)', () => {
    const startsAt = new Date('2026-07-19T11:00:00Z'); // tra 1 ora
    const plan = computeReminderPlan(startsAt, now);
    expect(plan.every((p) => p.status === 'skipped')).toBe(true);
  });
});
