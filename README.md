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

Lokal förhandsvisning körs normalt på `http://localhost:3000/`.

## Supabase deployment

The production target is Supabase Postgres, Storage and Auth. Copy
`.env.example` to `.env.local`, set the three `KP_*_PROVIDER` values to
`supabase`, and run `npm run db:migrate:supabase` with `SUPABASE_DB_URL`.
Setup, private storage and the first admin account are documented in
[`supabase/README.md`](supabase/README.md).

## Ingår

- publik webbplats och produktvy
- Drizzle/Postgres-schema för LMS, e-handel, företag, certifikat, ID06, GDPR och audit logs
- APV 1.1-1.3 seed-data
- domänmotor för enrollment, återcertifiering, examination, certifikat, företagslicenser och påminnelser
- Odoo-importverktyg med migrationsrapport
- server-side API för autentisering, order, Stripe Checkout/webhook, kursprogress, examination, företagslicenser, certifikatverifiering, ID06, GDPR och utgångspåminnelser
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
- `npm run build`: verifiera Next.js produktionsbygge
- `npm test`: build appen och kör domäntester för återcertifiering, företag, certifikat, ID06 och order
- `npm run db:generate:supabase`: generera Supabase/Postgres-migrationer
- `npm run db:migrate:supabase`: kör migrationer mot Supabase
- `npm run migration:normalize-csv -- ./odoo-csv ./apv-export.json`: normalisera ett CSV-bundle från Odoo till importformatet

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Drizzle PostgreSQL Guide](https://orm.drizzle.team/docs/get-started-postgresql)
