# Odoo-export: APV 1.1-1.3

Detta dokument är exportunderlaget för den riktiga APV-migreringen. Odoo-versioner
och installationer kan ha olika tekniska modellnamn, så exportansvarig ska fylla
i de faktiska tekniska modellnamnen från den aktuella databasen i manifestet.
Kursmotorn ska inte ta över modellnamnen; de används bara i exportsteget.

## Exportmanifest

Skapa ett manifest med följande uppgifter innan exporten lämnas över:

| Fält | Krävs | Beskrivning |
| --- | --- | --- |
| `odooVersion` | Ja | Version av Odoo |
| `databaseIdentifier` | Ja | Internt namn eller export-id, inte lösenord |
| `courseModel` | Ja | Tekniskt modellnamn för kursen |
| `chapterModel` | Ja | Tekniskt modellnamn för kapitel |
| `lessonModel` | Ja | Tekniskt modellnamn för lektion/material |
| `quizModel` | Ja | Tekniskt modellnamn för quiz |
| `questionModel` | Ja | Tekniskt modellnamn för frågor |
| `answerModel` | Ja | Tekniskt modellnamn för svarsalternativ |
| `examModel` | Ja | Tekniskt modellnamn för slutprov eller provinställning |
| `assetSources` | Ja | Lista över exporterade bilder, filmer och dokument |
| `exportedAt` | Ja | Tidpunkt för exporten |

## Fält som ska exporteras

### Kurs

Exportera kursens stabila externa id, namn, slug eller webbidentifierare,
kort/full beskrivning, kategori, pris, moms, kampanjpris, giltighetstid,
uppskattad kurstid, målgrupp, förkunskaper, regelverk, kompetenskod,
ID06-inställning, identitetskrav, etiketter, kursbild, banner och SEO-fält.

### Struktur och innehåll

För varje kapitel och lektion behövs stabilt externt id, föräldra-id,
sorteringsordning, titel, innehållstyp, text/HTML, obligatorisk-status och
referenser till bilder, video och dokument. Exportera även inbäddade länkar och
tabeller i ett format som kan bevaras utan att HTML körs osanerad.

### Quiz och frågor

För varje quiz, fråga och svar behövs stabilt externt id, koppling till lektion
eller kapitel, ordning, frågetyp, frågetext, bildreferens, svarsalternativ,
rätt-svar-markering, förklaring, poäng och quizets återkopplingsläge.
Quizets frågor ska exporteras med uttryckliga id-referenser; positioner ensamma
är inte tillräckliga för historisk spårbarhet.

### Slutprov

Exportera provets kursversionskoppling, antal frågor, godkäntgräns, tidsgräns,
maximalt antal försök, väntetid, slumpning av frågor/svar samt ämnesregler.
Ämnesregler ska innehålla ämne och antal frågor och måste kunna fyllas av den
exporterade frågebanken.

### Assets

Exportera en manifestrad per fil med externt id, ursprunglig sökväg, filnamn,
MIME-typ, storlek, checksumma och vilken lektion eller fråga som refererar till
filen. Ladda sedan upp filerna via Administration -> Odoo Migration och använd
den resulterande `r2://`-referensen i JSON-importen.

### Styrande dokument

Exportera inte gamla dokumentnummer som enda sanning. Registrera i stället
dokumentets titel, dokumentnummer om det är aktuellt, version,
publiceringsdatum, URL/referens, senast kontrollerad, ansvarig och anteckningar.
Kvalitetsansvarig ska kontrollera uppgifterna mot aktuella källor före
publicering.

## Kontroll före import

1. Kör `node --import tsx scripts/import-odoo-course.mjs export.json` utan `--apply`.
2. Kontrollera att kapitel, lektioner, frågor, svar, quiz och provantal stämmer.
3. Kontrollera migrationsrapportens saknade bilder, videor, varningar och fel.
4. Ladda upp saknade assets och uppdatera `assetRef` innan ny torrkörning.
5. Importera som utkast. Samma payload ska vara idempotent.
6. Kör kvalitetstester och länka aktuella styrande dokument.
7. Publicera först när innehåll, prov, certifikat, ID06-kod och publiceringsgodkännande är markerade.

En export utan fråge-id, rätt-svar-data, provkonfiguration eller assetmanifest
ska betraktas som ofullständig och får inte publiceras som ID06-utbildning.
