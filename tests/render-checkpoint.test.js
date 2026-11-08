import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanRenderCheckpoint,saveRenderCheckpoint,readRenderCheckpoint} from '../src/video/renderCheckpoint.js';
import {resumeRenderJob,renderVideo} from '../src/video/exportClient.js';
const record=()=>({phase:'submitted',duration:2,job:{jobId:'a'.repeat(32),token:'capability-token-123456',baseUrl:'https://worker.test',expiresAt:Date.now()/1000+3600}});
const result={videoCodec:'h264',audioCodec:'aac',width:1080,height:1920,duration:2};
test('tab checkpoint round trips only scoped capability fields, never API keys/project media',()=>{
 let raw;const storage={setItem(_k,v){raw=v;},getItem(){return raw;}};
 const input={...record(),apiKey:'discard',project:'discard'};saveRenderCheckpoint(storage,input);assert.deepEqual(readRenderCheckpoint(storage),recordWithExpiry(input));assert.doesNotMatch(raw,/apiKey|project|discard/);
 assert.throws(()=>cleanRenderCheckpoint({...input,job:{...input.job,baseUrl:'javascript:alert(1)'}}));
 assert.throws(()=>cleanRenderCheckpoint({...input,job:{...input.job,baseUrl:'https://secret@worker.test'}}));
});
function recordWithExpiry(r){return {phase:r.phase,duration:r.duration,job:{...r.job}};}
test('resuming rendering and completed tasks is GET/HEAD only, with real output validation',async()=>{
 const calls=[];let count=0;
 const output=await resumeRenderJob(record(),{pollMs:1,fetchImpl:async(url,o)=>{calls.push(o.method||'GET');if(o.method==='HEAD')return new Response(null,{headers:{'content-type':'video/mp4','content-length':'123'}});return Response.json(++count===1?{state:'rendering',progress:50}:{state:'complete',result});}});
 assert.ok(output.download.includes('download=1'));assert.deepEqual(calls,['GET','GET','HEAD']);
 await assert.rejects(resumeRenderJob(record(),{fetchImpl:async()=>Response.json({state:'complete',result:{...result,duration:1}})}),/验证失败/);
});
test('expired, interrupted uploads and restarted services never silently submit new rendering',async()=>{
 await assert.rejects(resumeRenderJob({...record(),job:{...record().job,expiresAt:1}}),/过期/);
 await assert.rejects(resumeRenderJob(record(),{fetchImpl:async()=>Response.json({state:'uploading'})}),/不会自动启动/);
 await assert.rejects(resumeRenderJob(record(),{fetchImpl:async()=>Response.json({error:'任务凭证过期'},{status:401})}),e=>e.terminalJob===true);
 await assert.rejects(resumeRenderJob(record(),{fetchImpl:async()=>{throw new TypeError('offline');}}),/入口保留/);
});
test('a started render survives ambiguous network failure and produces a resumable checkpoint without DELETE/retry',async()=>{
 const saved=[],calls=[];const timeline={frames:[{}],audios:[{blob:new Blob(['audio'])}],manifest:{},sourceDuration:2};
 await assert.rejects(renderVideo(timeline,async()=>new Blob(['png']),{preserveStartedJob:true,onCheckpoint:c=>saved.push(c),readRetryMs:0,fetchImpl:async(url,o={})=>{calls.push(o.method||'GET');if(url==='/api/video-jobs')return Response.json(record().job);if(o.method==='PUT'||o.method==='POST')return Response.json({ok:true});throw new TypeError('offline');}}),e=>e.recoverableJob?.phase==='submitted');
 assert.deepEqual(saved.map(s=>s.phase),['uploading','submitted']);assert.equal(calls.filter(c=>c==='POST').length,2);assert.equal(calls.includes('DELETE'),false);
});
test('leaving during final download verification preserves the completed task checkpoint',async()=>{
 const c=new AbortController(),calls=[],saved=[];
 await assert.rejects(renderVideo({frames:[{}],audios:[{blob:new Blob(['audio'])}],manifest:{},sourceDuration:2},async()=>new Blob(['png']),{signal:c.signal,preserveStartedJob:true,onCheckpoint:r=>saved.push(r),fetchImpl:async(url,o={})=>{calls.push(o.method||'GET');if(url==='/api/video-jobs')return Response.json(record().job);if(o.method==='PUT'||o.method==='POST')return Response.json({ok:true});if(o.method==='HEAD'){c.abort(new DOMException('Page left','PageExit'));throw c.signal.reason;}return Response.json({state:'complete',result});}}),e=>e.recoverableJob?.phase==='download');
 assert.equal(saved.at(-1).phase,'download');assert.equal(calls.includes('DELETE'),false);
});
