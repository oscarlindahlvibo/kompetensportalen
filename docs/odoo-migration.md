# Odoo-migration för APV 1.1-1.3

Målet är att exportera APV-kursen medan Odoo fortfarande fungerar och importera den till Kompetensportalen utan att ärva Odoos datamodell.

Runtime-bootstrapen skapar endast kursens metadata, en inaktiv produkt och en tom utkastsversion som markeras som `coming_soon`. Den får inte säljas och innehåller inget påhittat APV-material. Efter riktig Odoo-import, kvalitetsgranskning, kontroll av aktuella styrande dokument och publicering av den importerade kursversionen blir kursen köpbar.

## Importformat

Importverktyget `scripts/import-odoo-course.mjs` läser normaliserad JSON:

```json
{
  "course": {
    "name": "Arbete på väg - APV 1.1-1.3",
    "slug": "arbete-pa-vag-apv-1-1-3",
    "category": "Infrastruktur",
    "basePriceSek": 2490,
    "validityMonths": 60
  },
  "version": {
    "version": "1.0",
    "changelog": "Importerad APV-version",
    "exam": {
      "questionCount": 30,
      "passPercent": 80,
      "timeLimitSeconds": 3600,
      "maxAttempts": 3,
      "cooldownSeconds": 300,
      "topicRules": [
        { "topic": "Riskbedömning", "count": 5 },
        { "topic": "Arbetsmiljö", "count": 5 },
        { "topic": "Skyddszoner", "count": 5 },
        { "topic": "Vägmärken", "count": 5 },
        { "topic": "TMA", "count": 5 },
        { "topic": "Trafikmiljö", "count": 5 }
      ]
    }
  },
  "chapters": [
    {
      "title": "Introduktion",
      "lessons": [
        { "title": "Introduktion", "type": "video", "assetRef": "r2://apv/intro.mp4" },
        {
          "title": "Quiz - introduktion",
          "type": "quiz",
          "quiz": {
            "title": "Quiz - introduktion",
            "feedbackMode": "immediate",
            "passPercent": 80,
            "questionIndexes": [0, 1]
          }
        }
      ]
    }
  ],
  "questions": [
    {
      "topic": "Riskbedömning",
      "prompt": "...",
      "answers": [{ "label": "...", "isCorrect": true }]
    }
  ],
  "governingDocuments": [
    {
      "title": "Aktuellt styrande dokument",
      "documentNumber": "",
      "version": "",
      "publishedAt": "",
      "url": "",
      "lastCheckedAt": "",
      "notes": ""
    }
  ]
}
```

## Exportera från Odoo

Identifiera och exportera fält för:

- kursbeskrivning, pris, bild, publiceringsstatus och SEO
- kapitel och sorteringsordning
- lektioner, HTML/text, bilder, video och dokumentreferenser
- quiz, frågor, svarsalternativ, rätt svar, förklaringar och poäng
- slutprovets inställningar: frågeantal, godkäntgräns, försök och tidsgräns
- certifikatmall och relevanta kursinställningar

## Importbeteende och rapport

Importen validerar kursfält, lektionstyper, svarsalternativ, rätt svar och provgränser innan databasskrivning. Den rapporterar antal importerade kapitel, lektioner, frågor och svar, styrande dokument och slutprovsinställningar samt saknade bilder, saknade videor, varningar och fel. En importerad kurs får en inaktiv produkt automatiskt, så den kan kvalitetssäkras innan försäljning. Idempotency key beräknas från filens innehåll. Om kursversionen redan finns skapas inte kapitel eller frågor på nytt; rapporten markerar `skippedExistingVersion` och lämnar den historiska versionen orörd. Om en tidigare skrivning avbröts innan importloggen sparades kan samma payload reparera en ofullständig version när den saknar elev-enrollments; rapporten markerar då `repairedPartialVersion`. En version med elevhistorik ändras aldrig.

`assetRef` bevaras i lektionens body. Referenser med formatet `r2://nyckel` visas via `/api/course-assets/...`; den endpointen kräver inloggning, ett aktivt enrollment och att referensen faktiskt finns i deltagarens kursversion. Assets kan laddas upp från `Administration -> Odoo Migration` eller via `POST /api/admin/course-assets` som multipart med `file` och `key`. Tillåtna format är JPEG, PNG, WebP, MP4, WebM och PDF. Bilder är begränsade till 25 MB, PDF till 50 MB och video till 500 MB. Importen skapar även quiz och `quiz_questions` från lektionens `quiz.questionIndexes`, där indexen räknas från `questions`-listan i exporten.

## Körning

Validera en export lokalt utan att skriva data:

```bash
node --import tsx scripts/import-odoo-course.mjs ./apv-export.json
```

Kör den riktiga serverimporten efter att `KP_IMPORT_ENDPOINT` pekar på `/api/import/odoo` och en administrativ Sites-session används:

```bash
KP_IMPORT_ENDPOINT=https://kompetensportalen.se/api/import/odoo \
KP_IMPORT_USER_EMAIL=oscar@wpesweden.se \
node scripts/import-odoo-course.mjs ./apv-export.json --apply
```

`--apply` skriver inte själv till databasen; det använder samma server-side import, behörighetskontroll och idempotens som adminvyn. Utan `--apply` är verktyget alltid en torrkörning.

## CSV-bundle

Om Odoo exporterar separata CSV-filer kan de normaliseras utan att den nya databasen eller Odoo-modellerna behöver kännas till av kursmotorn:

```bash
npm run migration:normalize-csv -- ./odoo-csv ./apv-export.json
node scripts/import-odoo-course.mjs ./apv-export.json
```

Bundlet använder filerna `course.csv`, `version.csv`, `chapters.csv`, `lessons.csv`, `questions.csv`, `answers.csv` och valfritt `governing_documents.csv`. `lessons.csv` kopplar lektioner till kapitel via `chapterId`; `answers.csv` kopplar svar till frågor via `questionId`. Flervärdesfält använder `|`, exempelvis `tags=Online|ID06`, `questionIndexes=0|2` och `topicRules=Riskbedömning:5|Arbetsmiljö:5`. Fältet `body` får innehålla JSON eller vanlig text. Normaliseraren hanterar också CSV-celler med citattecken och kommatecken.

## Styrande dokument

Gamla TDOK-nummer hardkodas inte. Aktuella Trafikverket-dokument, version, publiceringsdatum, URL, ansvarig och senaste kontroll registreras i `governing_documents` och länkas till kursversionen.
