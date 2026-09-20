import { readFileSync,writeFileSync } from 'node:fs';
import pg from 'pg';
import { createLocalDatabase } from './local-db.mjs';
const signatures=['public.upsert_personal_word_v1(text,text)','public.attach_personal_word_source_v1(uuid,text,uuid)','public.archive_personal_word_v1(uuid)'];
const tables=['public.personal_words','public.personal_word_sources'];const roles=['anon','authenticated','service_role'];
const live=process.env.PHASE2_LOCAL_DATABASE_URL;let database;
if(live){database=new pg.Client({connectionString:live});await database.connect();}else database=await createLocalDatabase({phase2:false});
const query=(text,params=[])=>database.query(text,params);
const snapshot={version:1,origin:'Actual Phase 1 migration replay; values are effective privileges and catalog security metadata.',tables:[],functions:[]};
for(const table of tables){
  const catalog=await query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",[table]);
  const policies=await query("select polname,polcmd,polpermissive,(select array_agg(r.rolname order by r.rolname) from unnest(polroles) x(oid) join pg_roles r on r.oid=x.oid) roles from pg_policy where polrelid=$1::regclass order by polname",[table]);
  const privileges={};for(const role of roles){privileges[role]={};for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']) privileges[role][privilege]=(await query('select has_table_privilege($1,$2,$3) allowed',[role,table,privilege])).rows[0].allowed;}
  snapshot.tables.push({table,...catalog.rows[0],policies:policies.rows,privileges});
}
for(const signature of signatures){
  const catalog=(await query("select p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner) owner from pg_proc p where p.oid=$1::regprocedure",[signature])).rows[0];
  const execute={};for(const role of roles)execute[role]=(await query('select has_function_privilege($1,$2,$3) allowed',[role,signature,'EXECUTE'])).rows[0].allowed;
  snapshot.functions.push({signature,...catalog,execute});
}
const path='docs/personalized-english/phase2/legacy-phase1-acl-snapshot.json';const serialized=JSON.stringify(snapshot,null,2)+'\n';
if(process.argv.includes('--write')){if(live)throw Error('Refusing to rewrite frozen snapshot from a mutable external database');writeFileSync(path,serialized);console.log('Wrote frozen replay-generated Phase 1 ACL snapshot.');}
else{const expected=readFileSync(path,'utf8');if(expected!==serialized)throw Error('Legacy Phase 1 ACL/security-definer snapshot drift');console.log('Legacy Phase 1 ACL/security-definer snapshot matches exactly.');}
await database.close?.();await database.end?.();
