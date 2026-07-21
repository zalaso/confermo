import { describe, expect, it } from 'vitest';
import { APPOINTMENT_STATUSES, canTransition } from '@confermo/shared';

describe('transizioni di stato degli appuntamenti', () => {
  it('scheduled può confermarsi, disdirsi o concludersi', () => {
    expect(canTransition('scheduled', 'confirmed')).toBe(true);
    expect(canTransition('scheduled', 'cancelled')).toBe(true);
    expect(canTransition('scheduled', 'no_show')).toBe(true);
    expect(canTransition('scheduled', 'completed')).toBe(true);
  });

  it('confirmed non può tornare scheduled', () => {
    expect(canTransition('confirmed', 'scheduled')).toBe(false);
    expect(canTransition('confirmed', 'cancelled')).toBe(true);
    expect(canTransition('confirmed', 'completed')).toBe(true);
  });

  it('cancelled può solo essere riattivato', () => {
    expect(canTransition('cancelled', 'scheduled')).toBe(true);
    expect(canTransition('cancelled', 'confirmed')).toBe(false);
    expect(canTransition('cancelled', 'completed')).toBe(false);
  });

  it('no_show e completed sono correggibili solo tra loro', () => {
    expect(canTransition('no_show', 'completed')).toBe(true);
    expect(canTransition('completed', 'no_show')).toBe(true);
    expect(canTransition('no_show', 'scheduled')).toBe(false);
    expect(canTransition('completed', 'confirmed')).toBe(false);
  });

  it('nessuno stato transita verso se stesso', () => {
    for (const s of APPOINTMENT_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });
});
