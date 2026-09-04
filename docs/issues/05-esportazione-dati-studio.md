# Esportazione dei dati dalla dashboard (portabilità GDPR)

**Etichette:** `enhancement`, `gdpr`
**Stima:** 3-4 ore

## Il problema

Il comando `npm run backup` esporta i dati di uno studio, ma è uno strumento da
riga di comando per chi amministra il servizio.

Uno studio che chiede una copia dei propri dati — per portabilità, per un
cambio di fornitore, o semplicemente per tenersene una — **dipende da noi**.

Non è solo una scomodità: il titolare dello studio è il titolare del trattamento
dei dati dei suoi pazienti, e dovrebbe poterli ottenere senza chiedere il
permesso a chi glieli custodisce.

## Approccio

La logica esiste già ed è collaudata: `exportClinic()` in
`apps/api/src/demo/backup.ts`, coperta dai test in
`test/integration/backup-e-salute.test.ts`. Serve solo esporla.

1. **Rotta** `GET /api/clinic/export`, riservata al titolare (vedi issue #2 se i
   ruoli nel frattempo esistono), che restituisce il JSON con gli header giusti
   per il download.
2. **Pulsante** in Impostazioni → Dati dello studio: «Scarica una copia dei
   dati», con una riga che spieghi cosa contiene e cosa no.
3. **Variante CSV** per pazienti e appuntamenti: il JSON va bene per un
   ripristino tecnico, ma uno studio che vuole guardarsi i dati apre Excel. Due
   file separati, con le stesse colonne dell'import — così l'export può essere
   reimportato altrove.

Le credenziali WhatsApp restano escluse, come già avviene: sono cifrate con una
chiave legata all'installazione e non avrebbero senso fuori di qui.

## Criteri di accettazione

- [ ] Uno studio scarica i propri dati dalla dashboard, senza intervento esterno
- [ ] Il file contiene solo i dati di quello studio
- [ ] Le credenziali del canale non sono nel file (già garantito da un test)
- [ ] L'esportazione resta a registro (chi, quando)
- [ ] Il CSV dei pazienti è reimportabile dalla funzione di import esistente
- [ ] Il download avverte che il file contiene dati personali e va custodito

## File coinvolti

- `apps/api/src/demo/backup.ts` — `exportClinic` da riusare così com'è
- `apps/api/src/routes/clinic.ts` — nuova rotta
- `apps/web/src/pages/Impostazioni.tsx` — pulsante nella sezione dello studio

## Attenzione

Il file contiene nomi, telefoni e appuntamenti di pazienti: è un'esportazione di
dati personali. Va detto esplicitamente nell'interfaccia, e vale la pena
registrare l'operazione nel registro eventi — se un domani qualcosa esce dallo
studio, deve esserci traccia di quando è stato scaricato e da chi.
