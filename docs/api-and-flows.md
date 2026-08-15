# API och kärnflöden

Publika kursdata exponeras via `GET /api/courses/:slug`, men svaret innehåller aldrig kursmaterial. En deltagare måste vara inloggad och äga ett enrollment för `GET /api/enrollments/:id`, `POST /api/progress` och kursplayern `/utbildning/:enrollmentId`.

Orderflödet är `POST /api/orders` -> Stripe Checkout/Payment Intent -> `POST /api/stripe/webhook`. Webhooken kontrollerar signatur, är idempotent och skapar först därefter privata enrollments eller företagslicenser.

Slutprov använder `POST /api/exams/attempts` för att starta ett försök och `PATCH /api/exams/attempts` för att lämna in det. Frågor och svarsalternativ snapshotas på försöket. `exam_configs` styr antal frågor, godkäntgräns, tidsgräns, maxförsök, cooldown, randomisering och valfria ämneskvoter i `question_selection_json`, exempelvis `[{"topic":"Riskbedömning","count":5}]`. Servern begränsar dessutom frågebanken till aktuell kursversions kapitel; endast frågor utan kapitelkoppling är kursgemensamma. Prov avvisas om en kvot inte kan uppfyllas eller kvotsumman inte motsvarar frågeantalet. Admin ändrar regler via `GET/PATCH /api/admin/exams/:versionId`.

När en kursversion skapas kan `governingDocumentIds` ange de styrande dokument som låg till grund för versionen. API:t validerar dokumenten och sparar kopplingarna separat, så att historiska versioner behåller sitt regelverksunderlag.

Certifikat verifieras publikt via `GET /api/certificates/verify/:code` och `/verify/:code`. Personuppgifter och personnummer returneras aldrig i verifieringssidan.

Administrativa ID06-statusändringar sker via `PATCH /api/admin/id06/:id`, med rollkontroll och auditlogg. Odoo-importen tar normaliserad JSON via `POST /api/import/odoo` och sparar idempotent migrationsrapport i databasen.

GDPR exporteras via `GET /api/privacy/export`. Exporten innehåller konto/profil, enrollments, progress, quiz- och provförsök, certifikat, order/orderrader/betalningar, företagsmedlemskap, licenser, identitetsverifieringar, samtycken, notifieringar och relevanta revisionsloggar. Krypterat personnummer skickas aldrig; vid en behörig egen export dekrypteras det tillfälligt server-side. `POST /api/privacy/anonymize` anonymiserar kontot men lämnar historiska enrollments, prov, certifikat och revisionsspår kvar. `POST /api/reminders/expiring` köar påminnelser för behörig certification-admin; den kan köras av en schemalagd worker.

Personnummer uppdateras endast via det behörighetsstyrda admin-API:t `PATCH /api/admin/participants/:id/identity`. Värdet krypteras med AES-GCM via `PII_ENCRYPTION_KEY`; listor och auditloggar innehåller högst de fyra sista siffrorna.

Super Admin kan exportera eller anonymisera en specifik deltagare via `GET/POST /api/admin/participants/:id/privacy`. Exporten dekrypterar personnummer endast för den behöriga server-side operationen, medan anonymisering tar bort kontots personuppgifter och bevarar historiska enrollments, prov, certifikat och auditspår.

Kursadministration finns via `/admin/kurser` och de skyddade API:erna `POST /api/admin/courses`, `POST /api/admin/courses/:id/versions` och `POST /api/admin/courses/:id/publish`. Kurser och versioner skapas alltid som utkast; publicering är en separat server-side operation som kräver innehåll. För ID06-kurser krävs dessutom komplett kvalitetschecklist med publiceringsgodkännande och minst ett styrande dokument länkat till den aktuella kursversionen. Publicerade versioners innehåll ändras aldrig och fungerar som immutable historik för befintliga enrollments. Quiz-frågor kopplas genom `quiz_questions`, och `POST /api/quizzes/:id/submit` verifierar enrollment-ägarskap innan resultat sparas. Generic progress kan inte markera quiz- eller provlektioner som klara.

Certifikatutfärdandet är idempotent och körs automatiskt efter godkänt slutprov när kursens identitetskrav redan är uppfyllda. För kurser som kräver identitet körs samma server-side-operation igen när en admin godkänner verifieringen. `POST /api/admin/certificates/issue` finns kvar som en behörighetsstyrd återkörning, men kan inte kringgå obligatoriska moment, prov eller ID06-krav.

Företagsadministratörer kan exportera kompetensmatrisen via `GET /api/company/report`. E-postmallar administreras via `/api/admin/email-templates`; queued notifications skickas via `/api/admin/notifications/dispatch` när en riktig mailadapter är konfigurerad. Administrativa massutskick köas via `POST /api/admin/notifications/broadcast`, kan riktas till alla aktiva deltagare eller ett företag, begränsas till 1 000 mottagare per utskick och auditloggas.

Behörig Certification Admin kan exportera elevdokumentation via `GET /api/admin/enrollments/export` som CSV. `?format=json` ger samma export med provsnapshotar för revisionskontroll. Exporten innehåller aldrig hela personnumret, endast maskerade sista fyra siffrorna, och själva exporthändelsen auditloggas.

Företagskonto skapas via `POST /api/company`. Den inloggade skaparen blir företagets adminmedlem och kan därefter köpa företagsplatser, tilldela dem och exportera kompetensmatrisen. Multi-course checkout via `POST /api/orders/cart` stödjer både privata order och företagsorder med faktura.

Företagsplatser tilldelas via `POST /api/company/licenses/assign`. Enstaka tilldelning och CSV-import kontrollerar alltid företagets adminmedlemskap, skapar ett separat enrollment med kursens giltighetstid och köar en `course_assigned`-notifiering till deltagaren. CSV-importen accepterar en e-postadress per rad och rapporterar både tilldelade och misslyckade rader.

Coming-soon-intresse sparas via `POST /api/course-interest` med unik constraint per kurs och e-postadress. Supabase seed och migration dokumenteras i `supabase/README.md`.

`KP_ADMIN_EMAILS` är en komma-separerad allowlist för Super Admin i utvecklings- och Sites-miljö. Produktionssajten är konfigurerad med Site-ägaren `oscar@wpesweden.se`; övriga ChatGPT-användare skapas som deltagare. Företags- och övriga roller ska tilldelas via administrativ databas-/adminfunktion.
