import type { Prisma } from '@prisma/client';
import type { Db } from '../db.js';

export type EventType =
  | 'patient_created'
  | 'patient_updated'
  | 'patient_deleted'
  | 'appointment_created'
  | 'appointment_rescheduled'
  | 'appointment_status_changed'
  | 'reminder_sent'
  | 'reminder_failed'
  | 'reminder_skipped'
  | 'reminder_postponed'
  | 'reminder_retry_scheduled'
  | 'reply_received'
  | 'csv_imported'
  | 'inbound_text_received'
  | 'patient_opted_out'
  | 'patient_opt_in_restored'
  | 'thankyou_sent'
  | 'thankyou_skipped'
  | 'thankyou_failed'
  | 'whatsapp_settings_updated'
  | 'whatsapp_test_sent'
  | 'whatsapp_webhook_token_rotated'
  | 'clinic_settings_updated'
  | 'password_changed';

/**
 * Registra un evento di audit. Il payload NON deve mai contenere dati personali
 * (nomi, telefoni): solo stati, tipi e timestamp, così le metriche sopravvivono
 * alla cancellazione GDPR di un paziente.
 */
export async function logEvent(
  db: Db,
  e: {
    clinicId: string;
    type: EventType;
    appointmentId?: string | null;
    patientId?: string | null;
    payload?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await db.eventLog.create({
    data: {
      clinicId: e.clinicId,
      type: e.type,
      appointmentId: e.appointmentId ?? null,
      patientId: e.patientId ?? null,
      payload: e.payload ?? {},
    },
  });
}
