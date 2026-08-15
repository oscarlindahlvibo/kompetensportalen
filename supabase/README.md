# Supabase-drift

Kompetensportalen kan köras mot Supabase med följande providerflaggor:

```dotenv
KP_DATABASE_PROVIDER=supabase
KP_STORAGE_PROVIDER=supabase
KP_AUTH_PROVIDER=supabase
```

Kör migreringen mot projektets Postgres-databas:

```bash
SUPABASE_DB_URL='postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require' \
  npm run db:migrate:supabase
```

Kör `supabase/migrations/0001_runtime_security.sql` efter den genererade
datamodellen om migrationerna inte redan har körts i ordningsföljd. Bucketen
`course-assets` ska vara privat. Kursfiler läses endast via appens serverroute,
som först kontrollerar enrollment och kursåtkomst.

Skapa det första admin-kontot i Supabase Auth. Lägg dess e-post i
`KP_ADMIN_EMAILS`; applikationen skapar sedan den interna användaren och ger
den rollen `super_admin` vid första inloggningen.

## Data från den gamla miljön

Exportera först den lokala D1/SQLite-databasen eller ange sökvägen till den
SQLite-fil som innehåller den gamla datan. Kör därefter:

```bash
SUPABASE_DB_URL='postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require' \
  npm run migrate:sqlite:supabase -- /path/to/db.sqlite
```

Skriptet använder upsert per primärnyckel, konverterar SQLite-booleanvärden och
skriver en tabellvis rapport. Kör det aldrig mot en databas som inte först har
fått Supabase-migrationerna. Kursassets migreras separat till den privata
`course-assets`-bucketen eftersom filer inte ligger i relationsdatabasen.

På en Node-server ersätter `/api/cron/daily` Worker-cronen. Anropa den en gång
per dygn med `Authorization: Bearer $CRON_SECRET` från serverns cron eller
hostingplattformens scheduler.
