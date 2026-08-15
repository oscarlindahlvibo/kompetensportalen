# Delad Supabase-deployment

Kompetensportalen är isolerad för en Supabase-instans som delas med andra
applikationer.

- PostgreSQL-schema: `kompetensportalen`
- Storage-bucket: `kompetensportalen-course-assets`
- Auth: Supabase Auth med klientens persistenta session
- Edge Functions: `api`, `cron-daily`, `stripe-webhook`

Kör migrationerna från denna app i filnamnsordning. De får inte kopieras om till
de andra apparnas migrationsmappar. Den lokala tillståndsfilen måste vara
separat per app, exempelvis `state/kompetensportalen-migrations.json`, eftersom
checksumor och versionshistorik hör till respektive app.

Sätt både server- och byggvariabler:

```dotenv
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=...
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_DB_SCHEMA=kompetensportalen
SUPABASE_STORAGE_BUCKET=kompetensportalen-course-assets
```

## Webbserver

Projektet byggs med ren Vite och producerar `dist/`, vilket passar det
gemensamma deployscriptet. Alla serveroperationer för autentisering, checkout,
kursåtkomst och admin går via Supabase Edge Function `api`. Servera `dist/` som
en statisk SPA och konfigurera fallback till `index.html`.

Starta inte om andra frontend-processer när Kompetensportalen deployas.
