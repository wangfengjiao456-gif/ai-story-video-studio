// Tab-scoped job capabilities, never API keys; deliberately excluded from project JSON.
export const RENDER_CHECKPOINT_KEY = 'story-studio-render-v42';
export function cleanRenderCheckpoint(value) {
  const job=value?.job;
  if(!job || !/^[a-f0-9]{32}$/.test(job.jobId) || !/^[A-Za-z0-9_-]{16,200}$/.test(job.token) || !Number.isFinite(job.expiresAt) || !Number.isFinite(value.duration) || value.duration<=0 || value.duration>610 || !['uploading','submitted','download'].includes(value.phase)) throw Error('渲染恢复记录无效；原项目未修改。');
  const url=new URL(job.baseUrl);
  if(url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname) || (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw Error('渲染恢复地址无效。');
  return {phase:value.phase,duration:value.duration,job:{jobId:job.jobId,token:job.token,baseUrl:url.origin,expiresAt:job.expiresAt}};
}
export function saveRenderCheckpoint(storage, value) {
  storage.setItem(RENDER_CHECKPOINT_KEY,JSON.stringify(cleanRenderCheckpoint(value)));
}
export function readRenderCheckpoint(storage) {
  const raw=storage.getItem(RENDER_CHECKPOINT_KEY);
  return raw===null?null:cleanRenderCheckpoint(JSON.parse(raw));
}
export function clearRenderCheckpoint(storage) {storage.removeItem(RENDER_CHECKPOINT_KEY);}
