// Supplemental embedded PostgreSQL execution, NOT a Supabase/P-1 replay.
import { PGlite } from '@electric-sql/pglite';
import { pgtap } from '@electric-sql/pglite/pgtap';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
export async function createLocalDatabase(options={phase2:true}) {
  const db = new PGlite({ extensions: { pgtap } });
  await db.exec(`create schema auth; create schema private; create schema extensions; create schema storage;
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public, auth, private to anon, authenticated, service_role;
    create table auth.users(id uuid primary key, instance_id uuid, aud text, role text, email text, encrypted_password text,
      email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.profiles(id uuid primary key references auth.users(id), username text, full_name text, role text, is_active boolean, must_change_password boolean);
    create table public.teachers(id uuid primary key references public.profiles(id));
    create table public.students(id uuid primary key references public.profiles(id), teacher_id uuid references public.teachers(id));
    create table public.vocabulary_words(id uuid primary key);
    create table public.pronunciation_task_words(id uuid primary key);
    create table storage.buckets(id text primary key);
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;`);
  const sourceFiles = readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort();
  for (const name of ['is_active_profile', 'current_student_id', 'is_ready_profile', 'normalize_spelling']) {
    let sql;
    for (const file of sourceFiles) {
      const text = readFileSync('supabase/migrations/' + file, 'utf8');
      const match = text.match(new RegExp('create(?: or replace)? function private\\.' + name + '\\([^]*?\\$\\$;','i'));
      if (match) sql = match[0];
    }
    if (!sql) throw Error('Missing actual baseline helper: ' + name);
    await db.exec(sql);
  }
  await db.exec(readFileSync('supabase/migrations/20260911213841_personal_words_core.sql', 'utf8'));
  if(options.phase2)await db.exec(readFileSync('supabase/migrations/20260919025607_personal_word_ocr_imports.sql', 'utf8'));
  return db;
}
if (process.argv[1]?.endsWith('local-db.mjs')) {
  const db = await createLocalDatabase(); let assertions = 0;
  try {
    for (const file of ['personal_english_ocr.test.sql', 'personal_english_ocr_security.test.sql']) {
      const results = await db.exec(readFileSync('supabase/tests/' + file, 'utf8'));
      const tap = results.flatMap(result => result.rows.flatMap(row => Object.values(row))).filter(value => typeof value === 'string');
      for (const line of tap) {
        if (/^not ok|^# Looks like|^Bail out!/m.test(line)) throw Error(file + ': ' + line);
        if (/^ok \d+/m.test(line)) assertions++;
      }
      console.log(file + ': passed in supplemental PGlite harness');
    }
    const evidence = { status: 'PASS_SUPPLEMENTAL_ONLY', engine: 'PGlite 0.3.14', assertions,
      scope: 'Actual Phase 1 and Phase 2 migration source; actual four private helpers; minimal synthetic prerequisite schema. Not canonical replay, hosted verification, or concurrency evidence.' };
    writeFileSync('docs/personalized-english/phase2/local-db-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
  } finally { await db.close(); }
}
