# Delad Supabase-deployment

Kompetensportalen är isolerad för en Supabase-instans som delas med andra
applikationer.

- PostgreSQL-schema: `kompetensportalen`
- Storage-bucket: `kompetensportalen-course-assets`
- Auth-cookie: `kompetensportalen-auth`
- Edge Functions: inga funktioner installeras av denna app

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

Projektet byggs med Vite/Vinext och producerar `dist/`, vilket passar det
gemensamma deployscriptet. Vinext behåller serverroutes för autentisering,
checkout, kursåtkomst och admin. Kör den byggda appen som en separat process
med `npm run start` och en egen port, exempelvis `3013`.

Starta inte om andra frontend-processer när Kompetensportalen deployas.
