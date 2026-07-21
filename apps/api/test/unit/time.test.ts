import { describe, expect, it } from 'vitest';
import { formatLocal, localToUtc } from '../../src/lib/time.js';
import { normalizePhone } from '../../src/lib/phone.js';
import { renderTemplate } from '../../src/lib/template.js';

describe('gestione timezone Europe/Rome', () => {
  it('estate (CEST, UTC+2): 15:30 locali = 13:30 UTC', () => {
    const d = localToUtc('21/07/2026', '15:30', 'Europe/Rome');
    expect(d?.toISOString()).toBe('2026-07-21T13:30:00.000Z');
  });

  it('inverno (CET, UTC+1): 15:30 locali = 14:30 UTC', () => {
    const d = localToUtc('21/01/2026', '15:30', 'Europe/Rome');
    expect(d?.toISOString()).toBe('2026-01-21T14:30:00.000Z');
  });

  it('accetta anche il formato ISO yyyy-MM-dd', () => {
    const d = localToUtc('2026-07-21', '15:30', 'Europe/Rome');
    expect(d?.toISOString()).toBe('2026-07-21T13:30:00.000Z');
  });

  it('andata e ritorno: formatLocal restituisce la stessa data/ora locale', () => {
    const d = localToUtc('21/07/2026', '09:00', 'Europe/Rome')!;
    expect(formatLocal(d, 'Europe/Rome')).toEqual({ date: '21/07/2026', time: '09:00' });
  });

  it('input non valido -> null', () => {
    expect(localToUtc('32/13/2026', '15:30', 'Europe/Rome')).toBeNull();
    expect(localToUtc('21/07/2026', '25:99', 'Europe/Rome')).toBeNull();
  });
});

describe('normalizzazione telefoni italiani', () => {
  it('cellulare senza prefisso internazionale', () => {
    expect(normalizePhone('333 123 4567')).toBe('+393331234567');
  });
  it('già in E.164', () => {
    expect(normalizePhone('+39 333 1234567')).toBe('+393331234567');
  });
  it('prefisso 0039 e prefisso whatsapp:', () => {
    expect(normalizePhone('0039 333 1234567')).toBe('+393331234567');
    expect(normalizePhone('whatsapp:+393331234567')).toBe('+393331234567');
  });
  it('spazzatura -> null', () => {
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('template dei messaggi', () => {
  it('sostituisce le variabili', () => {
    const out = renderTemplate('Ciao {{paziente}}, ci vediamo il {{data}} alle {{ora}} da {{studio}}.', {
      paziente: 'Mario Rossi',
      data: '21/07/2026',
      ora: '15:30',
      studio: 'Studio Demo',
    });
    expect(out).toBe('Ciao Mario Rossi, ci vediamo il 21/07/2026 alle 15:30 da Studio Demo.');
  });
  it('variabili ignote diventano stringa vuota', () => {
    expect(renderTemplate('x{{boh}}y', {})).toBe('xy');
  });
});
