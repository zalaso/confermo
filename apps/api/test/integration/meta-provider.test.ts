import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createTestClient, resetDb, seedBase } from '../test-db.js';
import { buildServer } from '../../src/server.js';
import { MetaCloudProvider } from '../../src/messaging/meta.js';
import { Dialog360Provider } from '../../src/messaging/dialog360.js';
import { resolveProvider } from '../../src/messaging/index.js';
import { encryptSecret } from '../../src/lib/crypto.js';
import { buildButtonPayloads } from '../../src/messaging/templates.js';
import { SendError, type OutgoingMessage } from '../../src/messaging/provider.js';

const prisma = createTestClient();

afterAll(() => prisma.$disconnect());
beforeEach(() => resetDb(prisma));
afterEach(() => vi.restoreAllMocks());

const KEY = randomBytes(32).toString('base64');

function sampleMessage(): OutgoingMessage {
  return {
    to: '+393331112233',
    body: 'Gentile Mario Rossi...',
    kind: 'reminder_48h',
    variables: { paziente: 'Mario Rossi', data: '23/07/2026', ora: '15:30', studio: 'Studio Test' },
    buttonPayloads: buildButtonPayloads('appt-1'),
    reminderId: 'r1',
    appointmentId: 'appt-1',
  };
}

describe('MetaCloudProvider — invio', () => {
  it('chiama graph.facebook.com con il phone number ID e il Bearer token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.meta-1' }] }), { status: 200 }),
    );
    const provider = new MetaCloudProvider('123456789012345', 'ACCESS-TOKEN');

    const res = await provider.send(sampleMessage());

    expect(res.providerMessageId).toBe('wamid.meta-1');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('/123456789012345/messages');
    expect(String(url)).toContain('graph.facebook.com');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer ACCESS-TOKEN');

    // il corpo è un template con i due pulsanti quick-reply
    const body = JSON.parse(init!.body as string);
    expect(body.type).toBe('template');
    expect(body.to).toBe('393331112233'); // senza "+"
    const buttons = body.template.components.filter((c: { type: string }) => c.type === 'button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].parameters[0].payload).toBe('CONFERMO:appt-1');
  });

  it('sendText invia un messaggio di sessione (type: text)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.meta-2' }] }), { status: 200 }),
    );
    const provider = new MetaCloudProvider('123', 'TOK');
    await provider.sendText('+393331112233', 'Grazie, ti aspettiamo!');
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.type).toBe('text');
    expect(body.text.body).toBe('Grazie, ti aspettiamo!');
  });

  it('un errore di template (codice 132000) diventa SendError kind=template', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 132000, message: 'Template does not exist' } }), {
        status: 400,
      }),
    );
    const provider = new MetaCloudProvider('123', 'TOK');
    await expect(provider.send(sampleMessage())).rejects.toMatchObject({
      name: 'SendError',
      kind: 'template',
    });
  });

  it('un 429 diventa SendError kind=rate_limit (il dispatcher poi ritenta)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }));
    const provider = new MetaCloudProvider('123', 'TOK');
    await expect(provider.send(sampleMessage())).rejects.toMatchObject({ kind: 'rate_limit' });
    expect(SendError).toBeDefined();
  });

  it('token non valido (401) diventa SendError kind=other', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const provider = new MetaCloudProvider('123', 'TOK');
    await expect(provider.send(sampleMessage())).rejects.toMatchObject({ kind: 'other' });
  });
});

describe('resolveProvider — scelta del provider per studio', () => {
  async function clinicWithChannel(providerName: string) {
    process.env.CREDENTIALS_ENCRYPTION_KEY = KEY;
    const { clinic } = await seedBase(prisma);
    return prisma.clinic.update({
      where: { id: clinic.id },
      data: {
        whatsappProvider: providerName,
        whatsappActive: true,
        whatsappPhone: '+390000000001',
        whatsappChannelId: 'chan-or-phone-id',
        whatsappApiKeyEnc: encryptSecret('segreto', clinic.id),
      },
    });
  }

  it('provider "meta" → MetaCloudProvider', async () => {
    const clinic = await clinicWithChannel('meta');
    expect(resolveProvider(clinic, { mockFallback: false })).toBeInstanceOf(MetaCloudProvider);
  });

  it('provider "dialog360" (default) → Dialog360Provider', async () => {
    const clinic = await clinicWithChannel('dialog360');
    expect(resolveProvider(clinic, { mockFallback: false })).toBeInstanceOf(Dialog360Provider);
  });

  it('uno studio demo resta sul mock anche con provider "meta" e canale attivo', async () => {
    const clinic = await clinicWithChannel('meta');
    const demo = await prisma.clinic.update({ where: { id: clinic.id }, data: { demoMode: true } });
    // il mock non è né Meta né Dialog360
    const resolved = resolveProvider(demo, { mockFallback: false });
    expect(resolved).not.toBeInstanceOf(MetaCloudProvider);
    expect(resolved).not.toBeInstanceOf(Dialog360Provider);
  });
});

describe('webhook — handshake di verifica di Meta (GET)', () => {
  async function buildApp() {
    const app = await buildServer();
    await app.ready();
    return app;
  }

  async function clinicWithSecret(secret: string) {
    const { clinic } = await seedBase(prisma);
    return prisma.clinic.update({
      where: { id: clinic.id },
      data: { whatsappProvider: 'meta', whatsappWebhookSecret: secret },
    });
  }

  it('verify_token corretto → risponde con il challenge in chiaro', async () => {
    const clinic = await clinicWithSecret('segreto-webhook');
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/webhooks/whatsapp/${clinic.id}`,
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'segreto-webhook',
          'hub.challenge': '1234567890',
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('1234567890');
    } finally {
      await app.close();
    }
  });

  it('verify_token sbagliato → 403, nessun challenge', async () => {
    const clinic = await clinicWithSecret('segreto-webhook');
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/webhooks/whatsapp/${clinic.id}`,
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'sbagliato',
          'hub.challenge': '1234567890',
        },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('1234567890');
    } finally {
      await app.close();
    }
  });

  it('un messaggio in ingresso (POST) col token giusto viene processato', async () => {
    const clinic = await clinicWithSecret('tok-post');
    const app = await buildApp();
    try {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { id: 'wamid.in-1', from: '393339998877', type: 'text', text: { body: 'ciao' } },
                  ],
                },
              },
            ],
          },
        ],
      };
      const res = await app.inject({
        method: 'POST',
        url: `/api/webhooks/whatsapp/${clinic.id}?token=tok-post`,
        payload,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().received).toBe(1);
    } finally {
      await app.close();
    }
  });
});
