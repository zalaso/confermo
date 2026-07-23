import { maskPhone } from '../lib/phone.js';
import {
  buildTemplateBody,
  buildTextBody,
  classifyCloudApiError,
  extractProviderMessageId,
  parseCloudApiWebhook,
} from './cloud-api.js';
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
 * Provider 360dialog (Cloud API di Meta gestita da un BSP). Un'istanza per
 * canale: la API key è quella del canale della singola clinic, decifrata al
 * volo dal resolver e mai loggata.
 *
 * Corpo dei messaggi, formato dei webhook e codici di errore sono quelli della
 * Cloud API di Meta e stanno in cloud-api.ts, condivisi con MetaCloudProvider.
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
    if (!res.ok) throw await classifyCloudApiError(res, '360dialog');
    return { providerMessageId: extractProviderMessageId(await res.json().catch(() => ({}))) };
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const result = await this.post(buildTemplateBody(msg));
    console.log(`[dialog360] template → ${maskPhone(msg.to)} (${msg.kind})`);
    return result;
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    const result = await this.post(buildTextBody(to, body));
    console.log(`[dialog360] messaggio di sessione → ${maskPhone(to)}`);
    return result;
  }

  parseIncoming(payload: unknown): IncomingEvent[] {
    return parseCloudApiWebhook(payload);
  }
}

/** @deprecated Alias di parseCloudApiWebhook, mantenuto per gli import esistenti. */
export const parseDialog360Webhook = parseCloudApiWebhook;
