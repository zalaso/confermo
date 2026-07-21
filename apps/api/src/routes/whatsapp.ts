import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Clinic } from '@prisma/client';
import { DEFAULT_TEMPLATES, type WhatsappSettingsDto } from '@confermo/shared';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';
import { normalizePhone } from '../lib/phone.js';
import { logEvent } from '../lib/events.js';
import { renderTemplate } from '../lib/template.js';
import { formatLocal } from '../lib/time.js';
import { resolveProvider, buildButtonPayloads } from '../messaging/index.js';

function toSettingsDto(clinic: Clinic): WhatsappSettingsDto {
  let apiKeyLast4: string | null = null;
  if (clinic.whatsappApiKeyEnc) {
    try {
      apiKeyLast4 = decryptSecret(clinic.whatsappApiKeyEnc, clinic.id).slice(-4);
    } catch {
      apiKeyLast4 = null; // chiave di cifratura assente/cambiata: mai propagare l'errore qui
    }
  }
  return {
    active: clinic.whatsappActive,
    phone: clinic.whatsappPhone,
    channelId: clinic.whatsappChannelId,
    apiKeyConfigured: clinic.whatsappApiKeyEnc !== null,
    apiKeyLast4,
    webhookUrl: clinic.whatsappWebhookSecret
      ? `${env.appBaseUrl}/api/webhooks/whatsapp/${clinic.id}?token=${clinic.whatsappWebhookSecret}`
      : null,
    lastTest: clinic.whatsappLastTestAt
      ? {
          at: clinic.whatsappLastTestAt.toISOString(),
          ok: clinic.whatsappLastTestOk ?? false,
          error: clinic.whatsappLastTestError,
        }
      : null,
  };
}

export default async function whatsappRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get('/settings', async (req) => {
    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: req.user.clinicId } });
    return toSettingsDto(clinic);
  });

  app.put(
    '/settings',
    {
      schema: {
        body: Type.Object({
          phone: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          channelId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          /** write-only: mai restituita; stringa vuota = lascia invariata */
          apiKey: Type.Optional(Type.String()),
          active: Type.Optional(Type.Boolean()),
        }),
      },
    },
    async (req, reply) => {
      const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: req.user.clinicId } });
      const data: Record<string, unknown> = {};
      const changed: string[] = [];

      if (req.body.phone !== undefined) {
        if (req.body.phone === null || req.body.phone.trim() === '') {
          data.whatsappPhone = null;
        } else {
          const phone = normalizePhone(req.body.phone);
          if (!phone) return reply.code(400).send({ error: 'Numero mittente non valido' });
          data.whatsappPhone = phone;
        }
        changed.push('phone');
      }
      if (req.body.channelId !== undefined) {
        data.whatsappChannelId = req.body.channelId?.trim() || null;
        changed.push('channelId');
      }
      if (req.body.apiKey !== undefined && req.body.apiKey.trim() !== '') {
        data.whatsappApiKeyEnc = encryptSecret(req.body.apiKey.trim(), clinic.id);
        if (!clinic.whatsappWebhookSecret) {
          data.whatsappWebhookSecret = randomBytes(24).toString('hex');
        }
        changed.push('apiKey');
      }

      const merged = { ...clinic, ...data } as Clinic;
      if (req.body.active !== undefined) {
        if (req.body.active && !(merged.whatsappPhone && merged.whatsappApiKeyEnc && merged.whatsappChannelId)) {
          return reply.code(422).send({
            error: 'Per attivare il canale servono numero mittente, ID canale e API key',
          });
        }
        data.whatsappActive = req.body.active;
        changed.push('active');
      }

      const updated = await prisma.clinic.update({ where: { id: clinic.id }, data });
      await logEvent(prisma, {
        clinicId: clinic.id,
        type: 'whatsapp_settings_updated',
        payload: { changed }, // solo i nomi dei campi, mai i valori
      });
      return toSettingsDto(updated);
    },
  );

  /**
   * Invia il template 48h a un numero indicato, con dati di esempio.
   * In modalità demo passa dal MockProvider (visibile nell'outbox).
   */
  app.post(
    '/test',
    { schema: { body: Type.Object({ phone: Type.String({ minLength: 5 }) }) } },
    async (req, reply) => {
      const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: req.user.clinicId } });
      const to = normalizePhone(req.body.phone);
      if (!to) return reply.code(400).send({ error: 'Numero non valido' });

      let provider;
      try {
        provider = resolveProvider(clinic);
      } catch (err) {
        provider = null;
        await recordTest(clinic.id, false, err instanceof Error ? err.message : String(err));
        return reply.code(422).send({ error: 'Credenziali non decifrabili: risalvare la API key' });
      }
      if (!provider) {
        await recordTest(clinic.id, false, 'Canale non configurato');
        return reply.code(422).send({ error: 'Canale WhatsApp non configurato' });
      }

      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const local = formatLocal(tomorrow, clinic.timezone);
      const variables = {
        paziente: 'Paziente di Prova',
        data: local.date,
        ora: local.time,
        studio: clinic.name,
      };
      const template = await prisma.messageTemplate.findUnique({
        where: { clinicId_kind: { clinicId: clinic.id, kind: 'reminder_48h' } },
      });

      try {
        await provider.send({
          to,
          body: renderTemplate(template?.body ?? DEFAULT_TEMPLATES.reminder_48h, variables),
          kind: 'reminder_48h',
          variables,
          buttonPayloads: buildButtonPayloads('test'),
          reminderId: 'test',
          appointmentId: 'test',
        });
        await recordTest(clinic.id, true, null);
        await logEvent(prisma, {
          clinicId: clinic.id,
          type: 'whatsapp_test_sent',
          payload: { provider: provider.name, ok: true },
        });
        return { ok: true, provider: provider.name };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordTest(clinic.id, false, message);
        await logEvent(prisma, {
          clinicId: clinic.id,
          type: 'whatsapp_test_sent',
          payload: { provider: provider.name, ok: false, error: message },
        });
        return { ok: false, error: message };
      }
    },
  );

  async function recordTest(clinicId: string, ok: boolean, error: string | null) {
    await prisma.clinic.update({
      where: { id: clinicId },
      data: { whatsappLastTestAt: new Date(), whatsappLastTestOk: ok, whatsappLastTestError: error },
    });
  }
}
