import { normalizePhone } from '../lib/phone.js';
import type {
  IncomingEvent,
  MessagingProvider,
  OutgoingMessage,
  SendResult,
} from './provider.js';

/**
 * SCHELETRO — da completare quando si attiverà Twilio come BSP alternativo.
 *
 * Passi per completarlo:
 * 1. `npm i twilio -w apps/api`
 * 2. Registrare i template WhatsApp (Content API) con i pulsanti
 *    "Confermo" / "Devo disdire" e ottenere i Content SID approvati da Meta.
 * 3. Implementare send() con client.messages.create({ from: 'whatsapp:+...',
 *    to: `whatsapp:${msg.to}`, contentSid, contentVariables }).
 * 4. Verificare la firma del webhook (X-Twilio-Signature).
 * 5. Prevedere credenziali per-clinic come per Dialog360 (campi da aggiungere).
 */
export class TwilioWhatsAppProvider implements MessagingProvider {
  readonly name = 'twilio';

  constructor(
    private readonly config = {
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
      authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
      whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? '', // es. "whatsapp:+14155238886"
    },
  ) {}

  async send(_msg: OutgoingMessage): Promise<SendResult> {
    throw new Error(
      'TwilioWhatsAppProvider non ancora implementato: vedere i TODO in apps/api/src/messaging/twilio.ts',
    );
  }

  async sendText(_to: string, _body: string): Promise<SendResult> {
    throw new Error(
      'TwilioWhatsAppProvider non ancora implementato: vedere i TODO in apps/api/src/messaging/twilio.ts',
    );
  }

  /**
   * Il webhook Twilio per i pulsanti dei template invia (form-encoded):
   * From: "whatsapp:+393331234567", ButtonPayload/ButtonText oppure Body,
   * MessageSid come id univoco.
   */
  parseIncoming(payload: unknown): IncomingEvent[] {
    const p = payload as {
      From?: string;
      ButtonPayload?: string;
      ButtonText?: string;
      Body?: string;
      MessageSid?: string;
    };
    if (!p || typeof p.From !== 'string' || !p.MessageSid) return [];
    const from = normalizePhone(p.From);
    if (!from) return [];

    const text = (p.ButtonPayload ?? p.ButtonText ?? p.Body ?? '').toLowerCase().trim();
    if (text.startsWith('confermo')) {
      return [{ type: 'button', providerMessageId: p.MessageSid, from, button: 'confirm', appointmentId: null }];
    }
    if (text.startsWith('devo disdire') || text.startsWith('disdic')) {
      return [{ type: 'button', providerMessageId: p.MessageSid, from, button: 'cancel', appointmentId: null }];
    }
    if (p.Body) {
      return [{ type: 'text', providerMessageId: p.MessageSid, from, body: p.Body }];
    }
    return [];
  }
}
