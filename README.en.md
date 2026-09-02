# Confermo

*[🇮🇹 Leggi in italiano](README.md)*

**Automated WhatsApp appointment reminders for medical and dental practices.**
The patient gets a reminder and replies with a single tap — «Confermo» (confirm)
or «Devo disdire» (cancel) — while the practice's schedule updates itself.

It solves a measurable problem: a missed appointment is time you never get back,
and phoning every patient costs the front desk an hour a day. Confermo automates
the reminder and, more importantly, **asks for an answer**: patients who cancel
early free the slot in time to reassign it, and the receptionist only calls the
few who didn't reply.

> **Status:** working and deployed, with the real WhatsApp channel validated
> end-to-end. Awaiting the first pilot practice. See
> [What's missing](#whats-missing-and-how-id-build-it).

> **Language note:** the product interface and the detailed documentation are in
> **Italian**, since the target users are Italian practices. This README is the
> English entry point to the project.

---

## Contents

- [How it works](#how-it-works)
- [Features](#features)
- [Try it in five minutes](#try-it-in-five-minutes)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Privacy and GDPR](#privacy-and-gdpr)
- [What a customer needs to provide](#what-a-customer-needs-to-provide)
- [Progress so far](#progress-so-far)
- [What's missing and how I'd build it](#whats-missing-and-how-id-build-it)

---

## How it works

```
  The practice adds            Confermo schedules            The patient
  an appointment         →     two reminders           →     receives and replies
  (manually or via CSV)        (48h and 3h before)           with one tap
                                                                    │
                                                                    ▼
  The front desk only          The schedule updates          «Confermo» → confirmed
  sees what needs        ←     itself                  ←     «Devo disdire» → slot freed
  a human decision                                           free text → to the front desk
```

Reminders are sent from **the practice's own WhatsApp number**, not a platform
number: it's the practice writing to its own patients, which is also what makes
the sender recognisable to them.

The detailed behaviour — including the six situations where the system decides
**not** to send — is documented in [docs/funzionamento.md](docs/funzionamento.md)
(Italian).

---

## Features

### For the front desk

- **Daily schedule** with colour-coded states: pending, confirmed, cancelled,
  completed, no-show
- **Manual entry** or **CSV import** (recognises existing patients by phone number)
- **Rescheduling** an appointment without having to cancel and recreate it
- **"Needs attention" panel**: cancellations and free-text patient messages that
  require a person
- **Patient records** with privacy consent, opt-out state and full data deletion
- **Statistics**: confirmation rate, no-show rate, average response time, slots
  freed in advance

### Sending rules

The system never sends blindly. A reminder **is not sent** if the patient hasn't
given consent, has opted out, if the appointment was cancelled, if the channel
isn't configured, or if the message would now arrive too late to be useful.
Inside **quiet hours** (21:00–08:00 by default) it isn't dropped but postponed
to the next available time.

A reminder **never goes out twice** for the same appointment: that's a structural
guarantee, not a safeguard bolted on.

### Patient replies

- **Buttons carrying the appointment id**, so a reply is matched to the exact
  appointment even when the patient has several booked
- **Thank-you message** after a confirmation, sent as a session message inside
  WhatsApp's 24-hour window
- **Automatic opt-out** on STOP / BASTA / CANCELLAMI, with reactivation possible
  only against fresh consent
- **Free text is not interpreted**: it's shown to the receptionist, because
  guessing a patient's intent wrong costs more than having a human read one line

### Demo mode

A practice can be flagged as a demo: it **always** uses a simulated channel, even
with real credentials stored. The dashboard shows a **simulated phone** rendering
the message as the patient would see it, with working buttons — the text isn't
faked, it's what the system actually produced. A toolbar lets you change the
practice name, the type of business, and **reset all data in under a second**, to
move from one presentation to the next.

Demo data includes two weeks of history with realistic outcomes that are
**identical on every run**, so the statistics show credible numbers.

---

## Try it in five minutes

Requires **Node.js 22+**. PostgreSQL does not need to be installed: it's pulled
in as a project dependency.

```bash
npm install
npm run db:start                 # local database (keep this terminal open)
npm run db:migrate -w apps/api   # first time only
npm run seed -- --clinic "Studio Demo" --preset dentista
npm run dev:api                  # second terminal → http://localhost:3001
npm run dev:web                  # third terminal  → http://localhost:5173
```

The `seed` command prints the login credentials. No WhatsApp credentials are
needed: in demo mode messages appear in the simulated phone.

Available presets: `dentista`, `poliambulatorio`, `fisioterapia` — they only
change the sample data, not the behaviour.

### Useful commands

```bash
npm test                    # 157 tests (spins up a dedicated PostgreSQL, port 5434)
npm run typecheck           # type checking across backend and dashboard
npm run build:web           # production build

npm run backup -w apps/api -- --export --clinic "Studio X" --out b.json
npm run backup -w apps/api -- --import --in b.json
npm run set-password -w apps/api -- --email studio@example.com
```

---

## Tech stack

**TypeScript** end to end, with the types shared between backend and frontend in
a common package: appointment states and allowed transitions are defined once and
used by both.

### Backend — `apps/api`

| Technology | Version | Role |
| --- | --- | --- |
| **Node.js** | ≥ 22 | Runtime |
| **TypeScript** | 5.8 | Language, `strict` mode |
| **Fastify** | 5.4 | HTTP server |
| **Prisma** | 6.12 | ORM and database migrations |
| **PostgreSQL** | 17 | Database |
| **TypeBox** | 0.34 | Input validation, with types derived from the schemas |
| **Luxon** | 3.6 | Time zones and daylight saving (`Europe/Rome`) |
| **bcryptjs** | 3.0 | Password hashing |
| **csv-parse** | 5.6 | Appointment import |
| **tsx** | 4.20 | Runs TypeScript directly, no build step |

Fastify plugins: `@fastify/jwt` and `@fastify/cookie` for sessions,
`@fastify/rate-limit` against login brute-forcing, `@fastify/cors`, and
`@fastify/static` to serve the compiled dashboard.

### Frontend — `apps/web`

| Technology | Version | Role |
| --- | --- | --- |
| **React** | 19.1 | UI |
| **Vite** | 7.0 | Build and dev server |
| **Plain CSS** | — | No styling framework |

No component library and no external state manager: the UI has four pages and
simple state, and fewer dependencies mean less maintenance. Data loading uses
light polling (15 seconds) rather than WebSockets — more than enough for a
practice schedule, without a persistent connection to manage.

### Testing and tooling

| Technology | Role |
| --- | --- |
| **Vitest** 3.2 | Test framework |
| **embedded-postgres** | PostgreSQL pulled in as a dependency: integration tests run against a real database, with no Docker and nothing to install |
| **npm workspaces** | Monorepo, no extra tooling |
| **Railway** | Hosting, EU region |

The `embedded-postgres` choice is worth a note: integration tests start a real
PostgreSQL on port 5434, apply the migrations and run against it. No database
mocking — the things that matter in this system (transactional locking, unique
constraints, time-zone behaviour) are exactly what a mock would fail to reproduce.

### Size

| Area | Lines | Files |
| --- | --- | --- |
| Backend | 3,900 | 38 |
| Dashboard | 2,000 | 13 |
| Shared types | 225 | 1 |
| **Tests** | **2,700** | **23** |
| Operational scripts | 280 | 4 |

Roughly a 2:1 ratio of production code to tests, concentrated where a mistake is
expensive: duplicate sends, state transitions, consent, encryption.

---

## Architecture

```
apps/api          Backend, REST API + scheduler
apps/web          React dashboard (Italian UI)
packages/shared   Shared types and rules (states, transitions, templates)
docs/             Documentation
```

**A single process** serves the API, the dashboard and the scheduler: no external
queue, no Redis, no separate background service. It runs on a small server or a
managed platform, and in production the API also serves the compiled dashboard —
one domain, no CORS to configure.

### Data model

Six tables, all tied to `clinic` (the practice):

```
clinic ──┬── user              practice login
         ├── patient           records, consent, opt-out
         ├── appointment ──── reminder      scheduled reminders
         ├── message_template message texts
         ├── inbound_message  received messages (deduplicated)
         └── event_log        audit trail, no personal data in the payload
```

Five Prisma migrations, all additive.

### The three decisions that matter

**A scheduler without an external queue.** Reminders are materialised as database
rows the moment an appointment is created, each with its send time already
computed. An in-process worker claims them every 60 seconds using `FOR UPDATE
SKIP LOCKED` and marks them as sent **before** calling the provider. The
consequence is that a reminder cannot go out twice, not even with several
processes running or after a restart: in the worst case it is recorded as sent
without being sent, never the other way round.

**The WhatsApp channel as an abstraction, configured per practice.** The rest of
the system doesn't know which provider is active. Three implementations exist: a
simulated channel for demos and development, **360dialog** (an official BSP), and
**Meta's Cloud API** directly. Since 360dialog is a thin proxy over the same Meta
API, the shared logic lives in one place. Credentials are encrypted with
AES-256-GCM using the practice id as associated data: a credential copied onto
another practice's row simply won't decrypt.

**Multi-tenant from the schema.** Every entity is tied to a practice from the
start, even though today there is a single login per practice.

### Verification

**157 automated tests** (Vitest), mostly integration tests against a real
PostgreSQL started by the suite. They cover the parts where a mistake is costly:
send uniqueness under concurrent schedulers, webhooks delivered twice, state
transitions, consent and opt-out, credential encryption, quiet hours, late
reminders, resilience to the database going away, and the full backup-and-restore
cycle.

### Monitoring

`GET /api/health` returns **503** in three cases: database unreachable, scheduler
stalled for over five minutes, or **deliveries failing in bulk**. That last one is
the silent failure — if a practice's credentials expire, the scheduler keeps
running happily and every other check stays green while no patient receives
anything.

---

## Privacy and GDPR

These are design constraints, not footnotes:

- **No health data.** Only name, phone, date/time and a generic appointment
  label, capped at 40 characters with an explicit warning in the UI.
- **The appointment type never goes into messages**, deliberately: it would show
  in the phone's notification preview, readable by anyone holding the device.
- **Consent as a technical condition**: with no recorded consent the system does
  not send. It's checked on every send, not a checkbox for show.
- **Right to erasure**: full deletion of a patient; only aggregate statistics
  remain, and they contain no personal data.
- **Data hosted in the European Union**, both application and database.
- **Credentials encrypted** and never returned in clear text by the API.

---

## What a customer needs to provide

The practice installs nothing — it's a web app. But the WhatsApp channel is
**registered to the practice**, so some of their material is required.

| Required | Why | Watch out |
| --- | --- | --- |
| **A dedicated phone number** | It's the sender patients see | Must not already be in use on WhatsApp; removing it from an existing account takes days |
| **A company document** | WhatsApp verifies the business exists | Chamber of Commerce extract, VAT certificate, articles of incorporation or a bank statement |
| **VAT number and legal name** | Must match the document exactly | |
| **A public website over https** | Required by WhatsApp for verification | The most common cause of delay when missing |
| **An accessible email address** | Registration and notifications | |

**Patient consent** is collected once per patient and added to the practice's
intake paperwork. Without recorded consent the system sends nothing to that
patient.

**The question that decides everything:** what practice-management software do
they use, and can it export appointments? If it can, the receptionist uploads a
CSV once each morning. If it can't, appointments have to be entered twice — which
is the main reason systems like this get abandoned after three weeks. Settle it
*before* activating.

**Timeline:** roughly **an hour** together with the practice, plus WhatsApp's
approval — anywhere from a few hours to a couple of business days, and it can be
rejected on the first attempt.

---

## Progress so far

| Phase | Outcome |
| --- | --- |
| **MVP** (Jul 2026) | Data model, CRUD, CSV import, idempotent scheduler, Italian dashboard, metrics, 35 tests |
| **Per-practice channel** | Provider abstraction, 360dialog, encrypted credentials, deduplicated webhooks, opt-out, 24-hour window |
| **Demo-ready** | Per-practice demo mode, interactive simulated phone, parametric seed with industry presets |
| **Hardening** | Rate limiting, password change, late-reminder guard, quiet hours |
| **In production** | Deployed on Railway in the EU region, public HTTPS, automatic migrations |
| **Meta provider** | Cloud API directly alongside 360dialog, to validate on the free test number |
| **Real validation** | Full chain validated against WhatsApp: sending, confirmation, cancellation, thank-you, free text, opt-out |
| **Operability** | Health check for the silent failure, exportable backups with verified restore, 157 tests |

What real-world validation surfaced — error `132001`, the `messages` webhook
subscription, subscribing the app to the WhatsApp account — is written up in
[docs/riferimenti/whatsapp-collaudo-meta.md](docs/riferimenti/whatsapp-collaudo-meta.md),
because those are traps that cost an afternoon the first time you hit them.

---

## What's missing and how I'd build it

In order of weight, with the approach I'd take.

### 1. Integration with practice-management software

**The problem.** Without an automatic export, the receptionist enters every
appointment twice. This is the main barrier to adoption — more than any missing
feature.

**How I'd do it.** There's no standard: every product has its own. The sensible
approach is to start from the first pilot practice's software and build a
dedicated adapter, keeping CSV import as the universal fallback. If it exposes an
API, a periodic sync job; otherwise a watcher on an automatically exported file.
Worth doing only after seeing **one** real case: building an abstraction before
knowing two different systems is wasted effort.

### 2. Multiple users and roles

**The problem.** Today there's a single login per practice: the dentist and the
receptionist share one password.

**How I'd do it.** The schema is ready (`user` is already a separate table tied to
`clinic`). It needs a role field, a user management page, and permission
boundaries — plausibly: the front desk doesn't touch channel settings, the owner
does. Half a day.

### 3. Self-service password recovery

**The problem.** If a practice loses its password, it takes manual intervention on
the server.

**How I'd do it.** Requires an email delivery service, a table of expiring tokens,
and two screens. A day. A simpler alternative, more in keeping with the product:
recovery over **WhatsApp** to the practice's own number, reusing the channel
that's already configured.

### 4. Proactive notification when something breaks

**The problem.** The health check alerts **whoever runs the service**, not the
practice. If a practice's channel breaks, the receptionist finds out by looking
at the schedule.

**How I'd do it.** A dashboard banner when there are recent failed sends — the
most useful piece and the cheapest, since the data is already there. Email alerts
come later, and depend on item 3.

### 5. Data export for the practice (GDPR portability)

**The problem.** The backup command is for whoever administers the service. A
practice asking for its own data depends on us.

**How I'd do it.** A button in Settings that downloads the same JSON or CSV
export. The logic already exists in `apps/api/src/demo/backup.ts`: it needs a
route and a button. A few hours.

### 6. Waiting list

**The problem.** When a patient cancels, the freed slot is reassigned by hand.

**How I'd do it.** A list of patients willing to be called, and on cancellation a
message to the first in line offering the slot. It's the feature with the highest
perceived value, but it should come **after** a real pilot has shown that early
cancellations actually happen — otherwise you're optimising a problem you haven't
measured.

### Out of scope by choice

Billing and payments, voice receptionist, native mobile app, self-service
WhatsApp channel signup (requires Meta Tech Provider status).

### Not code, but blocking real use

- A **data processing agreement** (GDPR art. 28) signed with the practice
- A **consent form** reviewed by a professional
- A **paid hosting plan** and external monitoring configured

---

## Documentation

The detailed documentation is in Italian, aimed at Italian practices:

| Document | Contents |
| --- | --- |
| [docs/funzionamento.md](docs/funzionamento.md) | How the system behaves in detail: sending rules, states, privacy, architecture |
| [docs/setup.md](docs/setup.md) | Installation and activation, step by step |
| [docs/per-lo-studio.md](docs/per-lo-studio.md) | Handed to the customer: what it does, what's needed, what not to enter |
| [docs/README.md](docs/README.md) | Full index, including templates and reference material |

---

## Licence

All rights reserved. The source may be read for evaluation purposes; any use,
copying or distribution requires written permission. See [LICENSE](LICENSE).
