import { readFileSync } from 'node:fs';
const path='supabase/migrations/20260919025607_personal_word_ocr_imports.sql';
const sql=readFileSync(path,'utf8');
const ordered=[
  'create table public.personal_word_ocr_imports',
  'create index personal_word_ocr_imports_student_created_idx',
  'alter table public.personal_word_ocr_imports enable row level security',
  'alter table public.personal_word_sources\n  add column ocr_import_id',
  'alter table public.personal_word_sources\n  add column ocr_item_index',
  'add constraint personal_word_sources_type_v2',
  'create unique index personal_word_sources_ocr_word_uidx',
  'create unique index personal_word_sources_ocr_item_uidx',
  'create function private.captured_text_has_high_confidence_pii_v1',
  'create function private.set_personal_word_example',
  'create function private.attach_personal_word_ocr_source_v1',
  'create function public.upsert_personal_words_bulk_v1',
];
let previous=-1;
for(const marker of ordered){const at=sql.indexOf(marker);if(at<=previous)throw Error('Phase 2 migration order mismatch at '+marker);previous=at;}
for(const exact of ['personal_word_ocr_imports_payload_hash_length_check','personal_word_ocr_imports_confirmed_count_check','personal_word_sources_ocr_word_uidx','personal_word_sources_ocr_item_uidx','set lock_timeout = \'5s\'','set statement_timeout = \'60s\'']) if(!sql.includes(exact))throw Error('Missing migration contract: '+exact);
if(/storage\.|upload_intents|bucket/i.test(sql))throw Error('Phase 2 migration must not modify Storage/upload objects');
console.log('Phase 2 migration order, exact indexes, timeouts and Storage exclusion verified.');
