/**
 * Normalizza un numero di telefono italiano in formato E.164.
 * "333 123 4567" -> "+393331234567". Restituisce null se non riconoscibile.
 */
export function normalizePhone(raw: string): string | null {
  let p = raw.replace(/[\s\-().]/g, '');
  // prefisso whatsapp: usato dai provider ("whatsapp:+39...")
  if (p.toLowerCase().startsWith('whatsapp:')) p = p.slice(9);
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (/^3\d{8,9}$/.test(p)) p = '+39' + p; // cellulare senza prefisso
  if (/^0\d{5,10}$/.test(p)) p = '+39' + p; // fisso senza prefisso
  // wa_id di Meta: E.164 senza "+" (es. "393331234567" nei webhook Cloud API)
  if (/^\d{11,15}$/.test(p)) p = '+' + p;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

/**
 * Maschera un numero per log e record non personali: "+39 333 •••• 567".
 * Nei log applicativi i telefoni passano SEMPRE da qui.
 */
export function maskPhone(raw: string): string {
  const p = normalizePhone(raw) ?? raw.replace(/\s/g, '');
  const m = p.match(/^(\+\d{2})(\d{3})\d+(\d{3})$/);
  if (!m) return '•••';
  return `${m[1]} ${m[2]} •••• ${m[3]}`;
}
