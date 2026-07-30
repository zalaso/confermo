export class UnauthorizedError extends Error {
  constructor() {
    super('Sessione scaduta');
  }
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  // Il Content-Type va dichiarato SOLO se c'è davvero un corpo: annunciare
  // JSON e non mandare nulla fa fallire la richiesta con 400 prima ancora di
  // arrivare alla rotta (è quello che rompeva logout e "segna come gestito").
  const hasBody = opts.body !== undefined && opts.body !== null;
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...opts,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Errore del server (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
