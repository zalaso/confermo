# Deploy in produzione (regione EU)

Confermo è un solo processo Node: API, dashboard e scheduler insieme. Serve
soltanto un PostgreSQL. I dati devono restare in **Unione Europea**.

Due percorsi. Per le prime demo e lo studio pilota consiglio Railway: si mette
online in una ventina di minuti e l'HTTPS è automatico.

---

## A. Railway (regione EU)

### 1. Progetto e database

1. Su [railway.app](https://railway.app): **New Project → Deploy from GitHub repo**
   (oppure `railway up` dalla cartella del progetto).
2. Nelle impostazioni del servizio scegliere una **region europea**
   (`europe-west4`). Va fatto anche per il database.
3. **New → Database → PostgreSQL**, sempre in region EU. Railway espone
   automaticamente `DATABASE_URL` al servizio.

### 2. Variabili d'ambiente

Nel servizio, sezione *Variables*:

| Variabile | Valore | Note |
| --- | --- | --- |
| `DATABASE_URL` | (fornita da Railway) | riferimento al Postgres del progetto |
| `JWT_SECRET` | stringa casuale lunga | `openssl rand -base64 32` |
| `CREDENTIALS_ENCRYPTION_KEY` | 32 byte in base64 | vedi sotto — **non perderla** |
| `APP_BASE_URL` | `https://<tuo-dominio>` | HTTPS pubblico, senza slash finale |
| `PORT` | `3001` | Railway la imposta da sé, lasciarla se già presente |
| `NODE_ENV` | `production` | attiva i cookie `secure` |
| `NPM_CONFIG_INCLUDE` | `dev` | **obbligatoria**, vedi sotto |
| `MESSAGING_PROVIDER` | `mock` | vedi nota sotto |

> **Perché `NPM_CONFIG_INCLUDE=dev`.** Con `NODE_ENV=production` npm salta le
> `devDependencies`, ma `vite` e `typescript` — che compilano la dashboard —
> stanno proprio lì. Senza questa variabile il build fallisce al passo
> `build:web`. `tsx` e `prisma` invece sono fra le `dependencies` apposta,
> perché servono a far partire il processo e a eseguire le migrazioni.

Generare la chiave di cifratura:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> **La chiave di cifratura non è recuperabile.** Se la perdi, le API key dei
> canali WhatsApp salvate diventano illeggibili e vanno reinserite a mano dalla
> pagina Impostazioni. Conservala in un password manager.

> **`MESSAGING_PROVIDER=mock`** è il valore giusto finché non c'è un canale
> WhatsApp reale: significa "gli studi senza canale configurato non mandano
> nulla di vero". Uno studio con canale 360dialog attivo usa comunque il canale
> reale, a prescindere da questa variabile. Uno studio con `demo_mode` attivo
> usa sempre il mock, anche se ha credenziali salvate.

### 3. Build, avvio e migrazioni

**Non serve configurare nulla a mano**: il file [`railway.json`](../railway.json)
nella radice del repository dichiara già tutto.

- install: lo fa Nixpacks da solo. **Non aggiungere `npm ci` al build command**:
  la seconda installazione va in conflitto con la cache montata da Docker e il
  build muore con `npm error code EBUSY` su `rmdir`
- build: `npm run db:generate -w apps/api && npm run build:web`
- pre-deploy: `prisma migrate deploy` (le migrazioni girano **prima** che la
  nuova versione riceva traffico; `migrate dev` non va mai usato in produzione,
  può cancellare dati)
- avvio: `npm run start -w apps/api`
- health check su `/api/health`: se risponde male, Railway non manda in
  produzione la nuova versione

L'API serve anche la dashboard compilata da `apps/web/dist`: un solo servizio,
un solo dominio, nessun CORS da configurare.

Nota: `tsx` e `prisma` stanno fra le `dependencies` e non fra le
`devDependencies` perché servono a runtime (il processo parte con `tsx`) e al
pre-deploy (le migrazioni). Spostarli fra le dev romperebbe il deploy.

### 5. Dominio

*Settings → Networking → Generate Domain* (o dominio personalizzato). Copiare
l'URL in `APP_BASE_URL` e fare redeploy: quel valore costruisce l'URL del
webhook WhatsApp, quindi deve essere quello pubblico definitivo.

---

## B. VPS europeo (Hetzner, OVH, Aruba)

1. Server in datacenter EU (Hetzner Falkenstein/Norimberga va bene), Ubuntu LTS.
2. Installare Node 20+, PostgreSQL 16+, e un reverse proxy con HTTPS
   (Caddy è il più rapido: gestisce Let's Encrypt da solo).
3. Creare database e utente, poi `/opt/confermo/.env` con le stesse variabili
   della tabella sopra.
4. Build e avvio:

   ```bash
   npm ci
   npm run db:generate -w apps/api
   npm run build:web
   npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
   npm run start -w apps/api
   ```

5. Servizio systemd (`/etc/systemd/system/confermo.service`) con
   `Restart=always`, così il processo riparte da solo dopo un riavvio o un
   crash. Il poller riprende da dove era: i promemoria non ancora inviati sono
   sul database, non in memoria.
6. Caddyfile:

   ```
   confermo.tuodominio.it {
       reverse_proxy localhost:3001
   }
   ```

7. Backup: `pg_dump` giornaliero su storage EU, con retention. Verificare
   almeno una volta che il ripristino funzioni davvero.

---

## Preparare lo studio dimostrativo

Dopo il deploy, creare lo studio demo (senza credenziali WhatsApp: non servono):

```bash
npm run seed -w apps/api -- --clinic "Studio Dentistico Rossi" --preset dentista
```

Preset disponibili: `dentista`, `poliambulatorio`, `fisioterapia`.
Credenziali predefinite: `demo@confermo.it` / `demo-confermo` — cambiarle con
`--email` e `--password` se l'installazione è raggiungibile pubblicamente.
La password deve avere almeno 10 caratteri, la stessa regola richiesta agli
studi veri.

Se perdi l'accesso, dal server:

```bash
npm run set-password -w apps/api -- --list                       # elenco utenti
npm run set-password -w apps/api -- --email studio@esempio.it    # genera una password nuova
```

Lo studio nasce con `demo_mode` attivo. Da lì in poi tutto si gestisce dalla
barra gialla in cima alla dashboard: cambio nome, cambio tipo di attività e
azzeramento dati in meno di un secondo, senza toccare il terminale.

## Verifica dopo il deploy

```bash
curl https://<dominio>/api/health
```

Risposta attesa (HTTP 200):

```json
{ "ok": true, "database": "ok", "scheduler": { "status": "ok" } }
```

Risponde **503** se il database non risponde o se il poller non completa un giro
da più di cinque minuti: è l'endpoint da usare per il monitoraggio esterno
(UptimeRobot o simili).

Poi, dal telefono:

1. Accedere con le credenziali demo → l'agenda si apre con appuntamenti e la
   barra gialla «MODALITÀ DEMO».
2. Aprire **Statistiche**: i numeri devono essere popolati.
3. Su un appuntamento premere **📱 Messaggio → Invia promemoria adesso**: la
   bolla verde compare nel telefono simulato.
4. Premere **Confermo** dentro il mockup: la card diventa «Confermato».

Nessuna credenziale WhatsApp è necessaria per nessuno di questi passaggi.

## Attivare il WhatsApp reale (studio pilota)

Quando ci sarà il primo studio pagante, seguire
[whatsapp-360dialog.md](whatsapp-360dialog.md). In sintesi: creare lo studio **senza**
`demo_mode`, inserire le credenziali 360dialog dalla pagina Impostazioni e
incollare l'URL del webhook nel pannello del BSP. Serve `APP_BASE_URL` in HTTPS,
altrimenti Meta rifiuta il webhook.

## GDPR: cosa verificare prima di dati reali

- Database e applicazione in region EU (verificabile nel pannello del provider).
- Cifratura at rest del volume Postgres attiva.
- DPA firmato con il provider di hosting e con 360dialog.
- Backup anch'essi in EU.
- Informativa privacy dello studio aggiornata con i sub-responsabili
  (hosting, 360dialog, Meta).
