# Confermo

Promemoria automatici su WhatsApp per studi medici e dentistici: il paziente
riceve il promemoria a 48 e 3 ore dall'appuntamento e risponde con un tocco
(«Confermo» / «Devo disdire»). Dashboard in italiano per la segreteria.

Il servizio è online in produzione e il canale WhatsApp reale è stato
collaudato end-to-end.

---

## 📚 Documentazione

**I tre documenti principali** — l'indice completo è in [docs/README.md](docs/README.md):

| Documento | A cosa serve |
| --- | --- |
| **[docs/funzionamento.md](docs/funzionamento.md)** | Come funziona il sistema nel dettaglio: regole di invio, stati, privacy, architettura |
| **[docs/setup.md](docs/setup.md)** | Procedura passo per passo, dal deploy all'attivazione di uno studio |
| **[docs/per-lo-studio.md](docs/per-lo-studio.md)** | **Da consegnare al cliente**: cosa fa, cosa serve, cosa non inserire |

Modelli da far firmare in [docs/modelli/](docs/modelli/), approfondimenti
tecnici in [docs/riferimenti/](docs/riferimenti/), materiale di vendita in
[docs/vendita/](docs/vendita/).

---

## Struttura del codice

```
apps/api          Backend Fastify + TypeScript + Prisma (PostgreSQL)
apps/web          Dashboard React + Vite
packages/shared   Enum, tipi e regole condivise (stati, transizioni, modelli)
docs/             Documentazione
```

## Avvio in sviluppo

Servono tre terminali. Node ≥ 22; PostgreSQL non va installato, viene scaricato
come dipendenza del progetto.

```bash
npm install
npm run db:start                 # 1. PostgreSQL locale su porta 5433
npm run db:migrate -w apps/api   # solo la prima volta
npm run seed -- --clinic "Studio Demo" --preset dentista
npm run dev:api                  # 2. API su http://localhost:3001
npm run dev:web                  # 3. Dashboard su http://localhost:5173
```

Il comando `seed` stampa le credenziali di accesso.

Preset disponibili: `dentista`, `poliambulatorio`, `fisioterapia`. Cambiano solo
le tipologie di appuntamento proposte, non il funzionamento.

## Comandi utili

```bash
npm test                    # 157 test (avvia un PostgreSQL dedicato su porta 5434)
npm run typecheck           # controllo dei tipi su api e web
npm run build:web           # build di produzione della dashboard

npm run set-password -w apps/api -- --list                     # utenti registrati
npm run set-password -w apps/api -- --email studio@esempio.it  # nuova password

npm run backup -w apps/api -- --list                                  # studi presenti
npm run backup -w apps/api -- --export --clinic "Studio X" --out b.json
npm run backup -w apps/api -- --import --in b.json                    # ripristino
```

## Monitoraggio e backup

`GET /api/health` risponde **503** in tre casi: database irraggiungibile,
scheduler fermo da oltre cinque minuti, oppure **invii che falliscono in
blocco** — quest'ultimo è il guasto silenzioso, quello in cui lo scheduler gira
ma il canale WhatsApp è rotto e nessun paziente riceve più niente.

Il comando `backup` produce una copia indipendente dalla piattaforma di
hosting; il ciclo esporta → cancella → ripristina è coperto da test.

Procedura completa in [docs/riferimenti/operativita.md](docs/riferimenti/operativita.md).

## Privacy — la regola che vale sempre

Confermo tratta dati personali comuni, **mai dati sanitari**. Il tipo di
appuntamento resta un'etichetta generica e breve (massimo 40 caratteri) e **non
è disponibile tra le variabili dei messaggi**: comparirebbe nell'anteprima
della notifica sul telefono del paziente.

Dettagli in [docs/funzionamento.md § Privacy](docs/funzionamento.md#9-privacy-e-sicurezza-le-scelte-di-progetto)
e in [docs/per-lo-studio.md](docs/per-lo-studio.md).
