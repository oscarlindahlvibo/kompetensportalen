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

Detta är en Next.js-applikation med serverroutes för autentisering, checkout,
kursåtkomst och admin. Den ska därför köras som en separat Node-process och får
inte deployas genom att enbart kopiera `dist/` som en statisk webbplats.

Efter `npm run build` startas den fristående servern med:

```bash
HOSTNAME=127.0.0.1 PORT=3013 node .next/standalone/server.js
```

Använd en egen systemd-tjänst och proxya en egen domän eller sökväg till port
3013. Starta inte om andra frontend-processer när Kompetensportalen deployas.
