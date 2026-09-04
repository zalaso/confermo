# Integrazione con i gestionali di studio

**Etichette:** `enhancement`, `priorità-alta`, `adozione`
**Stima:** dipende dal gestionale — da 2 giorni (export CSV automatizzato) a 1-2
settimane (API proprietaria)

## Il problema

Senza un collegamento al gestionale dello studio, la segretaria inserisce ogni
appuntamento **due volte**: una nel gestionale e una in Confermo.

È l'ostacolo principale all'adozione, più di qualsiasi funzione mancante. Un
sistema che aggiunge lavoro quotidiano viene abbandonato nel giro di poche
settimane, indipendentemente da quanto funzioni bene il resto.

Oggi l'unica via è l'import CSV manuale (`POST /api/appointments/import-csv`),
che richiede comunque a qualcuno di esportare e caricare un file ogni mattina.

## Approccio

**Non costruire un'astrazione prima di conoscere due casi reali.** Non esiste uno
standard fra i gestionali per studi medici italiani: ognuno ha il suo formato,
e progettare un'interfaccia generica su ipotesi produce quasi sempre la
generalizzazione sbagliata.

Il percorso proposto:

1. **Partire dal gestionale del primo studio pilota.** Capire cosa sa esportare e
   con quale meccanismo (file su disco, invio email programmato, API).
2. **Costruire un adattatore dedicato** a quel gestionale, dietro un'interfaccia
   minima (`sincronizzaAppuntamenti(clinicId): Promise<Risultato>`).
3. **Mantenere l'import CSV come via universale**: resta il piano B per ogni
   studio che non ha un adattatore.
4. Solo al **secondo** gestionale, estrarre ciò che è davvero comune.

Due modalità plausibili, a seconda di cosa offre il gestionale:

- **API disponibile** → un job periodico nello scheduler esistente che sincronizza
  la finestra dei prossimi 7 giorni, con `syncReminders` invocato sugli
  appuntamenti nuovi o modificati.
- **Solo export su file** → un percorso sorvegliato (cartella locale o
  condivisa) da cui leggere il file più recente, riusando il parser CSV già
  presente.

## Criteri di accettazione

- [ ] Gli appuntamenti del gestionale compaiono in Confermo senza intervento
      manuale quotidiano
- [ ] Un appuntamento **spostato** nel gestionale viene spostato anche in
      Confermo, non duplicato
- [ ] Un appuntamento **disdetto** nel gestionale annulla i promemoria in coda
- [ ] La sincronizzazione è idempotente: eseguirla due volte non crea duplicati
- [ ] I pazienti sono riconosciuti per numero di telefono normalizzato, come già
      fa l'import CSV
- [ ] Nessun dato clinico viene importato: solo nome, telefono, data/ora e
      tipologia generica, con troncamento a `VISIT_TYPE_MAX_LENGTH`

## File coinvolti

- `apps/api/src/routes/appointments.ts` — logica di import esistente da riusare
- `apps/api/src/services/reminders.ts` — `syncReminders` va invocato sui
  cambiamenti
- Nuovo: `apps/api/src/integrations/<nome-gestionale>.ts`

## Attenzione

Il modello dati non prevede un identificativo esterno sugli appuntamenti: per
riconoscere lo stesso appuntamento fra una sincronizzazione e l'altra servirà
aggiungere un campo `external_id` (migrazione additiva) con un vincolo di
unicità per studio.
