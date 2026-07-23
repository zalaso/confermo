// Tipi e costanti condivise tra API e dashboard.

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'cancelled',
  'no_show',
  'completed',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const REMINDER_KINDS = ['reminder_48h', 'reminder_3h'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** Tipi di template configurabili (i primi due sono anche kind dei reminder). */
export const TEMPLATE_KINDS = ['reminder_48h', 'reminder_3h', 'thank_you'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const REMINDER_STATUSES = [
  'pending',
  'sent',
  'failed',
  'skipped',
  'failed_template',
  'failed_recipient',
  'failed_rate_limit',
] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const REMINDER_RESPONSES = ['none', 'confirmed', 'cancel_requested'] as const;
export type ReminderResponse = (typeof REMINDER_RESPONSES)[number];

/**
 * Transizioni di stato ammesse per un appuntamento.
 * no_show/completed sono correggibili tra loro (errore di click della segretaria);
 * cancelled è riattivabile.
 */
export const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['confirmed', 'cancelled', 'no_show', 'completed'],
  confirmed: ['cancelled', 'no_show', 'completed'],
  cancelled: ['scheduled'],
  no_show: ['completed'],
  completed: ['no_show'],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Etichette italiane per la dashboard. */
export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'In attesa',
  confirmed: 'Confermato',
  cancelled: 'Disdetto',
  no_show: 'Non presentato',
  completed: 'Completato',
};

export const REMINDER_KIND_LABELS: Record<TemplateKind, string> = {
  reminder_48h: 'Promemoria 48 ore',
  reminder_3h: 'Promemoria 3 ore',
  thank_you: 'Ringraziamento dopo la conferma',
};

/** Variabili disponibili nei template dei messaggi. */
export const TEMPLATE_VARIABLES = ['paziente', 'data', 'ora', 'studio'] as const;

export const DEFAULT_TEMPLATES: Record<TemplateKind, string> = {
  reminder_48h:
    'Gentile {{paziente}}, le ricordiamo il suo appuntamento presso {{studio}} il {{data}} alle ore {{ora}}. Prema "Confermo" per confermare o "Devo disdire" se non può venire.',
  reminder_3h:
    'Gentile {{paziente}}, le ricordiamo il suo appuntamento di oggi alle ore {{ora}} presso {{studio}}. A più tardi!',
  thank_you: 'Grazie, ti aspettiamo!',
};

export const INBOUND_KINDS = ['button_confirm', 'button_cancel', 'text', 'opt_out'] as const;
export type InboundKind = (typeof INBOUND_KINDS)[number];

export const INBOUND_KIND_LABELS: Record<InboundKind, string> = {
  button_confirm: 'Ha confermato',
  button_cancel: 'Chiede di disdire',
  text: 'Messaggio libero',
  opt_out: 'Non vuole più ricevere messaggi',
};

// ---- Tipi dei payload API ----

export interface PatientDto {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  privacyConsentAt: string | null;
  optedOutAt: string | null;
  createdAt: string;
}

export interface ReminderDto {
  id: string;
  kind: ReminderKind;
  scheduledFor: string;
  status: ReminderStatus;
  sentAt: string | null;
  response: ReminderResponse;
  respondedAt: string | null;
}

export interface AppointmentDto {
  id: string;
  patient: PatientDto;
  startsAt: string; // ISO UTC
  localDate: string; // es. "21/07/2026" nel fuso dello studio
  localTime: string; // es. "15:30"
  durationMin: number;
  visitType: string;
  status: AppointmentStatus;
  reminders: ReminderDto[];
}

export interface MetricsDto {
  from: string;
  to: string;
  totalAppointments: number;
  byStatus: Record<AppointmentStatus, number>;
  remindersSent: number;
  remindersConfirmed: number;
  remindersCancelRequested: number;
  /** conferme / promemoria inviati (0-1) */
  confirmationRate: number | null;
  /** no_show / appuntamenti passati con esito (no_show+completed) (0-1) */
  noShowRate: number | null;
  avgResponseMinutes: number | null;
}

export interface CsvImportReport {
  createdAppointments: number;
  createdPatients: number;
  errors: { row: number; message: string }[];
}

export const WHATSAPP_PROVIDERS = ['dialog360', 'meta'] as const;
export type WhatsappProviderName = (typeof WHATSAPP_PROVIDERS)[number];

export const WHATSAPP_PROVIDER_LABELS: Record<WhatsappProviderName, string> = {
  dialog360: '360dialog (consigliato per la produzione)',
  meta: 'Meta Cloud API (diretto, utile per i test)',
};

export interface WhatsappSettingsDto {
  provider: WhatsappProviderName;
  active: boolean;
  phone: string | null;
  /** 360dialog: ID canale · Meta: phone number ID */
  channelId: string | null;
  /** true se una credenziale è salvata (mai restituita in chiaro) */
  apiKeyConfigured: boolean;
  /** ultimi 4 caratteri della credenziale, per conferma visiva */
  apiKeyLast4: string | null;
  /** URL completo da incollare nel pannello del provider (contiene il token) */
  webhookUrl: string | null;
  lastTest: { at: string; ok: boolean; error: string | null } | null;
}

/** Limite sul tipo di visita: etichette brevi e generiche, mai dati clinici. */
export const VISIT_TYPE_MAX_LENGTH = 40;

/** Lunghezza minima della password dello studio. */
export const MIN_PASSWORD_LENGTH = 10;

/** Fascia di silenzio predefinita: nessun messaggio la sera e la notte. */
export const DEFAULT_QUIET_HOURS = { start: '21:00', end: '08:00' } as const;

export interface ClinicDto {
  id: string;
  name: string;
  timezone: string;
  demoMode: boolean;
  appointmentTypes: string[];
  labels: ClinicLabels;
  /** fascia oraria senza invii, "HH:mm" nel fuso dello studio */
  quietHoursStart: string;
  quietHoursEnd: string;
}

/** Etichette dell'interfaccia, sovrascrivibili per studio (neutralità di settore). */
export interface ClinicLabels {
  studio?: string;
  paziente?: string;
  appuntamento?: string;
}

export const DEFAULT_LABELS: Required<ClinicLabels> = {
  studio: 'studio',
  paziente: 'paziente',
  appuntamento: 'appuntamento',
};

export interface DemoConversationMessage {
  direction: 'out' | 'in';
  body: string;
  at: string;
  /** true = promemoria con pulsanti (non il ringraziamento) */
  isTemplate: boolean;
}

export interface DemoConversationDto {
  clinicName: string;
  patientName: string;
  patientPhone: string;
  appointmentStatus: AppointmentStatus;
  /** i pulsanti del mockup sono cliccabili solo se c'è un promemoria senza risposta */
  buttonsActive: boolean;
  messages: DemoConversationMessage[];
}

export interface InboundMessageDto {
  id: string;
  kind: InboundKind;
  body: string | null;
  fromMasked: string;
  patientName: string | null;
  needsAttention: boolean;
  handledAt: string | null;
  createdAt: string;
}
