import type { ReminderKind } from '@confermo/shared';

/** Variabili del template, già formattate nel fuso dello studio. */
export interface TemplateVariables {
  paziente: string;
  data: string;
  ora: string;
  studio: string;
}

export interface OutgoingMessage {
  /** Numero destinatario in E.164, es. "+393331234567" */
  to: string;
  /** Testo già renderizzato (usato dal mock e per i log di anteprima) */
  body: string;
  kind: ReminderKind;
  /** Variabili per i provider a template (WhatsApp reale) */
  variables: TemplateVariables;
  /**
   * Payload dei pulsanti quick-reply, impostati a ogni invio: contengono
   * l'ID appuntamento così la risposta è legata all'appuntamento esatto.
   */
  buttonPayloads: { confirm: string; cancel: string };
  reminderId: string;
  appointmentId: string;
}

export interface SendResult {
  providerMessageId: string;
}

export type SendFailureKind = 'template' | 'recipient' | 'rate_limit' | 'other';

/** Errore di invio classificato: decide lo stato del reminder e se ha senso il retry. */
export class SendError extends Error {
  constructor(
    readonly kind: SendFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'SendError';
  }
}

/** Evento normalizzato ricevuto dal webhook del provider. */
export type IncomingEvent =
  | {
      type: 'button';
      providerMessageId: string;
      from: string;
      button: 'confirm' | 'cancel';
      /** estratto dal payload del pulsante, se presente */
      appointmentId: string | null;
    }
  | { type: 'text'; providerMessageId: string; from: string; body: string }
  | {
      /** esito asincrono di un invio (es. numero non su WhatsApp) */
      type: 'status_failed';
      providerMessageId: string;
      recipientUnreachable: boolean;
      detail: string;
    };

/**
 * Astrazione sul canale WhatsApp. Il resto del sistema non sa quale
 * provider è attivo per una clinic: parla solo con questa interfaccia.
 */
export interface MessagingProvider {
  readonly name: string;
  /** Invia un template con pulsanti (fuori dalla finestra 24h). */
  send(msg: OutgoingMessage): Promise<SendResult>;
  /** Invia un messaggio libero di sessione (solo dentro la finestra 24h). */
  sendText(to: string, body: string): Promise<SendResult>;
  /** Interpreta il payload del webhook del provider in eventi normalizzati. */
  parseIncoming(payload: unknown): IncomingEvent[];
}
