# Recupero password autonomo

**Etichette:** `enhancement`, `supporto`
**Stima:** un giorno (via email) · mezza giornata (via WhatsApp)

## Il problema

Se uno studio perde la password, l'unica via è un intervento manuale sul server:

```bash
npm run set-password -w apps/api -- --email studio@esempio.it
```

Significa che uno studio bloccato di sabato mattina resta fuori finché qualcuno
non apre un terminale. Con un solo studio pilota è accettabile; con cinque
diventa un servizio di reperibilità non dichiarato.

## Approccio

Due strade, con un compromesso diverso.

### A — Email (la via convenzionale)

1. Servizio di invio transazionale (Resend, Postmark o simile — non serve un
   server SMTP proprio).
2. Tabella `password_reset_token`: token casuale, `user_id`, scadenza (30
   minuti), `used_at`. Il token va salvato **cifrato**, non in chiaro: un accesso
   in lettura al database non deve permettere di prendere possesso degli account.
3. Due rotte: richiesta e conferma. La richiesta risponde **sempre** allo stesso
   modo, che l'email esista o no — altrimenti diventa un modo per scoprire quali
   studi sono registrati.
4. Rate limiting stretto sulla richiesta, come già fatto sul login.
5. Due schermate nella dashboard.

### B — WhatsApp (più in linea con il prodotto)

Il codice di recupero arriva sul **numero dello studio**, riusando il canale già
configurato e verificato. Nessun servizio esterno da aggiungere, e il numero è
già stato provato in fase di attivazione.

Limite: funziona solo per gli studi con canale attivo, quindi non copre il caso
di uno studio che perde la password *prima* di aver completato l'attivazione.

**Proposta:** WhatsApp come via principale, email come riserva. Ma la B da sola
copre già la situazione reale più frequente.

## Criteri di accettazione

- [ ] Uno studio può recuperare l'accesso senza intervento manuale
- [ ] Il token scade e si può usare una sola volta
- [ ] Richiedere un recupero per un'email inesistente non rivela che non esiste
- [ ] Il recupero è soggetto a rate limiting
- [ ] Il cambio password invalida gli altri accessi attivi
- [ ] L'operazione resta a registro

## File coinvolti

- `apps/api/src/routes/auth.ts` — nuove rotte accanto a `change-password`
- `apps/api/src/plugins/rateLimit.ts` — nuovo limite
- `apps/api/prisma/schema.prisma` — tabella dei token
- `apps/web/src/pages/Login.tsx` — collegamento «password dimenticata»

## Attenzione

Il messaggio di recupero via WhatsApp sarebbe un messaggio di sessione, quindi
soggetto alla finestra di 24 ore: se lo studio non ha scritto di recente al
proprio numero, servirebbe un modello approvato apposta. Da verificare prima di
scegliere la strada B.
