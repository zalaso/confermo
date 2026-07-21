import type { ReminderKind } from '@confermo/shared';
import type { TemplateVariables } from './provider.js';

/**
 * Template WhatsApp da sottomettere a Meta (categoria: UTILITY, lingua: it).
 *
 * ATTENZIONE: con il canale reale attivo il testo del messaggio è quello
 * approvato da Meta — i testi configurabili in dashboard valgono solo in
 * modalità mock. La personalizzazione per studio passa dalle variabili
 * (il nome dello studio è una variabile).
 *
 * I testi in `metaBody` vanno incollati così come sono nel pannello 360dialog
 * al momento della sottomissione (vedi docs/whatsapp-setup.md).
 */
export interface WhatsappTemplateDef {
  /** nome del template come registrato presso Meta */
  name: string;
  language: string;
  /** testo con variabili numerate, nel formato richiesto da Meta */
  metaBody: string;
  /** ordine delle variabili: posizione i => {{i+1}} */
  variablesOrder: (keyof TemplateVariables)[];
  buttons: { text: string }[];
}

export const WHATSAPP_TEMPLATES: Record<ReminderKind, WhatsappTemplateDef> = {
  reminder_48h: {
    name: 'promemoria_48h',
    language: 'it',
    metaBody:
      'Gentile {{1}}, le ricordiamo il suo appuntamento presso {{2}} il giorno {{3}} alle ore {{4}}. Risponda con un pulsante per aiutarci a organizzare l’agenda.',
    variablesOrder: ['paziente', 'studio', 'data', 'ora'],
    buttons: [{ text: 'Confermo' }, { text: 'Devo disdire' }],
  },
  reminder_3h: {
    name: 'promemoria_3h',
    language: 'it',
    metaBody:
      'Gentile {{1}}, le ricordiamo l’appuntamento di oggi alle ore {{2}} presso {{3}}. A più tardi!',
    variablesOrder: ['paziente', 'ora', 'studio'],
    buttons: [{ text: 'Confermo' }, { text: 'Devo disdire' }],
  },
  // NB: il ringraziamento post-conferma NON è un template Meta: viene inviato
  // come messaggio di sessione dentro la finestra 24h, testo libero.
};

/** Prefissi dei payload dei pulsanti quick-reply: "CONFERMO:<appointmentId>". */
export const BUTTON_PAYLOAD = {
  confirm: 'CONFERMO',
  cancel: 'DISDICO',
} as const;

export function buildButtonPayloads(appointmentId: string): { confirm: string; cancel: string } {
  return {
    confirm: `${BUTTON_PAYLOAD.confirm}:${appointmentId}`,
    cancel: `${BUTTON_PAYLOAD.cancel}:${appointmentId}`,
  };
}

/** Interpreta un payload di pulsante: tipo + eventuale appointmentId. */
export function parseButtonPayload(
  payload: string,
): { button: 'confirm' | 'cancel'; appointmentId: string | null } | null {
  const [head, id] = payload.split(':');
  if (head === BUTTON_PAYLOAD.confirm) return { button: 'confirm', appointmentId: id || null };
  if (head === BUTTON_PAYLOAD.cancel) return { button: 'cancel', appointmentId: id || null };
  // fallback sul testo del pulsante (l'utente può anche scriverlo a mano)
  const text = payload.toLowerCase().trim();
  if (text === 'confermo') return { button: 'confirm', appointmentId: null };
  if (text === 'devo disdire') return { button: 'cancel', appointmentId: null };
  return null;
}
