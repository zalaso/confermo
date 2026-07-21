import { describe, expect, it } from 'vitest';
import { parseDialog360Webhook } from '../../src/messaging/dialog360.js';
import { buildButtonPayloads, parseButtonPayload } from '../../src/messaging/templates.js';
import { isOptOutText } from '../../src/services/inbound.js';
import { maskPhone } from '../../src/lib/phone.js';

function cloudApiPayload(inner: object): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: inner }] }],
  };
}

describe('parsing webhook Cloud API (360dialog)', () => {
  it('pulsante Confermo con appointmentId nel payload', () => {
    const events = parseDialog360Webhook(
      cloudApiPayload({
        messages: [
          {
            id: 'wamid.1',
            from: '393331234567', // wa_id: E.164 senza "+"
            type: 'button',
            button: { payload: 'CONFERMO:appt-42', text: 'Confermo' },
          },
        ],
      }),
    );
    expect(events).toEqual([
      {
        type: 'button',
        providerMessageId: 'wamid.1',
        from: '+393331234567',
        button: 'confirm',
        appointmentId: 'appt-42',
      },
    ]);
  });

  it('pulsante Devo disdire senza id (testo scritto a mano)', () => {
    const events = parseDialog360Webhook(
      cloudApiPayload({
        messages: [
          { id: 'wamid.2', from: '393331234567', type: 'button', button: { text: 'Devo disdire' } },
        ],
      }),
    );
    expect(events[0]).toMatchObject({ type: 'button', button: 'cancel', appointmentId: null });
  });

  it('messaggio di testo libero', () => {
    const events = parseDialog360Webhook(
      cloudApiPayload({
        messages: [
          { id: 'wamid.3', from: '393331234567', type: 'text', text: { body: 'Posso spostare?' } },
        ],
      }),
    );
    expect(events[0]).toMatchObject({ type: 'text', body: 'Posso spostare?', from: '+393331234567' });
  });

  it('status failed con codice 131026 → destinatario non raggiungibile', () => {
    const events = parseDialog360Webhook(
      cloudApiPayload({
        statuses: [
          {
            id: 'wamid.out-1',
            status: 'failed',
            errors: [{ code: 131026, title: 'Message undeliverable' }],
          },
        ],
      }),
    );
    expect(events[0]).toMatchObject({
      type: 'status_failed',
      providerMessageId: 'wamid.out-1',
      recipientUnreachable: true,
    });
  });

  it('payload vuoto o malformato → nessun evento, nessuna eccezione', () => {
    expect(parseDialog360Webhook({})).toEqual([]);
    expect(parseDialog360Webhook(null)).toEqual([]);
    expect(parseDialog360Webhook({ entry: [{}] })).toEqual([]);
  });
});

describe('payload dei pulsanti', () => {
  it('build + parse sono simmetrici', () => {
    const payloads = buildButtonPayloads('appt-7');
    expect(parseButtonPayload(payloads.confirm)).toEqual({ button: 'confirm', appointmentId: 'appt-7' });
    expect(parseButtonPayload(payloads.cancel)).toEqual({ button: 'cancel', appointmentId: 'appt-7' });
  });
  it('testo del pulsante come fallback', () => {
    expect(parseButtonPayload('Confermo')).toEqual({ button: 'confirm', appointmentId: null });
    expect(parseButtonPayload('qualcosa di ignoto')).toBeNull();
  });
});

describe('riconoscimento opt-out', () => {
  it.each(['STOP', 'stop', ' Stop! ', 'BASTA', 'basta.', 'Cancellami', 'non scrivermi'])(
    '"%s" è un opt-out',
    (text) => {
      expect(isOptOutText(text)).toBe(true);
    },
  );
  it.each(['no grazie', 'va bene', 'stop domani però', 'confermo'])('"%s" NON è un opt-out', (text) => {
    expect(isOptOutText(text)).toBe(false);
  });
});

describe('mascheramento telefoni nei log', () => {
  it('maschera mantenendo prefisso e ultime 3 cifre', () => {
    expect(maskPhone('+393331234567')).toBe('+39 333 •••• 567');
    expect(maskPhone('393331234567')).toBe('+39 333 •••• 567');
  });
  it('input non riconoscibile → tutto mascherato', () => {
    expect(maskPhone('boh')).toBe('•••');
  });
});
