import pg from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
const {Client}=pg;
const url=process.env.PHASE2_LOCAL_DATABASE_URL??'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const teacher='33000000-0000-0000-0000-000000000001',student='33000000-0000-0000-0000-000000000002';
const uuids={replay:'43000000-0000-0000-0000-000000000001',wordA:'43000000-0000-0000-0000-000000000002',wordB:'43000000-0000-0000-0000-000000000003',quotaA:'43000000-0000-0000-0000-000000000004',quotaB:'43000000-0000-0000-0000-000000000005'};
const admin=new Client({connectionString:url}); const left=new Client({connectionString:url}); const right=new Client({connectionString:url});
const cleanup=async()=>{
  await admin.query('delete from public.personal_word_sources where personal_word_id in (select id from public.personal_words where student_id=$1)',[student]);
  await admin.query('delete from public.personal_words where student_id=$1',[student]);
  await admin.query('delete from public.personal_word_ocr_imports where student_id=$1',[student]);
  await admin.query('delete from public.students where id=$1',[student]);await admin.query('delete from public.teachers where id=$1',[teacher]);
  await admin.query('delete from public.profiles where id=any($1::uuid[])',[[teacher,student]]);await admin.query('delete from auth.users where id=any($1::uuid[])',[[teacher,student]]);
};
async function invoke(client,id,words){
  await client.query('begin');
  try{await client.query('set local role authenticated');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[student]);
    const result=await client.query('select * from public.upsert_personal_words_bulk_v1($1,$2::jsonb)',[id,JSON.stringify(words)]);await client.query('commit');return result.rows;
  }catch(error){await client.query('rollback');throw error;}
}
const checks=[]; const check=(condition,label)=>{if(!condition)throw Error(label);checks.push(label);};
try{
  await Promise.all([admin.connect(),left.connect(),right.connect()]);await cleanup();
  await admin.query(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated','ocr-concurrency-teacher@example.invalid','not-used',now(),'{}','{}',now(),now()),
    ('00000000-0000-0000-0000-000000000000',$2,'authenticated','authenticated','ocr-concurrency-student@example.invalid','not-used',now(),'{}','{}',now(),now())`,[teacher,student]);
  await admin.query(`insert into public.profiles(id,username,full_name,role,is_active,must_change_password) values
    ($1,'ocr_concurrency_teacher','Synthetic teacher','teacher',true,false),($2,'ocr_concurrency_student','Synthetic student','student',true,false)`,[teacher,student]);
  await admin.query('insert into public.teachers(id) values($1)',[teacher]);await admin.query('insert into public.students(id,teacher_id) values($1,$2)',[student,teacher]);
  const same=await Promise.all([invoke(left,uuids.replay,[{term:'Read'}]),invoke(right,uuids.replay,[{term:'Read'}])]);
  check(same[0][0].personal_word_id===same[1][0].personal_word_id&&same[0][0].source_id===same[1][0].source_id,'same UUID/payload maps identically');
  const words=await Promise.all([invoke(left,uuids.wordA,[{term:'Write'}]),invoke(right,uuids.wordB,[{term:' write '}])]);
  check(words[0][0].personal_word_id===words[1][0].personal_word_id,'normalized term race creates one word');
  const sourceCount=await admin.query("select count(*)::integer n from public.personal_word_sources s join public.personal_words w on w.id=s.personal_word_id where w.student_id=$1 and w.normalized_term='write'",[student]);
  check(sourceCount.rows[0].n===2,'distinct imports retain two source rows');
  await admin.query('delete from public.personal_word_sources where personal_word_id in(select id from public.personal_words where student_id=$1)',[student]);
  await admin.query('delete from public.personal_words where student_id=$1',[student]);await admin.query('delete from public.personal_word_ocr_imports where student_id=$1',[student]);
  await admin.query("insert into public.personal_word_ocr_imports(id,student_id,payload_hash,confirmed_count,confirmed_at) select gen_random_uuid(),$1,decode(repeat('00',32),'hex'),1,now() from generate_series(1,19)",[student]);
  const quota=await Promise.allSettled([invoke(left,uuids.quotaA,[{term:'Alpha'}]),invoke(right,uuids.quotaB,[{term:'Beta'}])]);
  check(quota.filter(result=>result.status==='fulfilled').length===1&&quota.filter(result=>result.status==='rejected').length===1,'hourly boundary admits exactly one concurrent import');
  const quotaCount=await admin.query('select count(*)::integer n from public.personal_word_ocr_imports where student_id=$1',[student]);check(quotaCount.rows[0].n===20,'failed quota transaction leaves no reservation');
  const evidence={status:'PASS',sessions:2,assertions:checks};mkdirSync('p1-artifacts/replay',{recursive:true});writeFileSync('p1-artifacts/replay/ocr-concurrency.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}finally{if(admin.readyForQuery)await cleanup().catch(()=>{});await Promise.allSettled([admin.end(),left.end(),right.end()]);}
