// Paid providers are mocks; the actual assistant API handler and browser persistence run locally.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {chromium} from 'playwright';
import {createAssistantHandler} from '../api/creative-assistant.js';
import {localPlan} from '../src/creation/planning.js';
const base=process.env.STUDIO_URL||'http://127.0.0.1:6173';
const original=JSON.parse(readFileSync('work/mp4-regression/sample-project.json','utf8'));
const target={...original,english:'Small steps build a better future.\n'+original.scenes.slice(1).map(s=>s.english).join('\n'),chinese:'小步前进，创造更好的未来。\n'+original.scenes.slice(1).map(s=>s.chinese).join('\n'),scenes:original.scenes.map((s,i)=>i?{...s}:{...s,english:'Small steps build a better future.',chinese:'小步前进，创造更好的未来。'})};
const content={pairs:target.scenes.map(({english,chinese})=>({english,chinese})),plan:localPlan(target)};
const topics=Array.from({length:10},(_,i)=>({title:`每天前进一步 ${i+1}`,englishTitle:`One Step ${i+1}`,direction:'成长与自律',reason:'短句适合跟读',hook:'你不需要一下子改变全部。'}));
let calls=0,time=0;
const handler=createAssistantHandler({getKey:()=> 'mock-only',now:()=>time+=11000,createClient:()=>({responses:{create:async input=>{calls++;return {status:'completed',output_text:JSON.stringify(input.text.format.schema.properties.topics?{topics}:content)};}}})});
mkdirSync('work/v41-regression',{recursive:true});rmSync('work/v41-regression/report.json',{force:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:820,height:1180},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(p=>{if(!localStorage.getItem('story-studio-v1'))localStorage.setItem('story-studio-v1',JSON.stringify(p));},original);
 await page.route('**/api/creative-assistant',async route=>{let status=200,body;const headers={};await handler({method:route.request().method(),headers:{host:new URL(base).host,origin:base,'content-type':'application/json'},body:route.request().postDataJSON()},{setHeader(k,v){headers[k]=v;},status(n){status=n;return this;},json(b){body=b;return this;}});await route.fulfill({status,headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});});
 await page.goto(base);
 await page.getByRole('button',{name:/AI 创作助手/}).click();
 await page.getByLabel('告诉助手你想做什么').fill('帮我推荐10个成长类话题，然后制作一篇英语跟读文章。');
 await page.getByRole('button',{name:'生成话题',exact:true}).click();assert.equal(calls,0);
 await page.getByRole('button',{name:'确认一次付费创作',exact:true}).click();
 await page.getByRole('heading',{name:'10 个候选话题'}).waitFor();assert.equal(calls,1);
 await page.getByRole('button',{name:'选择此话题写文章',exact:true}).nth(1).click();
 assert.match(await page.getByLabel('告诉助手你想做什么').inputValue(),/每天前进一步 2/);
 assert.equal(calls,1); // Choosing a topic opens the single article-cost review directly.
 await page.getByRole('button',{name:'确认一次付费创作',exact:true}).click();
 await page.getByLabel('英文 10',{exact:true}).waitFor();assert.equal(calls,2);
 let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('story-studio-v1')));assert.equal(saved.english,original.english);assert.equal(saved.assistant.content.pairs.length,10);
 await page.evaluate(()=>{const key='story-studio-v1',p=JSON.parse(localStorage.getItem(key));delete p.assistant.content;localStorage.setItem(key,JSON.stringify(p));});
 await page.reload();await page.getByRole('button',{name:/AI 创作助手/}).click();await page.getByRole('button',{name:'恢复上次创作结果（免费）',exact:true}).click();await page.getByLabel('英文 10',{exact:true}).waitFor();assert.equal(calls,2);
 await page.getByLabel('中文 2',{exact:true}).fill('这是人工审核后的第二句。');
 await page.reload();await page.getByRole('button',{name:/AI 创作助手/}).click();assert.equal(await page.getByLabel('中文 2',{exact:true}).inputValue(),'这是人工审核后的第二句。');assert.equal(calls,2);
 await page.getByRole('button',{name:'制作视频',exact:true}).click();const backupPromise=page.waitForEvent('download');await page.getByRole('button',{name:'备份原项目并确认采用',exact:true}).click();const backup=await backupPromise;assert.ok(backup.suggestedFilename().endsWith('.json'));await backup.saveAs('work/v41-regression/original-backup.json');
 await page.getByText('内容已采用并保存。',{exact:false}).waitFor();
 saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('story-studio-v1')));assert.equal(saved.english,target.english);assert.equal(saved.scenes.length,10);assert.equal(saved.scenes[1].chinese,'这是人工审核后的第二句。');assert.ok(saved.scenes.every(s=>s.description));assert.equal(saved.cover.enabled,true);assert.equal(saved.cover.duration,3);assert.ok(saved.character.name);assert.equal(saved.videoTiming,undefined);assert.equal(calls,2);
 const oldBackup=JSON.parse(readFileSync('work/v41-regression/original-backup.json','utf8'));assert.equal(oldBackup.english,original.english);assert.ok(oldBackup.scenes[0].imageRef);
 await page.getByRole('button',{name:'审核并继续未完成的生成',exact:true}).waitFor();assert.equal(calls,2);
 await page.evaluate(image=>{const key='story-studio-v1',p=JSON.parse(localStorage.getItem(key));p.scenes[0].imageRef=image;localStorage.setItem(key,JSON.stringify(p));},original.scenes[0].imageRef);
 await page.reload();await page.getByRole('button',{name:/AI 创作助手/}).click();await page.getByRole('button',{name:'制作视频',exact:true}).click();await page.getByRole('button',{name:'审核并继续未完成的生成',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'备份原项目并确认采用',exact:true}).count(),0);assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('story-studio-v1')).scenes[0].imageRef));

 await page.reload();await page.getByRole('button',{name:/AI 创作助手/}).click();await page.getByRole('button',{name:'AI 智能制作',exact:true}).waitFor();assert.equal(calls,2);
 for(const width of [820,390]){await page.setViewportSize({width,height:1180});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.screenshot({path:'work/v41-regression/assistant.png',fullPage:true});assert.deepEqual(errors,[]);
 writeFileSync('work/v41-regression/report.json',JSON.stringify({status:'PASS',provider:'Mock OpenAI; actual handler and Chromium touch/persistence/download',requests:calls,topics:10,scenes:10,articleUnchangedUntilAdoption:true,backupDownloaded:true,refreshAndContinue:true,freeDraftRecovery:true,paidMediaCalls:0,realIPadSafari:false},null,2));console.log('V4.1 assistant E2E PASS: work/v41-regression/report.json');
}finally{await browser.close();}
