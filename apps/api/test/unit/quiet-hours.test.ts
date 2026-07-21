import { describe, expect, it } from 'vitest';
import { isWithinQuietHours, nextTimeOutsideQuietHours, parseHhMm } from '../../src/lib/time.js';

const ZONE = 'Europe/Rome';
/** helper: istante corrispondente a un'ora locale italiana */
const at = (iso: string) => new Date(iso);

describe('parseHhMm', () => {
  it('accetta orari validi', () => {
    expect(parseHhMm('21:00')).toBe(21 * 60);
    expect(parseHhMm('8:30')).toBe(8 * 60 + 30);
    expect(parseHhMm('00:00')).toBe(0);
  });
  it('rifiuta orari impossibili o malformati', () => {
    expect(parseHhMm('24:00')).toBeNull();
    expect(parseHhMm('12:60')).toBeNull();
    expect(parseHhMm('sera')).toBeNull();
    expect(parseHhMm('')).toBeNull();
  });
});

describe('fascia di silenzio a cavallo della mezzanotte (21:00 → 08:00)', () => {
  const start = '21:00';
  const end = '08:00';

  it('le 6:00 del mattino sono dentro la fascia', () => {
    // 06:00 locali d'estate = 04:00 UTC
    expect(isWithinQuietHours(at('2026-07-21T04:00:00Z'), ZONE, start, end)).toBe(true);
  });

  it('le 23:00 sono dentro la fascia', () => {
    expect(isWithinQuietHours(at('2026-07-21T21:00:00Z'), ZONE, start, end)).toBe(true);
  });

  it('le 10:00 del mattino sono fuori dalla fascia', () => {
    expect(isWithinQuietHours(at('2026-07-21T08:00:00Z'), ZONE, start, end)).toBe(false);
  });

  it('le 08:00 in punto sono già fuori (la fascia finisce lì)', () => {
    expect(isWithinQuietHours(at('2026-07-21T06:00:00Z'), ZONE, start, end)).toBe(false);
  });

  it('un promemoria delle 6:00 viene rinviato alle 8:00 locali', () => {
    const postponed = nextTimeOutsideQuietHours(at('2026-07-21T04:00:00Z'), ZONE, start, end);
    expect(postponed.toISOString()).toBe('2026-07-21T06:00:00.000Z'); // 08:00 CEST
  });

  it('un promemoria delle 23:00 viene rinviato alle 8:00 del giorno dopo', () => {
    const postponed = nextTimeOutsideQuietHours(at('2026-07-21T21:00:00Z'), ZONE, start, end);
    expect(postponed.toISOString()).toBe('2026-07-22T06:00:00.000Z');
  });

  it('fuori dalla fascia l’istante resta invariato', () => {
    const instant = at('2026-07-21T12:00:00Z');
    expect(nextTimeOutsideQuietHours(instant, ZONE, start, end)).toBe(instant);
  });

  it('funziona anche in inverno (CET, UTC+1)', () => {
    // 07:00 locali di gennaio = 06:00 UTC → dentro la fascia
    expect(isWithinQuietHours(at('2026-01-21T06:00:00Z'), ZONE, start, end)).toBe(true);
    const postponed = nextTimeOutsideQuietHours(at('2026-01-21T06:00:00Z'), ZONE, start, end);
    expect(postponed.toISOString()).toBe('2026-01-21T07:00:00.000Z'); // 08:00 CET
  });
});

describe('fascia dentro la stessa giornata (13:00 → 15:00, pausa pranzo)', () => {
  it('le 14:00 sono dentro, le 16:00 fuori', () => {
    expect(isWithinQuietHours(at('2026-07-21T12:00:00Z'), ZONE, '13:00', '15:00')).toBe(true);
    expect(isWithinQuietHours(at('2026-07-21T14:00:00Z'), ZONE, '13:00', '15:00')).toBe(false);
  });
  it('rinvia alla fine della pausa', () => {
    const postponed = nextTimeOutsideQuietHours(at('2026-07-21T12:00:00Z'), ZONE, '13:00', '15:00');
    expect(postponed.toISOString()).toBe('2026-07-21T13:00:00.000Z'); // 15:00 CEST
  });
});

describe('fascia disattivata', () => {
  it('inizio e fine coincidenti = nessun silenzio', () => {
    expect(isWithinQuietHours(at('2026-07-21T02:00:00Z'), ZONE, '00:00', '00:00')).toBe(false);
  });
  it('valori non validi non bloccano gli invii', () => {
    expect(isWithinQuietHours(at('2026-07-21T02:00:00Z'), ZONE, 'boh', '08:00')).toBe(false);
  });
});
