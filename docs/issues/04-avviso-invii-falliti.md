# Avvisare lo studio quando gli invii falliscono

**Etichette:** `enhancement`, `priorità-alta`, `affidabilità`
**Stima:** 2-3 ore (banner) · un giorno con la notifica via email

## Il problema

`GET /api/health` si accorge già degli invii che falliscono in blocco e risponde
503, ma quell'avviso raggiunge **chi gestisce il servizio**, non lo studio.

Dal lato dello studio la situazione è peggiore di quanto sembri: se le
credenziali del canale scadono, la dashboard continua a funzionare, l'agenda si
riempie normalmente, e l'unico segnale è una scritta piccola sulla singola card
dell'appuntamento («numero non su WhatsApp», «invio non riuscito»). Una
segretaria che non sa di doverla cercare non la vede.

Il risultato è il guasto peggiore: **tutto sembra a posto e nessun paziente
riceve niente**, finché qualcuno non si presenta senza essere stato avvisato.

## Approccio

Per gradi, dal più utile al più costoso.

### 1. Banner in dashboard (da fare per primo)

In cima all'Agenda, come già avviene per i «messaggi da gestire»: se negli ultimi
giorni ci sono promemoria falliti, un riquadro rosso che dice quanti sono e
cosa fare.

I dati ci sono già — basta una rotta che conti i promemoria in stato
`failed`, `failed_template`, `failed_rate_limit`, `failed_recipient` in una
finestra recente. Vale la pena distinguere i due casi, perché richiedono azioni
diverse:

- **guasto di canale** (i primi tre) → «il collegamento a WhatsApp non funziona,
  contattaci»
- **numeri non validi** (`failed_recipient`) → «questi pazienti hanno un numero
  senza WhatsApp», con l'elenco, così la segreteria può correggerli

### 2. Notifica via email al titolare

Quando il canale risulta rotto per più di N minuti. Dipende dall'infrastruttura
email della issue #3: conviene farle insieme.

### 3. Riepilogo periodico (facoltativo)

Un messaggio settimanale con i numeri della settimana. È anche un modo per
ricordare allo studio che il servizio sta lavorando — utile in fase di pilota.

## Criteri di accettazione

- [ ] La segreteria vede in Agenda che ci sono invii falliti, senza cercarli
- [ ] Il banner distingue un guasto di canale da un numero sbagliato
- [ ] Per i numeri sbagliati si arriva al paziente da correggere in un click
- [ ] Il banner scompare da solo quando gli invii tornano a funzionare
- [ ] Nessun falso allarme per un singolo fallimento isolato

## File coinvolti

- `apps/api/src/routes/health.ts` — la logica di soglia esiste già, da riusare
- Nuova rotta sotto `apps/api/src/routes/` per il conteggio per studio
- `apps/web/src/pages/Agenda.tsx` — accanto a `InboundAttentionBanner`

## Attenzione

La soglia dell'health check (≥3 fallimenti e ≥50% dei tentativi) è tarata per un
monitoraggio automatico, dove un falso allarme sveglia qualcuno di notte. Per un
banner in dashboard può essere più sensibile: mostrarlo anche per un solo
fallimento è accettabile, purché il testo non sia allarmistico.
