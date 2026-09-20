import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const route="/student/personal-english/import";
test.beforeEach(async({context})=>{
  const user={id:'32000000-0000-0000-0000-000000000002',aud:'authenticated',role:'authenticated'};
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({...user,sub:user.id,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})+'.synthetic';
  await context.addCookies([{name:'sb-127-auth-token',value:'base64-'+encode({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}),domain:'127.0.0.1',path:'/'}]);
  await context.addInitScript(() => {
    const calls: {api:string;url:string;body?:string|null}[]=[];
    Object.defineProperty(window,'__phase2NetworkCalls',{value:calls});
    const nativeFetch=window.fetch.bind(window); window.fetch=(input,init)=>{calls.push({api:'fetch',url:String(input instanceof Request?input.url:input),body:typeof init?.body==='string'?init.body:null});return nativeFetch(input,init);};
    const open=XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open=function(method:string,url:string|URL){calls.push({api:'xhr',url:String(url)});return open.call(this,method,url,true);};
    const beacon=navigator.sendBeacon?.bind(navigator); if(beacon) navigator.sendBeacon=(url,data)=>{calls.push({api:'beacon',url:String(url),body:typeof data==='string'?data:null});return beacon(url,data);};
    const NativeWebSocket=window.WebSocket; window.WebSocket=class extends NativeWebSocket {constructor(url:string|URL,protocols?:string|string[]){calls.push({api:'websocket',url:String(url)});super(url,protocols);}};
    const NativeEventSource=window.EventSource; window.EventSource=class extends NativeEventSource {constructor(url:string|URL,init?:EventSourceInit){calls.push({api:'eventsource',url:String(url)});super(url,init);}};
    const NativeWorker=window.Worker;let activeWorkers=0;
    window.Worker=class extends NativeWorker {private phase2Terminated=false;constructor(url:string|URL,options?:WorkerOptions){calls.push({api:'worker',url:String(url)});super(url,options);activeWorkers++;}
      terminate(){if(!this.phase2Terminated){this.phase2Terminated=true;activeWorkers--;}super.terminate();}};
    Object.defineProperty(window,'__phase2ActiveWorkers',{get:()=>activeWorkers});
  });
});
async function photo(page:Page,text:string[],mimeType:'image/png'|'image/webp'='image/png') {
  const bytes=await page.evaluate(async({lines,type})=>{
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=700;
    const c=canvas.getContext('2d')!;c.fillStyle='white';c.fillRect(0,0,1200,700);c.fillStyle='black';c.font='48px Arial';
    lines.forEach((line,i)=>c.fillText(line,50,90+i*90));
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),type));return [...new Uint8Array(await blob.arrayBuffer())];
  },{lines:text,type:mimeType});
  await page.getByLabel('选择图片').setInputFiles({name:`synthetic-private-filename.${mimeType==='image/png'?'png':'webp'}`,mimeType,buffer:Buffer.from(bytes)});
}
async function exifPhoto(page:Page,orientation:number) {
  const source=Buffer.from(await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=700;
    const c=canvas.getContext('2d')!;c.fillStyle='white';c.fillRect(0,0,1200,700);c.fillStyle='black';c.font='48px Arial';c.fillText('planet ocean library',50,90);
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/jpeg',.92));return [...new Uint8Array(await blob.arrayBuffer())];
  }));
  const app1=Buffer.alloc(36);app1.set([0xff,0xe1,0x00,0x22]);app1.write('Exif\0\0',4,'binary');
  app1.set([0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,0x01,0x00],10);
  app1.writeUInt16LE(0x0112,20);app1.writeUInt16LE(3,22);app1.writeUInt32LE(1,24);app1.writeUInt16LE(orientation,28);
  await page.getByLabel('选择图片').setInputFiles({name:'synthetic-private-exif.jpg',mimeType:'image/jpeg',buffer:Buffer.concat([source.subarray(0,2),app1,source.subarray(2)])});
}
async function mismatchedMimePhoto(page:Page) {
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=50;
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.getByLabel('选择图片').setInputFiles({name:'synthetic-private-mismatch.jpg',mimeType:'image/jpeg',buffer:Buffer.from(bytes)});
}
test('direct route: accessible, idle silence, real OCR/NER privacy, confirmed-only action and warm offline run',async({page,request,context})=>{
  const requests:{url:string;method:string;body:string|null;headers:Record<string,string>}[]=[];
  page.on('request',req=>requests.push({url:req.url(),method:req.method(),body:req.postData(),headers:req.headers()}));
  await request.get('http://127.0.0.1:4320/__test/reset');
  await page.goto(route);await expect(page.getByRole('heading',{name:'拍照导入生词'})).toBeVisible();
  await page.waitForTimeout(1000);
  expect(requests.filter(req=>req.url.includes('/local-ai-assets/'))).toHaveLength(0);
  expect(requests.some(req=>/speed-insights|vitals|sentry|analytics/i.test(req.url))).toBe(false);
  expect(await page.evaluate(()=>(window as unknown as {__phase2NetworkCalls:{url:string}[]}).__phase2NetworkCalls.some(call=>/speed-insights|vitals|sentry|analytics/i.test(call.url)))).toBe(false);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.evaluate(()=>{window.__phase2NetworkCalls.length=0;});
  await photo(page,['Employee: John Smith / Costco Wholesale','Read the book and write a sentence.']);
  requests.length=0;
  await page.getByRole('button',{name:'开始本地识别'}).click();
  await expect(page.getByRole('heading',{name:'确认要保存的生词'})).toBeVisible({timeout:150_000});
  await expect(page.locator('body')).not.toContainText('John Smith');
  await expect(page.locator('body')).not.toContainText('Costco Wholesale');
  expect(await page.getByLabel('生词',{exact:true}).count()).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.__phase2ActiveWorkers)).toBe(0);
  await page.getByLabel('释义（可选，最多 1000 字）').first().fill('阅读');
  expect(requests.every(req=>req.method==='GET'&&new URL(req.url).origin==='http://127.0.0.1:4321'&&/^\/(local-ai-assets|_next\/static)\//.test(new URL(req.url).pathname))).toBe(true);
  expect(JSON.stringify(requests)).not.toMatch(/John|Smith|Costco|synthetic-private|rawEvidence|tokenIndex|sanitizedText/);
  const instrumented=await page.evaluate(()=>window.__phase2NetworkCalls);
  expect(instrumented.some(call=>/speed-insights|vitals|sentry|analytics/i.test(call.url))).toBe(false);
  expect(JSON.stringify(instrumented)).not.toMatch(/John|Smith|Costco|synthetic-private|rawEvidence|tokenIndex|sanitizedText/);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  requests.length=0;
  await page.getByRole('button',{name:/确认并导入 \d+ 个生词/}).click();
  await expect(page.getByRole('status')).toContainText('已导入');
  const posts=requests.filter(req=>req.method==='POST');expect(posts).toHaveLength(1);
  expect(posts[0].body).not.toMatch(/John|Smith|Costco|synthetic-private|rawEvidence|tokenIndex|sanitizedText/);
  const recorded=await(await request.get('http://127.0.0.1:4320/__test/confirmations')).json();
  expect(recorded).toHaveLength(1);for(const word of recorded[0].p_words) expect(Object.keys(word).sort()).toEqual(['exampleSentence','meaning','term']);
  await photo(page,['planet ocean library']);
  await context.setOffline(true);
  await page.getByRole('button',{name:'开始本地识别'}).click();
  await expect(page.getByRole('heading',{name:'确认要保存的生词'})).toBeVisible({timeout:150_000});
  await expect(page.getByLabel('生词',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:/全部丢弃/}).click();
  await context.setOffline(false);
  await exifPhoto(page,6);
  await page.getByRole('button',{name:'开始本地识别'}).click();
  await expect(page.getByRole('heading',{name:'确认要保存的生词'})).toBeVisible({timeout:150_000});
  await page.getByRole('button',{name:/全部丢弃/}).click();
  await photo(page,['planet ocean library'],'image/webp');
  await page.getByRole('button',{name:'开始本地识别'}).click();
  await expect(page.getByRole('heading',{name:'确认要保存的生词'})).toBeVisible({timeout:150_000});
  await page.getByRole('button',{name:/全部丢弃/}).click();
});
test('client navigation, invalid input and pagehide remain silent',async({page})=>{
  await page.goto('/student/personal-english');
  const observed:string[]=[];page.on('request',req=>observed.push(req.url()));
  await page.getByRole('link',{name:'拍照导入生词'}).click();await expect(page.getByRole('heading',{name:'拍照导入生词'})).toBeVisible();
  await page.waitForTimeout(1000);expect(observed.some(url=>/speed-insights|vitals|analytics|local-ai-assets/.test(url))).toBe(false);
  observed.length=0;
  await page.getByLabel('选择图片').setInputFiles({name:'fake.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
  await page.getByRole('button',{name:'开始本地识别'}).click();await expect(page.locator('p[role="alert"]')).toBeVisible();
  expect(observed.every(url=>new URL(url).origin==='http://127.0.0.1:4321'&&new URL(url).pathname.startsWith('/_next/static/'))).toBe(true);
  expect(observed.join('\n')).not.toMatch(/fake\.png|not%20an%20image|not an image/);
  observed.length=0; await mismatchedMimePhoto(page);
  await page.getByRole('button',{name:'开始本地识别'}).click();await expect(page.locator('p[role="alert"]')).toBeVisible();
  expect(observed.some(url=>url.includes('/local-ai-assets/'))).toBe(false);
  expect(observed.join('\n')).not.toMatch(/synthetic-private-mismatch/);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(page.locator('p[role="alert"]')).toHaveCount(0);
});
test('mobile route has usable controls and no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:360,height:740});await page.goto(route);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  const controls=await page.locator('button,input,a').evaluateAll(elements=>elements.map(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height})).filter(control=>control.width>0&&control.height>0));
  expect(controls.every(control=>control.height>=44||control.width>=44)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});

test('asset failure is fatal and retry succeeds; cancellation discards state',async({page})=>{
  await page.goto(route);
  await page.getByRole('button',{name:'清除本地识别资源缓存'}).click();
  await expect(page.getByRole('status')).toContainText('已清除');
  await page.route('**/local-ai-assets/ner/neurobert-e3a6a29/onnx/model_quantized.onnx',route=>route.abort('failed'));
  await photo(page,['planet ocean library']);
  await page.getByRole('button',{name:'开始本地识别'}).click();
  await expect(page.locator('p[role="alert"]')).toBeVisible({timeout:150_000});
  await expect(page.getByRole('heading',{name:'确认要保存的生词'})).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.__phase2ActiveWorkers)).toBe(0);
  await page.unroute('**/local-ai-assets/ner/neurobert-e3a6a29/onnx/model_quantized.onnx');
  await photo(page,['planet ocean library']);
  await page.getByRole('button',{name:'开始本地识别'}).click();
  await expect(page.getByRole('heading',{name:'确认要保存的生词'})).toBeVisible({timeout:150_000});
  await page.getByRole('button',{name:/全部丢弃/}).click();

  await page.getByRole('button',{name:'清除本地识别资源缓存'}).click();
  await expect(page.getByRole('status')).toContainText('已清除');
  await photo(page,['planet ocean library']);
  await page.getByRole('button',{name:'开始本地识别'}).click();
  await page.getByRole('button',{name:'取消并清除'}).click();
  await expect(page.getByRole('heading',{name:'确认要保存的生词'})).toHaveCount(0);
  await expect(page.locator('p[role="alert"]')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.__phase2ActiveWorkers)).toBe(0);
});

declare global { interface Window { __phase2NetworkCalls: {api:string;url:string;body?:string|null}[]; __phase2ActiveWorkers:number } }
