import { randomUUID } from 'node:crypto';
import { maskPhone, normalizePhone } from '../lib/phone.js';
import { parseButtonPayload } from './templates.js';
import type {
  IncomingEvent,
  MessagingProvider,
  OutgoingMessage,
  SendResult,
} from './provider.js';

export interface MockSentMessage {
  to: string;
  body: string;
  kind: string; // reminder_48h | reminder_3h | text
  reminderId: string | null;
  appointmentId: string | null;
  providerMessageId: string;
  sentAt: string;
}

/**
 * Provider finto per sviluppo e demo: logga i messaggi (telefono mascherato)
 * e li tiene in memoria (consultabili da GET /api/dev/outbox). Le risposte si
 * simulano con POST /api/dev/simulate-reply o dai pulsanti demo della dashboard.
 */
export class MockProvider implements MessagingProvider {
  readonly name = 'mock';
  readonly outbox: MockSentMessage[] = [];

  private record(entry: Omit<MockSentMessage, 'providerMessageId' | 'sentAt'>): SendResult {
    const providerMessageId = `mock-${randomUUID()}`;
    this.outbox.push({ ...entry, providerMessageId, sentAt: new Date().toISOString() });
    if (this.outbox.length > 200) this.outbox.shift();
    console.log(`[MockProvider] WhatsApp → ${maskPhone(entry.to)} (${entry.kind}): ${entry.body}`);
    return { providerMessageId };
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    return this.record({
      to: msg.to,
      body: msg.body,
      kind: msg.kind,
      reminderId: msg.reminderId,
      appointmentId: msg.appointmentId,
    });
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    return this.record({ to, body, kind: 'text', reminderId: null, appointmentId: null });
  }

  parseIncoming(payload: unknown): IncomingEvent[] {
    const p = payload as { from?: string; button?: string; text?: string; messageId?: string };
    if (!p || typeof p.from !== 'string') return [];
    const from = normalizePhone(p.from);
    if (!from) return [];
    const providerMessageId = p.messageId ?? `mock-in-${randomUUID()}`;
    if (p.button) {
      const parsed = parseButtonPayload(p.button);
      if (parsed) {
        return [
          { type: 'button', providerMessageId, from, button: parsed.button, appointmentId: parsed.appointmentId },
        ];
      }
    }
    if (typeof p.text === 'string') {
      return [{ type: 'text', providerMessageId, from, body: p.text }];
    }
    return [];
  }
}
