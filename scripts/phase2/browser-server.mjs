import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const id='32000000-0000-0000-0000-000000000002';
const user={id,aud:'authenticated',role:'authenticated',email:'ocr-browser@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
let confirmations=[]; let failedOnce=false;
const stub=createServer(async(req,res)=>{
  if(process.env.PHASE2_BROWSER_DEBUG==='1') console.error('[phase2-stub]',req.method,req.url,req.headers.authorization?'authorized':'anonymous');
  const url=new URL(req.url,'http://127.0.0.1:4320'); let result;
  if(url.pathname==='/auth/v1/user') result=user;
  else if(url.pathname==='/rest/v1/profiles') {
    const profile={id,full_name:'Synthetic learner',role:'student',is_active:true,must_change_password:false};
    result=req.headers.accept?.includes('object')?profile:[profile];
  } else if(url.pathname==='/rest/v1/rpc/upsert_personal_words_bulk_v1') {
    let body=''; for await(const chunk of req) body+=chunk; const parsed=JSON.parse(body); confirmations.push(parsed);
    if(!failedOnce && process.env.PHASE2_BROWSER_FAIL_ONCE==='1') {failedOnce=true;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'Synthetic retry'}));return;}
    result=parsed.p_words.map((word,index)=>({personal_word_id:crypto.randomUUID(),source_id:crypto.randomUUID(),term:word.term,ocr_item_index:index}));
  } else if(url.pathname==='/__test/confirmations') result=confirmations;
  else if(url.pathname==='/__test/reset') {confirmations=[];failedOnce=false;result={ok:true};}
  else if(url.pathname.startsWith('/rest/v1/')) result=[];
  else {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
});
await new Promise(resolve=>stub.listen(4320,'127.0.0.1',resolve));
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','4321','-H','127.0.0.1'],{
  stdio:'inherit',windowsHide:true,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:4320',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'synthetic-local-test-key',NEXT_PUBLIC_PERSONAL_WORD_OCR_ENABLED:'true',NEXT_TELEMETRY_DISABLED:'1'}
});
const close=()=>{child.kill();stub.close();};process.on('SIGINT',close);process.on('SIGTERM',close);
child.on('exit',code=>{stub.close();process.exitCode=code??1;});
