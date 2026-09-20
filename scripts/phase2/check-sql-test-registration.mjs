import { readFileSync,readdirSync } from 'node:fs';
const workflow=readFileSync('.github/workflows/p1-database-audit.yml','utf8').replaceAll('\\','/');
const manifest=JSON.parse(readFileSync('scripts/phase2/sql-test-exemptions.json','utf8'));
const exempt=new Map(manifest.exemptions.map(item=>[item.path,item.reason]));
if(exempt.size!==manifest.exemptions.length||[...exempt].some(([path,reason])=>!path.startsWith('supabase/tests/')||!reason))throw Error('Invalid SQL exemption manifest');
const tests=readdirSync('supabase/tests').filter(name=>name.endsWith('.sql')).map(name=>'supabase/tests/'+name).sort();
for(const path of tests){
  const registered=workflow.includes(path);
  if(registered===exempt.has(path))throw Error(registered?'SQL test is both registered and exempt: '+path:'SQL test is neither registered nor exempt: '+path);
}
for(const path of exempt.keys())if(!tests.includes(path))throw Error('Stale SQL exemption: '+path);
console.log(`Registered ${tests.length-exempt.size} SQL tests; ${exempt.size} documented Games exemption.`);
