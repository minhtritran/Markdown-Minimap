import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

// Deliberately measures JS construction/allocation only, not browser layout.
let nodes=0;
class Element {
 constructor(){nodes++;this.children=[];this.className='';this.value='';}
 classList={add:(...s)=>{this.className+=' '+s.join(' ');}};
 appendChild(e){this.children.push(e);return e;}
 set textContent(v){this.value=v;this.children=[];}
 get textContent(){return this.value+this.children.map(e=>e.textContent).join('');}
}
globalThis.window={};globalThis.activeWindow={};
globalThis.activeDocument={createElement:()=>new Element(),createDocumentFragment:()=>new Element(),createTextNode:text=>{nodes++;return {textContent:text};}};
const bundle=await build({stdin:{contents:"export * from './src/source-view';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'stub',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export class Component {}; export const MarkdownRenderer = {};'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const results=[];
for(const size of [1000,6000,20000]){
 const markdown=Array.from({length:size},(_,i)=>i%17===0?'':i%23===0?'## Heading '+i:'\t'.repeat(i%4)+(i%3===0?'1. ':'')+'Synthetic **formatted** note [[Page|link]] '+i).join('\n');
 let dom=api.buildSourceLineDom(markdown,true,new Set([1]));
 for(const scenario of ['open','cursor-line','cursor-same-line','type']){
  let tick=0;
  const run=()=>{
   tick++;
   const active=new Set([scenario==='cursor-same-line'?1:tick%size+1]);
   if(scenario.startsWith('cursor')&&api.updatePreviewSelection) api.updatePreviewSelection(dom,active);
   else dom=api.buildSourceLineDom(markdown+(scenario==='type'?String(tick):''),true,active,scenario==='type'?dom:undefined);
  };
  for(let i=0;i<8;i++)run();
  const samples=[];nodes=0;
  for(let i=0;i<35;i++){const start=performance.now();run();samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);
  results.push({lines:size,scenario,medianMs:+samples[17].toFixed(3),p95Ms:+samples[33].toFixed(3),nodesPerOperation:Math.round(nodes/35)});
 }
}
const report={runtime:process.version,scope:'JS rendering with a minimal DOM; excludes browser layout, paint, Obsidian and Prism',results};
console.log(JSON.stringify(report,null,2));
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
