# Confermo — MVP Anti No-Show per studi dentistici

Promemoria automatici WhatsApp a 48 e 3 ore dall'appuntamento, con conferma del
paziente («Confermo» / «Devo disdire») e dashboard in italiano per la segreteria.

## Struttura

```
apps/api       Backend Fastify + TypeScript + Prisma (PostgreSQL)
apps/web       Dashboard React + Vite
packages/shared  Enum, tipi e regole condivise (stati, transizioni, template)
```

## Avvio in sviluppo

Servono tre terminali (Node ≥ 20, nessun'altra installazione richiesta —
PostgreSQL viene scaricato come dipendenza npm):

```bash
npm install
npm run db:start        # 1. PostgreSQL embedded su localhost:5433
npm run db:migrate -w apps/api   # solo la prima volta: applica le migrazioni
npm run seed            # dati demo (rilanciabile: azzera e ricrea lo studio demo)
npm run dev:api         # 2. API su http://localhost:3001
npm run dev:web         # 3. Dashboard su http://localhost:5173
```

**Login demo:** `demo@confermo.it` / `demo-confermo`

### Modalità demo (presentazioni ai prospect)

Il seed è parametrico: crea lo studio col nome di chi stai andando a trovare,
con agenda dei prossimi giorni e due settimane di storico, così le Statistiche
mostrano numeri credibili (circa 56% di conferme e 13% di no-show, identici a
ogni esecuzione perché gli esiti sono assegnati per quote, non a caso).

```bash
npm run seed -- --clinic "Studio Dentistico Rossi" --preset dentista
npm run seed -- --clinic "Poliambulatorio Salute"  --preset poliambulatorio
npm run seed -- --clinic "Centro Fisioterapico Aurora" --preset fisioterapia
```

Il preset cambia solo i dati di esempio (tipologie di appuntamento e nome),
mai la logica: il prodotto non è specifico per dentisti.

Lo studio nasce con il flag `demo_mode`, che vive **sulla clinic**: uno studio
demo usa sempre il provider finto, anche se ha credenziali WhatsApp salvate e
canale attivo. È la garanzia che permette di fare demo su un'installazione di
produzione senza rischio di inviare messaggi veri.

Durante la presentazione:

- barra gialla in cima → cambia nome studio, tipo di attività, **azzera i dati**
  (meno di un secondo, senza uscire dalla sessione);
- su ogni appuntamento, **📱 Messaggio** apre il telefono simulato del paziente:
  «Invia promemoria adesso» mostra la bolla verde col testo reale generato dal
  sistema, e i pulsanti «Confermo» / «Devo disdire» percorrono esattamente la
  stessa strada di una risposta vera via webhook.

### Cosa NON inserire nel sistema

Confermo tratta dati personali comuni, **mai dati sanitari**. Il tipo di
appuntamento deve restare un'etichetta generica e breve (max 40 caratteri):
niente diagnosi, patologie, farmaci o specializzazioni che rivelino una
condizione. Per lo stesso motivo il tipo di appuntamento **non è disponibile
tra le variabili dei messaggi**: comparirebbe nell'anteprima della notifica sul
telefono del paziente, leggibile da chiunque abbia il dispositivo in mano.
Elenco completo in [docs/whatsapp-setup.md](docs/whatsapp-setup.md).

## Architettura in breve

- **Scheduler senza Redis**: alla creazione/modifica di un appuntamento le righe
  `reminder` vengono materializzate con l'orario di invio precalcolato. Un poller
  ogni 60 s le reclama con `FOR UPDATE SKIP LOCKED` in transazione e le marca
  `sent` **prima** dell'invio (at-most-once). Il vincolo
  `UNIQUE(appointment_id, kind)` rende strutturalmente impossibile il doppio
  invio. Vedi `apps/api/src/services/dispatcher.ts`.
- **Timezone**: tutto salvato in UTC (`timestamptz`); la conversione da/verso
  `Europe/Rome` (`clinic.timezone`) avviene ai bordi con Luxon.
- **Provider WhatsApp**: interfaccia `MessagingProvider`
  (`apps/api/src/messaging/`), selezionato **per studio**: canale 360dialog
  attivo con credenziali proprie → `Dialog360Provider`; altrimenti
  `MockProvider` in dev/demo. Le API key sono cifrate at rest (AES-256-GCM,
  AAD = id dello studio). Webhook per-clinic con token segreto nell'URL,
  dedup su message ID, opt-out STOP/BASTA, finestra 24h per il messaggio di
  ringraziamento. Attivazione di un nuovo studio: `docs/whatsapp-setup.md`.
  `TwilioWhatsAppProvider` resta uno scheletro per il futuro.
- **Stati appuntamento**: `scheduled → confirmed/cancelled/no_show/completed`,
  transizioni valide in `packages/shared` (`ALLOWED_TRANSITIONS`).

## GDPR

- Nessun dato clinico: solo nome, telefono, data e tipo generico di visita.
- Consenso privacy per paziente (`privacy_consent_at`): senza consenso il
  sistema **non invia nulla** (reminder marcati `skipped`, evento a log).
- Diritto all'oblio: `DELETE /api/patients/:id` elimina paziente, appuntamenti e
  promemoria; l'`event_log` (che non contiene mai dati personali nel payload)
  viene scollegato, così le metriche aggregate sopravvivono.
- In produzione: hostare in EU (Railway region EU / Hetzner), attivare la
  cifratura at rest del provider Postgres, generare un `JWT_SECRET` casuale.

## Import CSV

Prima riga di intestazione, separatore `,` o `;` (Excel italiano):

```csv
nome;cognome;telefono;data;ora;durata_minuti;tipo_visita;consenso_privacy
Mario;Rossi;333 1234567;21/07/2026;15:30;30;Igiene;si
```

I pazienti vengono riconosciuti (o creati) in base al numero di telefono.
Un file di esempio è in `docs/esempio-import.csv`.

## Test

```bash
npm test
```

117 test (Vitest). Gli integration test avviano un PostgreSQL embedded dedicato
su porta 5434: scheduling dei promemoria, transizioni di stato, idempotenza
(inclusi dispatcher concorrenti e webhook consegnati due volte), consenso
privacy, cifratura credenziali, parsing webhook Cloud API, opt-out, retry con
backoff, selezione del provider per studio, modalità demo, resilienza del
poller alla caduta del database, fascia di silenzio, promemoria in ritardo,
cambio password e protezione dagli attacchi a forza bruta.

## Quando i promemoria NON partono

Oltre a consenso mancante e opt-out, lo scheduler si ferma in due casi pensati
per non far fare brutta figura allo studio:

- **Promemoria ormai inutile.** Dopo un fermo del servizio il poller trova
  l'arretrato con l'orario di invio già passato. Un promemoria che arriverebbe
  a meno di 30 minuti dall'appuntamento (o dopo) viene scartato invece che
  inviato: «le ricordiamo il suo appuntamento» a visita iniziata è peggio del
  silenzio. A log come `reminder_skipped` con motivo `too_late`.
- **Fascia di silenzio** (predefinita 21:00 → 08:00, configurabile per studio
  in Impostazioni). Qui il promemoria non viene scartato ma **rinviato** alla
  prima ora utile: senza questa regola il promemoria delle 3 ore per una visita
  alle 9:00 partirebbe alle 6 del mattino. Gli invii comandati a mano (prova
  del canale, pulsante della demo) ignorano la fascia.

## Accessi

Un solo utente per studio. La password si cambia da **Impostazioni → Password
di accesso** (serve quella attuale) e deve avere almeno 10 caratteri. Il login
accetta 8 tentativi ogni 15 minuti per combinazione indirizzo+email, poi
blocca temporaneamente.

Se uno studio perde l'accesso, dal server:

```bash
npm run set-password -w apps/api -- --list                     # chi è registrato
npm run set-password -w apps/api -- --email studio@esempio.it  # genera una password nuova
```

## Monitoraggio

`GET /api/health` verifica database e poller. Risponde 503 se il database non
risponde o se lo scheduler non completa un giro da più di cinque minuti: è
l'endpoint da puntare con un servizio di uptime esterno.

## Documentazione

| Documento | A cosa serve |
| --- | --- |
| [deploy.md](docs/deploy.md) | Mettere online il servizio (Railway EU o VPS) |
| [whatsapp-setup.md](docs/whatsapp-setup.md) | Riferimento completo su 360dialog e i template Meta |
| [procedura-attivazione-studio.md](docs/procedura-attivazione-studio.md) | Foglio di campo da avere in mano durante la visita a uno studio |
| [modulo-consenso-pazienti.md](docs/modulo-consenso-pazienti.md) | Bozza del consenso che lo studio fa firmare ai pazienti |

## Deploy (VPS singolo o Railway)

Procedura completa in **[docs/deploy.md](docs/deploy.md)**. In sintesi:

1. Postgres gestito o locale; impostare `DATABASE_URL`, `JWT_SECRET`, `PORT`,
   `CREDENTIALS_ENCRYPTION_KEY` (32 byte base64, per le credenziali WhatsApp)
   e `APP_BASE_URL` (URL pubblico HTTPS, usato per i webhook).
2. `npx prisma migrate deploy` in `apps/api`.
3. `npm run build:web` — l'API serve la build statica da `apps/web/dist`
   (un solo processo: API + dashboard + scheduler).
4. Avvio: `npm run start -w apps/api`.
5. Per attivare il WhatsApp reale di uno studio: seguire `docs/whatsapp-setup.md`
   (360dialog; credenziali per-clinic dalla pagina Impostazioni della dashboard).
