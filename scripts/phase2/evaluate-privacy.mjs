import { readFileSync,existsSync,writeFileSync } from 'node:fs';
const fixtures=JSON.parse(readFileSync('docs/personalized-english/phase2/privacy-holdout.v1.json','utf8'));
if(fixtures.sensitive.length!==150||fixtures.clean.length!==150||new Set([...fixtures.sensitive,...fixtures.clean].map(item=>item.id)).size!==300)throw Error('Holdout allocation mismatch');
if(fixtures.sensitive.filter(item=>item.kind==='institution-edge').length<30)throw Error('30 institution lines required');
const edge=fixtures.clean.filter(item=>item.kind==='clean-edge'||item.kind==='clean-cropped');
if(edge.length<30||edge.filter(item=>item.image.validNonblankLines<6).length<15)throw Error('Clean edge/cropped allocation mismatch');
const observedPath=process.argv[2];let report={status:'PENDING_EXECUTION',fixtureCount:300,thresholds:{sensitiveBlocked:148,wilsonLower95:0.95,falseSuppressionMax:0.15,teachingRecallMin:0.75,cleanPersonSuppressionMax:0.03},metrics:null};
if(observedPath&&existsSync(observedPath)){
  const observations=JSON.parse(readFileSync(observedPath,'utf8'));const byId=new Map(observations.map(item=>[item.id,item]));
  if(byId.size!==300||[...fixtures.sensitive,...fixtures.clean].some(item=>!byId.has(item.id)))throw Error('Complete 300-case observations required');
  const sensitiveBlocked=fixtures.sensitive.filter(item=>byId.get(item.id).disposition==='never_offer').length;
  const falseSuppressed=fixtures.clean.filter(item=>byId.get(item.id).disposition==='never_offer').length;
  const personSuppressed=fixtures.clean.filter(item=>String(byId.get(item.id).reason).startsWith('person_')).length;
  let expected=0,recalled=0;for(const item of fixtures.clean){for(const term of item.teachingTerms){expected++;if(byId.get(item.id).safeWords?.map(word=>word.toLowerCase()).includes(term))recalled++;}}
  const n=150,p=sensitiveBlocked/n,z=1.959963984540054;const wilson=(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n);
  const metrics={sensitiveBlocked,wilsonLower95:wilson,falseSuppression:falseSuppressed/150,teachingRecall:recalled/expected,cleanPersonSuppression:personSuppressed/150,
    positionalFalseSuppression:edge.filter(item=>byId.get(item.id).reason==='header_footer_institution').length/edge.length};
  const pass=sensitiveBlocked>=148&&wilson>=.95&&metrics.falseSuppression<=.15&&metrics.teachingRecall>=.75&&metrics.cleanPersonSuppression<=.03;
  report={...report,status:pass?'PASS_AWAITING_OWNER_REVIEW':'FAIL',metrics};
}
if(process.argv.includes('--write-status'))writeFileSync('docs/personalized-english/phase2/privacy-evaluation-status.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(report.status==='FAIL')process.exitCode=1;
