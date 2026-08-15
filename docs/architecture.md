# Kompetensportalen.se arkitektur

Kompetensportalen är byggd som en fristående LMS/e-handelsplattform. Den är inte kopplad till Odoo och datamodellen utgår från utbildningsdomänen: kurs, kursversion, enrollment, provförsök, certifikat, kompetens, ID06-registrering, order och företagslicenser.

## Principer

- Progress ligger alltid på `enrollments`, aldrig direkt på `user -> course`.
- Kursinnehåll versioneras i `course_versions` med snapshots så historisk elevdokumentation kan rekonstrueras.
- Orderrader och företagslicenser binder den publicerade `course_version` som gällde vid köp; äldre rader utan bindning använder endast en bakåtkompatibel fallback vid fulfillment.
- Känsliga operationer ska auktoriseras server-side och audit-loggas.
- Personnummer lagras krypterat där det behövs och får inte förekomma i URL:er eller klientloggar.
- Externa integrationer ligger bakom adapters: Stripe, BankID, ID06 och e-post.

## Lagring

Supabase Postgres används för strukturerad relationsdata. Kursbilder, videor, PDF:er och andra uppladdningar lagras i den privata Supabase Storage-bucketen `course-assets`. Filer serveras endast efter behörighetskontroll.

## Roller

Första schemat innehåller rollerna `super_admin`, `course_admin`, `certification_admin`, `customer_support`, `company_admin` och `participant`. Varje administrativ mutation ska validera rollen server-side innan data ändras.
`customer_support` får en begränsad admin-ingång för order, deltagare och strikt loggad impersonation; kursinnehåll, ID06 och identitetsdata kräver särskilda behörigheter.

## Externa integrationer

Stripe ska bekräfta betalningar via webhook innan enrollment eller licenser aktiveras. BankID är förberett som modulär identitetsverifiering, men första produktionsläget kan använda manuell BankID-dokumentreferens. ID06 är implementerat som statusmaskin och adaptergräns, utan hårdkodat eller påhittat ID06-API.
