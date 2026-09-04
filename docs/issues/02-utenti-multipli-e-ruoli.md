# Utenti multipli e ruoli per studio

**Etichette:** `enhancement`, `sicurezza`
**Stima:** mezza giornata

## Il problema

Oggi c'è **un solo accesso per studio**: il titolare e la segretaria condividono
la stessa email e la stessa password.

Le conseguenze pratiche:

- non si sa chi ha fatto cosa (il registro eventi non può attribuire un'azione a
  una persona);
- se la segretaria se ne va, va cambiata la password di tutti;
- il titolare non può limitare l'accesso alle impostazioni del canale WhatsApp,
  dove si incollano le credenziali.

## Approccio

Lo schema è già predisposto: `user` è una tabella separata collegata a `clinic`,
quindi più utenti per studio funzionano già a livello di dati. Manca il resto.

1. **Migrazione additiva**: campo `role` su `user`, valori `owner` e `staff`,
   default `staff`. Gli utenti esistenti diventano `owner` (sono loro che hanno
   configurato tutto).
2. **Autorizzazione nelle rotte**: un `preHandler` che verifica il ruolo. La
   divisione plausibile:
   - `staff` — agenda, pazienti, statistiche, messaggi da gestire
   - `owner` — tutto il precedente, più impostazioni dello studio, canale
     WhatsApp, testi dei messaggi, gestione utenti
3. **Pagina di gestione utenti** in Impostazioni, visibile solo al titolare:
   elenco, invito (crea utente con password generata), rimozione.
4. **Attribuzione nel registro**: aggiungere `user_id` a `event_log` per le
   azioni compiute da una persona, lasciandolo nullo per quelle del sistema.

## Criteri di accettazione

- [ ] Un titolare può creare e rimuovere utenti del proprio studio
- [ ] Un utente `staff` che chiama una rotta riservata riceve 403, non 200
- [ ] Un utente non può in alcun modo agire su uno studio diverso dal proprio
- [ ] Il registro eventi mostra chi ha disdetto un appuntamento
- [ ] Rimuovere un utente invalida la sua sessione
- [ ] Gli utenti esistenti continuano a funzionare senza intervento manuale

## File coinvolti

- `apps/api/prisma/schema.prisma` — campo `role`
- `apps/api/src/plugins/auth.ts` — il ruolo entra nel token di sessione
- `apps/api/src/server.ts` — registrazione delle rotte riservate
- `apps/web/src/pages/Impostazioni.tsx` — nuova sezione

## Attenzione

Il ruolo va messo **anche nel token di sessione**, ma la verifica non deve
fidarsi solo di quello: un token emesso prima di un declassamento porterebbe con
sé il ruolo vecchio fino alla scadenza (30 giorni). Per le azioni sensibili
conviene rileggere il ruolo dal database.
