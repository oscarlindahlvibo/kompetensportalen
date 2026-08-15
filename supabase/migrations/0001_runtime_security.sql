-- The application uses a server-side Postgres connection. No learner data is
-- exposed through the Supabase REST API by default.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users','profiles','companies','company_members','courses','course_versions',
    'chapters','lessons','products','orders','order_items','payments',
    'course_licenses','enrollments','lesson_progress','quizzes','questions',
    'answer_options','quiz_questions','quiz_attempts','exam_configs','exam_attempts',
    'exam_answers','identity_verifications','certificates','competencies',
    'id06_registrations','discount_codes','price_rules','governing_documents',
    'course_version_governing_documents','quality_reviews','notifications',
    'email_templates','course_interest','contact_messages','consents','odoo_imports',
    'audit_logs','system_settings'
  ] loop
    execute format('alter table kompetensportalen.%I enable row level security', table_name);
  end loop;
end $$;

insert into storage.buckets (id, name, public)
values ('kompetensportalen-course-assets', 'kompetensportalen-course-assets', false)
on conflict (id) do update set public = excluded.public;

-- Files are served through the authenticated application route, which checks
-- enrollment ownership before reading from the private bucket.
create policy "kompetensportalen server manages course assets"
on storage.objects for all
to service_role
using (bucket_id = 'kompetensportalen-course-assets')
with check (bucket_id = 'kompetensportalen-course-assets');
