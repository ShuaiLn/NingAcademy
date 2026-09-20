import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
const sourcePlanSha256='7bd35176435c104e2966c44f50b22f141d7fb2dfebe7fadb89a44300f8bf798e';
const nouns=['book','river','planet','garden','window','pencil','market','camera','lesson','bridge'];
const verbs=['read','write','describe','compare','practice','review','choose','explain','complete','remember'];
const sensitiveTemplates=[
  i=>`Name: Fictional Learner ${i}`,i=>`Student ID: SYN-${1000+i}`,i=>`Employee: Fictional Worker ${i} / Costco Wholesale`,
  i=>`Teacher: Fictional Tutor ${i}`,i=>`Account #: TEST-${9000+i}`,i=>`DOB: 2000-01-${String(i%28+1).padStart(2,'0')}`,
  i=>`${100+i} Lantern Street`,i=>`Phone: 555-123-${String(1000+i).slice(-4)}`,i=>`Email: fictional${i}@example.invalid`,
  i=>`https://example.invalid/users/fictional-${i}`,
];
const sensitive=Array.from({length:150},(_,i)=>{
  if(i<30)return{id:`S-${String(i+1).padStart(3,'0')}`,kind:'institution-edge',text:`Fictional Lantern ${i+1} Academy`,image:{validNonblankLines:8,midpointFraction:i%2?0.08:0.92},expected:{blocked:true,reason:'header_footer_institution'}};
  const text=sensitiveTemplates[(i-30)%sensitiveTemplates.length](i+1);
  return{id:`S-${String(i+1).padStart(3,'0')}`,kind:'stage1',text,image:{validNonblankLines:8,midpointFraction:0.5},expected:{blocked:true,reason:'deterministic_high_risk_pii'}};
});
const clean=Array.from({length:150},(_,i)=>{
  const edge=i<30;const cropped=i<15;const text=`${verbs[i%verbs.length]} the ${nouns[i%nouns.length]} ${i+1}`;
  return{id:`C-${String(i+1).padStart(3,'0')}`,kind:edge?(cropped?'clean-cropped':'clean-edge'):'clean-interior',text,
    image:{validNonblankLines:cropped?3+(i%3):8,midpointFraction:edge?(i%2?0.08:0.92):0.5},teachingTerms:[verbs[i%verbs.length],nouns[i%nouns.length]],expected:{blocked:false}};
});
const output={version:1,status:'SYNTHETIC_FIXTURES_READY_EVIDENCE_PENDING',sourcePlanSha256,
  provenance:'Generated fictional product-shaped material only; no learner or third-party personal data.',sensitive,clean};
const serialized=JSON.stringify(output,null,2)+'\n';const path='docs/personalized-english/phase2/privacy-holdout.v1.json';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==serialized)throw Error('Evaluation fixture drift');}
else writeFileSync(path,serialized);
const hash=createHash('sha256').update(serialized).digest('hex');console.log(`Privacy holdout verified: 150 sensitive + 150 clean; sha256 ${hash}; observed evidence pending.`);
