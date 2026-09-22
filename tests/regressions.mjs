import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Bundle the shipped modules, not a second implementation of the math.
const bundle = await build({stdin:{contents:`
export { SourceMap } from './src/source-map';
export { sourceReservedWidth } from './src/document-metrics';
export { computeScrollMetrics } from './src/scroll-model';
export { MinimapPointer } from './src/pointer';
export { applySourceFolds } from './src/source-view';
export { EditorState } from '@codemirror/state';
export { foldEffect, codeFolding } from '@codemirror/language';
`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',plugins:[{
name:'obsidian-test-stub',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export class Component {}; export const MarkdownRenderer = {};'}));}
}]});
const {sourceReservedWidth,SourceMap,computeScrollMetrics,MinimapPointer,applySourceFolds,EditorState,foldEffect,codeFolding} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<0.001,`${a} != ${b}`);
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS',name);}
function editor(heights){
 const blocks=heights.map((height,i)=>({from:i*10,top:heights.slice(0,i).reduce((a,b)=>a+b,0),height}));
 blocks.forEach(b=>b.bottom=b.top+b.height);
 return {state:{doc:{lines:heights.length,line:n=>({from:(n-1)*10}),lineAt:pos=>({number:Math.floor(pos/10)+1})}},lineBlockAt:pos=>blocks[Math.floor(pos/10)],lineBlockAtHeight:y=>blocks.find(b=>y<b.bottom)??blocks.at(-1)};
}
const rows=[{offsetTop:20,offsetHeight:20},{offsetTop:40,offsetHeight:60},{offsetTop:100,offsetHeight:20}];
test('line mapping handles wrapped text, top margin and scroll-past-end in both directions',()=>{
 const map=new SourceMap();map.capture(rows);assert.ok(map.prepare(editor([20,40,20]),30,150,170));
 near(map.toMinimap(70),70);near(map.toEditor(70),70);
 near(map.toMinimap(40),30);near(map.toEditor(30),40);
 for(let y=0;y<=150;y+=2) near(map.toEditor(map.toMinimap(y)),y);
});
test('first-visit editor height corrections never move captured minimap rows',()=>{
 const map=new SourceMap();map.capture(rows);map.prepare(editor([20,40,20]),30,150,170);
 near(map.toMinimap(90),100);
 map.prepare(editor([20,100,20]),30,210,170);
 near(map.toMinimap(150),100);near(map.toEditor(100),150);
 assert.deepEqual(rows.map(r=>r.offsetHeight),[20,60,20]);
});
test('folded rows are omitted and navigation still maps the visible source line',()=>{
 const map=new SourceMap();map.capture([{offsetTop:10,offsetHeight:20},{offsetTop:0,offsetHeight:0},{offsetTop:30,offsetHeight:20}]);
 const ed=editor([20,0,20]);map.prepare(ed,10,80,80);
 near(map.toEditor(35),35);near(map.toMinimap(35),35);
});
test('actual CM fold ranges hide lines and restore them after unfolding',()=>{
 const doc='head\nbody\nbody\nnext';
 let state=EditorState.create({doc,extensions:[codeFolding()]});
 state=state.update({effects:foldEffect.of({from:4,to:14})}).state;
 const elements=Array.from({length:4},()=>({hidden:false}));
 applySourceFolds(elements,{state});
 assert.deepEqual(elements.map(e=>e.hidden),[false,true,true,false]);
 applySourceFolds(elements,{state:EditorState.create({doc})});
 assert.deepEqual(elements.map(e=>e.hidden),[false,false,false,false]);
});
const input={clientHeight:500,scrollHeight:10000,scrollTop:4500,containerHeight:500,topOffset:0,bottomOffset:0,effectiveScrollHeight:10000,contentHeight:10000,scale:0.1,minViewportHeight:24,mapToMinimap:null};
test('track click targets the currently displayed text on a panned minimap',()=>{
 const m=computeScrollMetrics(input);
 const pointer=new MinimapPointer({scale:0.1,centerOnClick:true,mapToEditor:()=>null});
 near(pointer.documentScrollTop(100,m),(100+m.minimapScrollOffset)/0.1-250);
});
test('thumb dragging holds its grab position on a long document',()=>{
 const host={scale:0.1,centerOnClick:true,mapToEditor:()=>null,getScrollMetrics:y=>computeScrollMetrics({...input,scrollTop:y})};
 const pointer=new MinimapPointer(host);pointer.grabFraction=0.35;
 const target=pointer.thumbScrollTop(300,computeScrollMetrics(input));
 const m=host.getScrollMetrics(target);
 near(m.mappedTop-m.minimapScrollOffset+m.sliderHeight*0.35,300);
});
test('scroll endpoints stay within the track',()=>{
 for(const scrollTop of [0,9500]){
  const m=computeScrollMetrics({...input,scrollTop});
  near(m.mappedTop-m.minimapScrollOffset,scrollTop===0?0:m.activeHeight-m.sliderHeight);
 }
});
test('outer reserve fits a full-width editor and a readable-width editor',()=>{
 for(const available of [248,448,828,1500]) for(const scale of [.05,.1,.3]){
  for(const baseText of [available,Math.min(700,available)]){
   const reserve=sourceReservedWidth(available,baseText,scale,14);
   const textWidth=Math.min(baseText,available-reserve);
   assert.ok(reserve>=textWidth*scale+26-0.001);
   assert.ok(reserve<available);
  }
 }
 assert.equal(sourceReservedWidth(828,828,.1,14),99);
});
console.log(`${passed} regression tests passed.`);
