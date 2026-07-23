import { normalizePhone } from '../lib/phone.js';
import { WHATSAPP_TEMPLATES, parseButtonPayload } from './templates.js';
import { SendError, type IncomingEvent, type OutgoingMessage } from './provider.js';

/**
 * Logica condivisa della Cloud API di Meta.
 *
 * 360dialog è un proxy sottile sopra questa API: la differenza fra i due
 * provider è solo l'URL e l'intestazione di autenticazione. Il corpo dei
 * messaggi in uscita, il formato dei webhook in ingresso e i codici di errore
 * sono identici — quindi vivono qui, e i due provider li riusano.
 *
 * Codici errore: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

export const TEMPLATE_ERROR_CODES = new Set([132000, 132001, 132005, 132007, 132012, 132015, 132016]);
export const RECIPIENT_ERROR_CODES = new Set([131026, 131030]);
export const RATE_LIMIT_ERROR_CODES = new Set([130429, 131048, 131056, 80007]);

/** Corpo della richiesta per l'invio di un template con i due pulsanti quick-reply. */
export function buildTemplateBody(msg: OutgoingMessage): Record<string, unknown> {
  const def = WHATSAPP_TEMPLATES[msg.kind];
  const bodyParams = def.variablesOrder.map((v) => ({ type: 'text', text: msg.variables[v] }));
  return {
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
  };
}

/** Corpo della richiesta per un messaggio di sessione libero (dentro la finestra 24h). */
export function buildTextBody(to: string, body: string): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace('+', ''),
    type: 'text',
    text: { body },
  };
}

/** Estrae l'id del messaggio dalla risposta di invio (`{ messages: [{ id }] }`). */
export function extractProviderMessageId(data: unknown): string {
  const d = data as { messages?: { id?: string }[] };
  return d?.messages?.[0]?.id ?? '';
}

/**
 * Classifica un errore HTTP della Cloud API in un SendError, che decide lo
 * stato del reminder e se ha senso un retry. `label` compare nei messaggi.
 */
export async function classifyCloudApiError(res: Response, label: string): Promise<SendError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: number; message?: string; title?: string; error_data?: { details?: string } };
    errors?: { code?: number; title?: string; details?: string }[];
  };
  const first = (body.error ?? body.errors?.[0]) as
    | { code?: number; message?: string; title?: string; details?: string; error_data?: { details?: string } }
    | undefined;
  const code = first?.code;
  const detail = first?.message ?? first?.error_data?.details ?? first?.details ?? first?.title ?? `HTTP ${res.status}`;

  if (res.status === 429 || (code !== undefined && RATE_LIMIT_ERROR_CODES.has(code))) {
    return new SendError('rate_limit', `Rate limit ${label}: ${detail}`);
  }
  if (code !== undefined && TEMPLATE_ERROR_CODES.has(code)) {
    return new SendError('template', `Template rifiutato: ${detail} (codice ${code})`);
  }
  if (code !== undefined && RECIPIENT_ERROR_CODES.has(code)) {
    return new SendError('recipient', `Destinatario non raggiungibile: ${detail} (codice ${code})`);
  }
  if (res.status === 401 || res.status === 403) {
    return new SendError('other', 'Credenziali del canale non valide o scadute');
  }
  return new SendError('other', `Errore ${label}: ${detail}`);
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
 * Parser del payload webhook nel formato Cloud API di Meta (usato tal quale da
 * Meta e inoltrato identico da 360dialog). Statico: interpretare un payload non
 * richiede credenziali.
 */
export function parseCloudApiWebhook(payload: unknown): IncomingEvent[] {
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
