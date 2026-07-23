import type { Clinic } from '@prisma/client';
import { env } from '../env.js';
import { decryptSecret } from '../lib/crypto.js';
import { MockProvider } from './mock.js';
import { Dialog360Provider } from './dialog360.js';
import { MetaCloudProvider } from './meta.js';
import type { MessagingProvider } from './provider.js';

// Istanza condivisa: l'outbox della demo deve sopravvivere tra le richieste.
const sharedMock = new MockProvider();

export function getMockProvider(): MockProvider {
  return sharedMock;
}

export interface ResolveOptions {
  /** se true, le clinic senza canale usano il MockProvider (default: MESSAGING_PROVIDER=mock) */
  mockFallback?: boolean;
}

export type ProviderResolver = (clinic: Clinic) => MessagingProvider | null;

export { WHATSAPP_PROVIDERS, type WhatsappProviderName } from '@confermo/shared';

/**
 * Selezione del provider PER CLINIC:
 * - studio in modalità demo → SEMPRE MockProvider, anche con credenziali
 *   salvate e canale attivo: da uno studio demo non può partire nulla di reale;
 * - canale WhatsApp attivo e credenziali presenti → il provider scelto dallo
 *   studio (360dialog o Cloud API diretta di Meta), con le credenziali del
 *   canale decifrate al volo (AAD = clinic.id);
 * - altrimenti, in dev (MESSAGING_PROVIDER=mock) → MockProvider;
 * - altrimenti → null: canale non configurato, il dispatcher salta l'invio.
 */
export function resolveProvider(clinic: Clinic, opts: ResolveOptions = {}): MessagingProvider | null {
  if (clinic.demoMode) return sharedMock;
  const mockFallback = opts.mockFallback ?? env.messagingProvider === 'mock';
  if (clinic.whatsappActive && clinic.whatsappApiKeyEnc) {
    const secret = decryptSecret(clinic.whatsappApiKeyEnc, clinic.id);
    if (clinic.whatsappProvider === 'meta') {
      // per Meta whatsapp_channel_id contiene il phone number ID
      return new MetaCloudProvider(clinic.whatsappChannelId ?? '', secret);
    }
    return new Dialog360Provider(secret);
  }
  return mockFallback ? sharedMock : null;
}

export * from './provider.js';
export * from './templates.js';
export { MockProvider } from './mock.js';
export { Dialog360Provider } from './dialog360.js';
export { MetaCloudProvider } from './meta.js';
export { parseCloudApiWebhook } from './cloud-api.js';
export { TwilioWhatsAppProvider } from './twilio.js';
