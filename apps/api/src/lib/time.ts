import { DateTime } from 'luxon';

/**
 * Converte data+ora locali dello studio in un Date UTC.
 * Accetta "dd/MM/yyyy" o "yyyy-MM-dd" per la data, "HH:mm" per l'ora.
 * Restituisce null se l'input non è valido.
 */
export function localToUtc(dateStr: string, timeStr: string, zone: string): Date | null {
  const trimmed = dateStr.trim();
  let iso: string;
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length !== 3) return null;
    const [d, m, y] = parts;
    iso = `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  } else {
    iso = trimmed;
  }
  const dt = DateTime.fromISO(`${iso}T${timeStr.trim()}`, { zone });
  return dt.isValid ? dt.toUTC().toJSDate() : null;
}

/** Formatta un istante UTC nel fuso dello studio: { date: "21/07/2026", time: "15:30" }. */
export function formatLocal(d: Date, zone: string): { date: string; time: string } {
  const dt = DateTime.fromJSDate(d).setZone(zone);
  return { date: dt.toFormat('dd/MM/yyyy'), time: dt.toFormat('HH:mm') };
}

/** "21:00" -> minuti da mezzanotte. null se il formato non è valido. */
export function parseHhMm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Fascia di silenzio: intervallo orario in cui non si scrive ai pazienti.
 * Può attraversare la mezzanotte (es. 21:00 → 08:00), e in quel caso
 * "dentro la fascia" significa dopo l'inizio OPPURE prima della fine.
 * Se inizio e fine coincidono la fascia è considerata disattivata.
 */
export function isWithinQuietHours(instant: Date, zone: string, start: string, end: string): boolean {
  const startMin = parseHhMm(start);
  const endMin = parseHhMm(end);
  if (startMin === null || endMin === null || startMin === endMin) return false;

  const local = DateTime.fromJSDate(instant).setZone(zone);
  const nowMin = local.hour * 60 + local.minute;

  return startMin < endMin
    ? nowMin >= startMin && nowMin < endMin // fascia dentro la stessa giornata
    : nowMin >= startMin || nowMin < endMin; // fascia a cavallo della mezzanotte
}

/**
 * Primo istante utile a partire da `instant`: se siamo dentro la fascia di
 * silenzio restituisce la fine della fascia (nel fuso dello studio),
 * altrimenti `instant` stesso.
 */
export function nextTimeOutsideQuietHours(
  instant: Date,
  zone: string,
  start: string,
  end: string,
): Date {
  if (!isWithinQuietHours(instant, zone, start, end)) return instant;

  const endMin = parseHhMm(end)!;
  const local = DateTime.fromJSDate(instant).setZone(zone);
  let candidate = local.startOf('day').plus({ minutes: endMin });
  // se la fine è già passata nella giornata locale, è quella di domani
  if (candidate <= local) candidate = candidate.plus({ days: 1 });
  return candidate.toUTC().toJSDate();
}
