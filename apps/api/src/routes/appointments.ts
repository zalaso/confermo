import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { parse } from 'csv-parse/sync';
import type { Appointment, Patient, Reminder } from '@prisma/client';
import {
  APPOINTMENT_STATUSES,
  VISIT_TYPE_MAX_LENGTH,
  canTransition,
  type AppointmentDto,
  type AppointmentStatus,
  type CsvImportReport,
  type ReminderKind,
  type ReminderResponse,
  type ReminderStatus,
} from '@confermo/shared';
import { prisma } from '../db.js';
import { localToUtc, formatLocal } from '../lib/time.js';
import { normalizePhone } from '../lib/phone.js';
import { logEvent } from '../lib/events.js';
import { syncReminders } from '../services/reminders.js';
import { toPatientDto } from './patients.js';

type FullAppointment = Appointment & { patient: Patient; reminders: Reminder[] };

export function toAppointmentDto(a: FullAppointment, timezone: string): AppointmentDto {
  const local = formatLocal(a.startsAt, timezone);
  return {
    id: a.id,
    patient: toPatientDto(a.patient),
    startsAt: a.startsAt.toISOString(),
    localDate: local.date,
    localTime: local.time,
    durationMin: a.durationMin,
    visitType: a.visitType,
    status: a.status as AppointmentStatus,
    reminders: a.reminders
      .slice()
      .sort((x, y) => x.scheduledFor.getTime() - y.scheduledFor.getTime())
      .map((r) => ({
        id: r.id,
        kind: r.kind as ReminderKind,
        scheduledFor: r.scheduledFor.toISOString(),
        status: r.status as ReminderStatus,
        sentAt: r.sentAt?.toISOString() ?? null,
        response: r.response as ReminderResponse,
        respondedAt: r.respondedAt?.toISOString() ?? null,
      })),
  };
}

const statusEnum = Type.Union(APPOINTMENT_STATUSES.map((s) => Type.Literal(s)));

export default async function appointmentRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  const getClinic = (clinicId: string) =>
    prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });

  app.get(
    '/',
    {
      schema: {
        querystring: Type.Object({
          from: Type.Optional(Type.String()), // ISO date "2026-07-21"
          to: Type.Optional(Type.String()),
          status: Type.Optional(statusEnum),
        }),
      },
    },
    async (req) => {
      const clinic = await getClinic(req.user.clinicId);
      const from = req.query.from ? localToUtc(req.query.from, '00:00', clinic.timezone) : null;
      const to = req.query.to ? localToUtc(req.query.to, '23:59', clinic.timezone) : null;

      const appointments = await prisma.appointment.findMany({
        where: {
          clinicId: clinic.id,
          ...(from || to ? { startsAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        include: { patient: true, reminders: true },
        orderBy: { startsAt: 'asc' },
      });
      return appointments.map((a) => toAppointmentDto(a, clinic.timezone));
    },
  );

  app.post(
    '/',
    {
      schema: {
        body: Type.Object({
          patientId: Type.String({ format: 'uuid' }),
          date: Type.String({ minLength: 8 }), // "dd/MM/yyyy" o "yyyy-MM-dd"
          time: Type.String({ pattern: '^\\d{2}:\\d{2}$' }),
          durationMin: Type.Integer({ minimum: 5, maximum: 480 }),
          // etichetta breve e generica: mai diagnosi o informazioni cliniche
          visitType: Type.String({ minLength: 1, maxLength: VISIT_TYPE_MAX_LENGTH }),
        }),
      },
    },
    async (req, reply) => {
      const clinic = await getClinic(req.user.clinicId);
      const startsAt = localToUtc(req.body.date, req.body.time, clinic.timezone);
      if (!startsAt) return reply.code(400).send({ error: 'Data o ora non valide' });

      const patient = await prisma.patient.findFirst({
        where: { id: req.body.patientId, clinicId: clinic.id },
      });
      if (!patient) return reply.code(404).send({ error: 'Paziente non trovato' });

      const appointment = await prisma.$transaction(async (tx) => {
        const a = await tx.appointment.create({
          data: {
            clinicId: clinic.id,
            patientId: patient.id,
            startsAt,
            durationMin: req.body.durationMin,
            visitType: req.body.visitType.trim(),
          },
        });
        await syncReminders(tx, a);
        await logEvent(tx, {
          clinicId: clinic.id,
          type: 'appointment_created',
          appointmentId: a.id,
          patientId: patient.id,
          payload: { visitType: a.visitType },
        });
        return a;
      });

      const full = await prisma.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
        include: { patient: true, reminders: true },
      });
      return reply.code(201).send(toAppointmentDto(full, clinic.timezone));
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: Type.Object({
          date: Type.Optional(Type.String()),
          time: Type.Optional(Type.String()),
          durationMin: Type.Optional(Type.Integer({ minimum: 5, maximum: 480 })),
          visitType: Type.Optional(Type.String({ minLength: 1, maxLength: VISIT_TYPE_MAX_LENGTH })),
          status: Type.Optional(statusEnum),
        }),
      },
    },
    async (req, reply) => {
      const clinic = await getClinic(req.user.clinicId);
      const current = await prisma.appointment.findFirst({
        where: { id: req.params.id, clinicId: clinic.id },
      });
      if (!current) return reply.code(404).send({ error: 'Appuntamento non trovato' });

      // riprogrammazione: data e ora vanno cambiate insieme o singolarmente
      let startsAt = current.startsAt;
      if (req.body.date || req.body.time) {
        const localNow = formatLocal(current.startsAt, clinic.timezone);
        const next = localToUtc(req.body.date ?? localNow.date, req.body.time ?? localNow.time, clinic.timezone);
        if (!next) return reply.code(400).send({ error: 'Data o ora non valide' });
        startsAt = next;
      }

      const newStatus = req.body.status;
      if (newStatus && newStatus !== current.status && !canTransition(current.status, newStatus)) {
        return reply.code(422).send({
          error: `Transizione non consentita: ${current.status} → ${newStatus}`,
        });
      }

      const rescheduled = startsAt.getTime() !== current.startsAt.getTime();

      await prisma.$transaction(async (tx) => {
        const updated = await tx.appointment.update({
          where: { id: current.id },
          data: {
            startsAt,
            durationMin: req.body.durationMin,
            visitType: req.body.visitType?.trim(),
            status: newStatus,
          },
        });
        if (rescheduled) {
          await logEvent(tx, {
            clinicId: clinic.id,
            type: 'appointment_rescheduled',
            appointmentId: updated.id,
            patientId: updated.patientId,
            payload: { from: current.startsAt.toISOString(), to: startsAt.toISOString() },
          });
        }
        if (newStatus && newStatus !== current.status) {
          await logEvent(tx, {
            clinicId: clinic.id,
            type: 'appointment_status_changed',
            appointmentId: updated.id,
            patientId: updated.patientId,
            payload: { from: current.status, to: newStatus, source: 'staff' },
          });
        }
        if (rescheduled || (newStatus && newStatus !== current.status)) {
          await syncReminders(tx, updated);
        }
      });

      const full = await prisma.appointment.findUniqueOrThrow({
        where: { id: current.id },
        include: { patient: true, reminders: true },
      });
      return toAppointmentDto(full, clinic.timezone);
    },
  );

  /**
   * Import CSV. Colonne (header obbligatorio, separatore "," o ";"):
   * nome,cognome,telefono,data,ora,durata_minuti,tipo_visita,consenso_privacy
   * I pazienti vengono riconosciuti/creati in base al numero di telefono.
   */
  app.post(
    '/import-csv',
    { schema: { body: Type.Object({ csv: Type.String({ minLength: 1 }) }) } },
    async (req) => {
      const clinic = await getClinic(req.user.clinicId);
      const report: CsvImportReport = { createdAppointments: 0, createdPatients: 0, errors: [] };

      const firstLine = req.body.csv.split(/\r?\n/, 1)[0] ?? '';
      const delimiter = firstLine.includes(';') ? ';' : ',';

      let records: Record<string, string>[];
      try {
        records = parse(req.body.csv, {
          columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
          delimiter,
          skip_empty_lines: true,
          trim: true,
        });
      } catch (err) {
        report.errors.push({ row: 0, message: `CSV non leggibile: ${err instanceof Error ? err.message : err}` });
        return report;
      }

      for (const [i, rec] of records.entries()) {
        const row = i + 2; // 1 = header
        const phone = normalizePhone(rec['telefono'] ?? '');
        if (!phone) {
          report.errors.push({ row, message: `Telefono non valido: "${rec['telefono'] ?? ''}"` });
          continue;
        }
        const startsAt = localToUtc(rec['data'] ?? '', rec['ora'] ?? '', clinic.timezone);
        if (!startsAt) {
          report.errors.push({ row, message: `Data/ora non valide: "${rec['data']}" "${rec['ora']}"` });
          continue;
        }
        if (!rec['nome'] || !rec['cognome']) {
          report.errors.push({ row, message: 'Nome o cognome mancanti' });
          continue;
        }
        const durationMin = Number(rec['durata_minuti'] || 30);
        const consent = ['si', 'sì', 'true', '1', 'x'].includes((rec['consenso_privacy'] ?? '').toLowerCase());

        try {
          await prisma.$transaction(async (tx) => {
            let patient = await tx.patient.findUnique({
              where: { clinicId_phone: { clinicId: clinic.id, phone } },
            });
            if (!patient) {
              patient = await tx.patient.create({
                data: {
                  clinicId: clinic.id,
                  firstName: rec['nome']!,
                  lastName: rec['cognome']!,
                  phone,
                  privacyConsentAt: consent ? new Date() : null,
                },
              });
              await logEvent(tx, { clinicId: clinic.id, type: 'patient_created', patientId: patient.id, payload: { source: 'csv' } });
              report.createdPatients++;
            }
            const a = await tx.appointment.create({
              data: {
                clinicId: clinic.id,
                patientId: patient.id,
                startsAt: startsAt!,
                durationMin: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 30,
                // troncata: nel CSV di un gestionale può arrivare testo lungo
                visitType: (rec['tipo_visita'] || 'Visita').slice(0, VISIT_TYPE_MAX_LENGTH),
              },
            });
            await syncReminders(tx, a);
            await logEvent(tx, {
              clinicId: clinic.id,
              type: 'appointment_created',
              appointmentId: a.id,
              patientId: patient.id,
              payload: { visitType: a.visitType, source: 'csv' },
            });
            report.createdAppointments++;
          });
        } catch (err) {
          report.errors.push({ row, message: err instanceof Error ? err.message : String(err) });
        }
      }

      await logEvent(prisma, {
        clinicId: clinic.id,
        type: 'csv_imported',
        payload: {
          createdAppointments: report.createdAppointments,
          createdPatients: report.createdPatients,
          errorCount: report.errors.length,
        },
      });
      return report;
    },
  );
}
