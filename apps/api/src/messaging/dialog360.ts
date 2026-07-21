import { maskPhone, normalizePhone } from '../lib/phone.js';
import { WHATSAPP_TEMPLATES, parseButtonPayload } from './templates.js';
import {
  SendError,
  type IncomingEvent,
  type MessagingProvider,
  type OutgoingMessage,
  type SendResult,
} from './provider.js';

const API_BASE = 'https://waba-v2.360dialog.io';
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Provider 360dialog (Cloud API di Meta gestita). Un'istanza per canale:
 * la API key è quella del canale della singola clinic, decifrata al volo
 * dal resolver e mai loggata.
 */
export class Dialog360Provider implements MessagingProvider {
  readonly name = 'dialog360';

  constructor(private readonly apiKey: string) {}

  private async post(body: unknown): Promise<{ providerMessageId: string }> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/messages`, {
        method: 'POST',
        headers: { 'D360-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new SendError('other', `Errore di rete verso 360dialog: ${err instanceof Error ? err.message : err}`);
    }
    if (!res.ok) throw await classifyHttpError(res);
    const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    return { providerMessageId: data.messages?.[0]?.id ?? '' };
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const def = WHATSAPP_TEMPLATES[msg.kind];
    const bodyParams = def.variablesOrder.map((v) => ({ type: 'text', text: msg.variables[v] }));
    const result = await this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: msg.to.replace('+', ''),
      type: 'template',
      template: {
        name: def.name,
        language: { code: def.language },
        components: [
          { type: 'body', parameters: bodyParams },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: 0,
            parameters: [{ type: 'payload', payload: msg.buttonPayloads.confirm }],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: 1,
            parameters: [{ type: 'payload', payload: msg.buttonPayloads.cancel }],
          },
        ],
      },
    });
    console.log(`[dialog360] template ${def.name} → ${maskPhone(msg.to)}`);
    return result;
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    const result = await this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace('+', ''),
      type: 'text',
      text: { body },
    });
    console.log(`[dialog360] messaggio di sessione → ${maskPhone(to)}`);
    return result;
  }

  parseIncoming(payload: unknown): IncomingEvent[] {
    return parseDialog360Webhook(payload);
  }
}

/** Codici errore Cloud API rilevanti (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes) */
const TEMPLATE_ERROR_CODES = new Set([132000, 132001, 132005, 132007, 132012, 132015, 132016]);
const RECIPIENT_ERROR_CODES = new Set([131026, 131030]);
const RATE_LIMIT_ERROR_CODES = new Set([130429, 131048, 131056, 80007]);

async function classifyHttpError(res: Response): Promise<SendError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: number; message?: string; title?: string };
    errors?: { code?: number; title?: string; details?: string }[];
  };
  const first = (body.error ?? body.errors?.[0]) as
    | { code?: number; message?: string; title?: string; details?: string }
    | undefined;
  const code = first?.code;
  const detail = first?.message ?? first?.details ?? first?.title ?? `HTTP ${res.status}`;

  if (res.status === 429 || (code !== undefined && RATE_LIMIT_ERROR_CODES.has(code))) {
    return new SendError('rate_limit', `Rate limit 360dialog: ${detail}`);
  }
  if (code !== undefined && TEMPLATE_ERROR_CODES.has(code)) {
    return new SendError('template', `Template rifiutato: ${detail} (codice ${code})`);
  }
  if (code !== undefined && RECIPIENT_ERROR_CODES.has(code)) {
    return new SendError('recipient', `Destinatario non raggiungibile: ${detail} (codice ${code})`);
  }
  if (res.status === 401 || res.status === 403) {
    return new SendError('other', 'API key del canale non valida o scaduta');
  }
  return new SendError('other', `Errore 360dialog: ${detail}`);
}

interface CloudApiMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { payload?: string; text?: string };
  interactive?: { button_reply?: { id?: string; title?: string } };
}

interface CloudApiStatus {
  id?: string;
  status?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}

/**
 * Parser del payload webhook (formato Cloud API di Meta, inoltrato da 360dialog).
 * Statico: non servono credenziali per interpretare un payload.
 */
export function parseDialog360Webhook(payload: unknown): IncomingEvent[] {
  const events: IncomingEvent[] = [];
  const p = payload as {
    entry?: { changes?: { value?: { messages?: CloudApiMessage[]; statuses?: CloudApiStatus[] } }[] }[];
  };
  for (const entry of p?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const msg of value.messages ?? []) {
        if (!msg.id || !msg.from) continue;
        const from = normalizePhone(msg.from) ?? msg.from;

        const buttonRaw =
          msg.button?.payload ?? msg.button?.text ?? msg.interactive?.button_reply?.id ?? null;
        if (buttonRaw) {
          const parsed = parseButtonPayload(buttonRaw);
          if (parsed) {
            events.push({
              type: 'button',
              providerMessageId: msg.id,
              from,
              button: parsed.button,
              appointmentId: parsed.appointmentId,
            });
            continue;
          }
        }
        if (msg.type === 'text' && msg.text?.body !== undefined) {
          events.push({ type: 'text', providerMessageId: msg.id, from, body: msg.text.body });
        }
      }

      for (const status of value.statuses ?? []) {
        if (status.status === 'failed' && status.id) {
          const codes = (status.errors ?? []).map((e) => e.code);
          events.push({
            type: 'status_failed',
            providerMessageId: status.id,
            recipientUnreachable: codes.some((c) => c !== undefined && RECIPIENT_ERROR_CODES.has(c)),
            detail:
              (status.errors ?? [])
                .map((e) => e.message ?? e.title)
                .filter(Boolean)
                .join('; ') || 'invio non riuscito',
          });
        }
      }
    }
  }
  return events;
}
