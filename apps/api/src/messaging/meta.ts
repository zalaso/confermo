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

/** Versione dell'API Graph. Aggiornabile senza toccare il resto. */
const GRAPH_VERSION = 'v21.0';
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Provider diretto sulla Cloud API di Meta, senza BSP intermediario.
 *
 * Un'istanza per canale:
 * - `phoneNumberId` = phone number ID del numero WhatsApp (in whatsapp_channel_id);
 * - `accessToken` = access token, decifrato al volo dal resolver e mai loggato.
 *
 * Utile soprattutto per il collaudo: Meta assegna a ogni sviluppatore un numero
 * di test gratuito, senza verifica aziendale, con cui provare l'intera catena
 * (template, pulsanti, risposte) prima di attivare un canale reale. Resta poi
 * disponibile come alternativa a 360dialog in produzione.
 */
export class MetaCloudProvider implements MessagingProvider {
  readonly name = 'meta';

  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
  ) {}

  private async post(body: unknown): Promise<{ providerMessageId: string }> {
    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new SendError('other', `Errore di rete verso Meta: ${err instanceof Error ? err.message : err}`);
    }
    if (!res.ok) throw await classifyCloudApiError(res, 'Meta');
    return { providerMessageId: extractProviderMessageId(await res.json().catch(() => ({}))) };
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const result = await this.post(buildTemplateBody(msg));
    console.log(`[meta] template → ${maskPhone(msg.to)} (${msg.kind})`);
    return result;
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    const result = await this.post(buildTextBody(to, body));
    console.log(`[meta] messaggio di sessione → ${maskPhone(to)}`);
    return result;
  }

  parseIncoming(payload: unknown): IncomingEvent[] {
    return parseCloudApiWebhook(payload);
  }
}
