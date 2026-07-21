/**
 * Preset per la demo: cambiano SOLO i dati di esempio (nome studio di
 * default, tipologie di appuntamento, durate tipiche), mai la logica.
 * Servono per mostrare il prodotto a studi non dentistici senza che sembri
 * "un software per dentisti".
 *
 * Le tipologie restano volutamente generiche: non devono mai suggerire
 * una diagnosi o una condizione clinica (vedi sezione privacy nel README).
 */
/**
 * Password dello studio dimostrativo. Facile da digitare davanti a un cliente
 * ma conforme al minimo richiesto agli account veri (MIN_PASSWORD_LENGTH):
 * la regola vale anche per noi, altrimenti non è una regola.
 */
export const DEMO_PASSWORD = 'demo-confermo';

export const PRESET_NAMES = ['dentista', 'poliambulatorio', 'fisioterapia'] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export interface DemoPreset {
  /** nome di default se non passato da riga di comando */
  defaultClinicName: string;
  /** tipologie proposte nel form appuntamento (clinic.appointmentTypes) */
  appointmentTypes: string[];
  /** durate plausibili in minuti, pescate a rotazione dal seed */
  durations: number[];
}

export const PRESETS: Record<PresetName, DemoPreset> = {
  dentista: {
    defaultClinicName: 'Studio Dentistico Demo',
    appointmentTypes: ['Igiene', 'Controllo', 'Otturazione', 'Prima visita'],
    durations: [30, 30, 45, 60],
  },
  poliambulatorio: {
    defaultClinicName: 'Poliambulatorio Demo',
    appointmentTypes: ['Prima visita', 'Controllo', 'Esame', 'Medicazione'],
    durations: [30, 20, 45, 15],
  },
  fisioterapia: {
    defaultClinicName: 'Centro Fisioterapico Demo',
    appointmentTypes: ['Seduta', 'Valutazione iniziale', 'Ciclo di sedute'],
    durations: [45, 60, 45],
  },
};

export function isPresetName(value: string): value is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(value);
}

/**
 * Pazienti fittizi: nomi palesemente inventati e numeri nel range +39 000...,
 * un prefisso non assegnato in Italia — nessun messaggio può raggiungere
 * una persona reale nemmeno per errore.
 */
export const DEMO_PATIENTS = [
  { firstName: 'Mario', lastName: 'Bianchi' },
  { firstName: 'Anna', lastName: 'Verdi' },
  { firstName: 'Luca', lastName: 'Gialli' },
  { firstName: 'Sofia', lastName: 'Neri' },
  { firstName: 'Paolo', lastName: 'Rosa' },
  { firstName: 'Giulia', lastName: 'Grigi' },
  { firstName: 'Marco', lastName: 'Azzurri' },
  { firstName: 'Elena', lastName: 'Viola' },
  { firstName: 'Davide', lastName: 'Arancio' },
  { firstName: 'Chiara', lastName: 'Celesti' },
  { firstName: 'Andrea', lastName: 'Marroni' },
  { firstName: 'Martina', lastName: 'Turchesi' },
  { firstName: 'Simone', lastName: 'Dorati' },
  { firstName: 'Valentina', lastName: 'Argenti' },
  { firstName: 'Francesco', lastName: 'Corallo' },
  { firstName: 'Alice', lastName: 'Ambra' },
  { firstName: 'Matteo', lastName: 'Indaco' },
  { firstName: 'Beatrice', lastName: 'Lilla' },
  { firstName: 'Riccardo', lastName: 'Ocra' },
  { firstName: 'Federica', lastName: 'Prugna' },
] as const;

/** Numero fittizio riconoscibile: +39 000 000 0001, 0002, ... */
export function demoPhone(index: number): string {
  return `+390000000${String(index + 1).padStart(3, '0')}`;
}
