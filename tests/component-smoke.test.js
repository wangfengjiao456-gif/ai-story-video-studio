// Server-render smoke tests catch runtime JSX errors; these do not replace Safari visual QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {initialProject,splitArticle} from '../src/model.js';
import {templateDefaults} from '../src/presentation/settings.js';
const root=fileURLToPath(new URL('..',import.meta.url));mkdirSync(join(root,'work'),{recursive:true});const dir=mkdtempSync(join(root,'work','component-smoke-'));
await build({entryPoints:{App:join(root,'src/App.jsx'),StoryFrame:join(root,'src/components/StoryFrame.jsx'),TemplateSettings:join(root,'src/components/TemplateSettings.jsx'),SceneImageSettings:join(root,'src/components/SceneImageSettings.jsx')},outdir:dir,outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm',external:['react','lucide-react'],logLevel:'silent'});
const Frame=(await import(pathToFileURL(join(dir,'StoryFrame.mjs')))).default;
const Settings=(await import(pathToFileURL(join(dir,'TemplateSettings.mjs')))).default;
const Scene=(await import(pathToFileURL(join(dir,'SceneImageSettings.mjs')))).default;
test('三种画幅和两种模板的实际 React 组件可渲染',()=>{
 for(const ratio of ['9:16','16:9','4:5'])for(const videoTemplate of ['picturebook','immersive']){const p=initialProject();p.scenes=splitArticle(p.english,p.chinese);Object.assign(p,{ratio,videoTemplate,subtitleStyle:templateDefaults(videoTemplate)});const html=renderToStaticMarkup(React.createElement(Frame,{project:p,scene:p.scenes[0],index:0}));assert.match(html,/<canvas/);assert.match(html,/导出当前字幕页 PNG/);assert.ok(!html.includes('undefined'));}
});
test('设置面板与分镜图片操作可渲染，画幅/付费入口存在',()=>{
 const p=initialProject();p.scenes=splitArticle(p.english,p.chinese);const html=renderToStaticMarkup(React.createElement(Settings,{project:p,onChange(){}}));assert.match(html,/4:5/);assert.match(html,/文字描边/);const scene=renderToStaticMarkup(React.createElement(Scene,{project:p,scene:p.scenes[0],onChange(){},generation:{busy:null},onSetStandard(){}}));assert.match(scene,/AI 生成配图/);assert.match(scene,/官方价格/);
});
test('完整 App 启动没有模板/配图带来的渲染异常',async()=>{
 const original=globalThis.window;globalThis.window={localStorage:{getItem(){return null;}}};try{const App=(await import(pathToFileURL(join(dir,'App.mjs')))).default;const html=renderToStaticMarkup(React.createElement(App));assert.match(html,/STORY/);assert.match(html,/<canvas/);}finally{globalThis.window=original;}
});
test.after(()=>rmSync(dir,{recursive:true,force:true}));
