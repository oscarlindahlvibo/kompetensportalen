# Drift och installation

## Lokalt

1. Installera Node.js 22.13 eller senare.
2. Kör `npm install`.
3. Kopiera `.env.example` till `.env.local` och fyll i hemligheter.
4. Kör `npm run dev`.
5. Kör `npm run db:generate:supabase` efter schemaändringar.
6. Kör `npm run db:migrate:supabase` mot en Supabase-databas.

## Deployment

Applikationen körs som en separat Next.js-server med Supabase som enda databas-,
Storage- och Auth-plattform. Appen använder PostgreSQL-schemat
`kompetensportalen` och Storage-bucketen `kompetensportalen-course-assets`, så
den delar inte tabeller eller filer med andra appar i samma Supabase-instans.
Sätt `KP_DATABASE_PROVIDER=supabase`,
`KP_STORAGE_PROVIDER=supabase` och `KP_AUTH_PROVIDER=supabase`.
Service-role-nyckeln får endast finnas server-side.

Kör appens migrationer före första deploy. De skapar schema och bucket.
Kursfiler hämtas genom serverroutes som först kontrollerar användarens
enrollment.

Bygget skapar en fristående Next.js-server i `.next/standalone`. Kör den i en
egen process, exempelvis på port `3013`; kopiera inte bara `dist/`, eftersom
admin, autentisering, checkout och kursåtkomst använder serverroutes.

Produktionsallowlisten för Super Admin ligger i `KP_ADMIN_EMAILS`.
`PII_ENCRYPTION_KEY` ska vara en lång hemlighet och krävs innan personnummer
kan sparas.

## Databas

Schema ligger i `db/schema-pg.ts`. Genererade migrationer sparas under
`supabase/migrations/`. Viktiga constraints omfattar unika e-postadresser,
kurs-slugs, kursversioner, certifikat- och verifieringskoder samt
lektionsprogress per enrollment.

## Stripe och order

Webhooken ska verifiera signaturen och sätta ordern till `paid` innan systemet
skapar enrollments eller aktiverar företagslicenser. Fakturaköp kräver
`invoice_purchase_enabled` och godkänns av behörig administratör.

## E-post och cron

Notifieringar läggs först i `notifications`. För riktig leverans sätts
`MAIL_PROVIDER=resend`, `MAIL_API_KEY` och `MAIL_FROM`. Anropa
`POST /api/cron/daily` en gång per dygn med `Authorization: Bearer $CRON_SECRET`
från serverns cron eller hostingplattformens scheduler.

## BankID och ID06

Initialt stöds manuell BankID-dokumentation. Ett framtida BankID-adapterlager
kan konfigureras med `BANKID_*`-variabler utan att kursmotorn ändras.

ID06-statusar är `not_ready`, `ready_for_id06`, `submitted`, `registered` och
`failed`. Administrativ handläggning sparar datum, admin och referens.

## Backup

Säkerhetskopiera Supabase Postgres och den privata Storage-bucketen separat.
Bevara elevdokumentation, provsnapshots, certifikat, ID06-historik och
auditloggar enligt avtal, revisionskrav och tillämplig lag.

1. Aktivera Supabase automatiska databasbackuper och behåll en separat krypterad kopia.
2. Exportera Storage-objekt och ett manifest över kursassets och dokument.
3. Begränsa backupåtkomst till driftansvariga.
4. Testa återställning kvartalsvis i en separat miljö.
5. Dokumentera exporttid, commit, checksumma, ansvarig och testresultat.

Återställ alltid först till en separat Supabase-miljö och kör `npm test` innan
produktionen påverkas.
