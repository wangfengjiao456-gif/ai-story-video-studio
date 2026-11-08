import { applyPlan } from '../creation/planning.js';
import { uid } from '../model.js';
import { cleanContent, cleanAssistant, TEMPLATES } from './schema.js';
export * from './schema.js';
export function adoptContent(project, content, adoptedSignature) {
  const c=cleanContent(content),english=c.pairs.map(p=>p.english).join('\n'),chinese=c.pairs.map(p=>p.chinese).join('\n');
  const incremental=project.assistant?.adopted===true;
  const sameCast=incremental && JSON.stringify(project.creation?.characters)===JSON.stringify(c.plan.characters) && project.style===c.plan.style;
  const scenes=c.pairs.map((pair,i)=>{
    const old=project.scenes[i];
    const reusable=sameCast && old?.english===pair.english && old.description===c.plan.beats[i].prompt;
    return {...(reusable?old:{id:uid(),duration:5}),...pair,description:c.plan.beats[i].prompt};
  });
  const voiceRecords=incremental?project.voiceRecords?.filter(r=>r.key==='article'?r.text.trim()===english.trim():/^scene-\d+$/.test(r.key)&&c.pairs[Number(r.key.slice(6))]?.english.trim()===r.text.trim()):undefined;
  const p=applyPlan({...project,english,chinese,scenes,character:sameCast?project.character:{name:'',appearance:'',clothing:''},cover:sameCast&&project.cover?.prompt===c.plan.coverPrompt?project.cover:undefined,creationDraft:undefined,videoTiming:incremental&&english===project.english?project.videoTiming:undefined,voiceRecords},c.plan,'ai');
  return {...p,ratio:'9:16',assistant:cleanAssistant({request:'',template:TEMPLATES[0],...project.assistant,content:c,adopted:true,adoptedSignature})};
}
