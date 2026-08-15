# Kompetensportalen.se

Fristående LMS, e-handel och certifieringsplattform för WPE Sweden AB. Första produktionskursen är Arbete på väg - APV 1.1-1.3, men kursmotor, datamodell och administration är byggda för många utbildningar.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
npm test
```

Lokal förhandsvisning körs normalt på Vites port `http://localhost:5173/`.

## Supabase deployment

The production target is Supabase Postgres, Storage, Auth and Edge Functions.
Copy `.env.example` to `.env.local`, set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, then run the migrations and deploy the three Edge
Functions documented in `supabase/README.md`.
Setup, private storage and the first admin account are documented in
[`supabase/README.md`](supabase/README.md).

## Ingår

- publik webbplats och produktvy
- Drizzle/Postgres-schema för LMS, e-handel, företag, certifikat, ID06, GDPR och audit logs
- APV 1.1-1.3 seed-data
- domänmotor för enrollment, återcertifiering, examination, certifikat, företagslicenser och påminnelser
- Odoo-importverktyg med migrationsrapport
- Supabase Edge Function API för autentisering, order, Stripe Checkout/webhook, kursprogress, examination, företagslicenser, certifikatverifiering, ID06, GDPR och utgångspåminnelser
- separat examination engine med kursversionskonfiguration, provsnapshot, tidsgräns, maxförsök, cooldown och deltagarvy
- adminvyer för dashboard, kurser, frågebank, deltagare, order, ID06 och Odoo-import
- `.env.example` för Stripe, e-post, BankID, ID06 och säkerhetsinställningar
- konfigurerbart BankID-start-/collectflöde bakom ett leverantörsneutralt adapterinterface

## Dokumentation

- `docs/architecture.md`
- `docs/operations.md`
- `docs/odoo-migration.md`
- `docs/odoo-export-checklist.md`
- `docs/api-and-flows.md`
- `docs/shared-supabase-deployment.md`

## Supabase Auth

Inloggning sker via Supabase Auth med e-post och lösenord. Skyddade sidor
använder server-side rollkontroll. Första admin-kontot skapas i Supabase Auth
och läggs därefter till i `KP_ADMIN_EMAILS`.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: skapa den statiska Vite-klienten i `dist/`
- `npm test`: bygg klienten och kontrollera Vite-, Supabase- och schema-layouten
- `npm run db:generate:supabase`: generera Supabase/Postgres-migrationer
- `npm run db:migrate:supabase`: kör migrationer mot Supabase
- `npm run migration:normalize-csv -- ./odoo-csv ./apv-export.json`: normalisera ett CSV-bundle från Odoo till importformatet

## Deployment

Webbservern ska servera `dist/` och skicka alla SPA-rutter till `index.html`.
API-anrop, betalningar, adminbehörighet och filuppladdning körs i Supabase
Edge Functions. Klienten innehåller inga serverroutes, D1- eller R2-beroenden.
