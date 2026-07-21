/** Sostituisce le variabili {{nome}} nel corpo del template. Variabili ignote -> stringa vuota. */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
}
