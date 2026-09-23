import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Bundle the shipped modules, not a second implementation of the math.
const bundle = await build({stdin:{contents:`
export { requiredEditorPadding } from './src/document-metrics';
export { Minimap } from './src/minimap';
export { SourceMap } from './src/source-map';
export { computeScrollMetrics } from './src/scroll-model';
export { MinimapPointer } from './src/pointer';
export { applySourceFolds, buildSourceLineDom, updatePreviewSelection } from './src/source-view';
export { EditorState } from '@codemirror/state';
export { foldEffect, codeFolding } from '@codemirror/language';
`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',plugins:[{
name:'obsidian-test-stub',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export class Component {}; export const MarkdownRenderer = {};'}));}
}]});
const {Minimap,requiredEditorPadding,SourceMap,computeScrollMetrics,MinimapPointer,applySourceFolds,buildSourceLineDom,updatePreviewSelection,EditorState,foldEffect,codeFolding} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const near=(a,b)=>assert.ok(Math.abs(a-b)<0.001,`${a} != ${b}`);
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS',name);}
test('hidden and detached panes defer edits and full renders without reading the document',()=>{
 const note=Object.create(Minimap.prototype);
 note.content={};note.element={isConnected:true,getClientRects:()=>[]};
 Object.defineProperty(note,'view',{get(){throw new Error('Hidden pane read document');}});
 note.scheduleSourceRender(true);note.render();note.renderSourceText();note.syncDocumentMetrics();
 assert.equal(note.hiddenDirty,true);
 assert.equal(note.sourceRenderFrame,undefined);
 note.hiddenDirty=false;note.element.isConnected=false;
 note.element.getClientRects=()=>[{}];note.scheduleSourceRender(true);
 assert.equal(note.hiddenDirty,true);
 note.content=null;note.hiddenDirty=false;note.render();
 assert.equal(note.hiddenDirty,false);
});
test('revealing a dirty pane requests a fresh render before layout measurement',()=>{
 const note=Object.create(Minimap.prototype);
 note.content={};note.element={isConnected:true,getClientRects:()=>[{}]};
 note.hiddenDirty=true;let renders=0;
 note.render=()=>{renders++;note.hiddenDirty=false;};
 note.onResize();
 assert.equal(renders,1);assert.equal(note.hiddenDirty,false);
});
test('incremental render preserves padding and avoids resize timers while refreshing navigation',()=>{
 const calls=[];
 const host={view:{},syncDocumentMetrics:full=>calls.push(['metrics',full]),isReadModeActive:()=>false,
  getEditorView:()=>null,refreshSourceLayout:()=>calls.push(['map']),applyFolds:()=>{},
  anchors:{capture:()=>{}},updateSliderScroll:()=>calls.push(['slider']),onResize:()=>calls.push(['resize'])};
 Minimap.prototype.afterRender.call(host,true);
 assert.deepEqual(calls,[['metrics',false],['map'],['slider']]);
 calls.length=0;Minimap.prototype.afterRender.call(host);
 assert.deepEqual(calls,[['metrics',true],['map'],['slider'],['resize']]);
});
// Minimal DOM verifies generated text and row boundaries, not browser layout.
class TextElement {
 children=[]; className=''; value='';
 classList={add:(...names)=>{this.className+=' '+names.join(' ');}};
 appendChild(child){this.children.push(child);return child;}
 set textContent(value){this.value=value;this.children=[];}
 get textContent(){return this.value+this.children.map(c=>c.textContent).join('');}
}
globalThis.activeWindow={};globalThis.window={};
globalThis.activeDocument={createElement:()=>new TextElement(),createDocumentFragment:()=>new TextElement(),createTextNode:text=>({textContent:text})};
const texts=dom=>dom.elements.map(e=>e.textContent);
const snapshot=dom=>({text:texts(dom),classes:dom.elements.map(e=>e.className),headings:dom.headingLines,levels:dom.headingLevels});
test('plain-edit shortcut matches full parsing at every position around Markdown boundaries',()=>{
 const fixtures=['intro\nparagraph\n---\ntail','---\nkey: value\n---\ntext','```js\ncode\n```\ntext','first\nsecond\n===\nlast','> ```\ncode\n> ```\ntext','heading\n\ntext\nlast'];
 const replacements=['ordinary text','中文正文','\tindented','    indented','', '# heading', '---', '...', '```', '~~~', '> quote', '- list', '1. list', '==='];
 for(const input of fixtures) for(let i=0;i<input.split('\n').length;i++) for(const text of replacements){
  const before=buildSourceLineDom(input,true);
  const lines=input.split('\n');lines[i]=text;
  const next=lines.join('\n');
  assert.deepEqual(snapshot(buildSourceLineDom(next,true,new Set(),before)),snapshot(buildSourceLineDom(next,true)),`${input} -> ${next}`);
 }
});
test('prose edits reuse highlighting; code edits and Prism readiness invalidate it',()=>{
 const before=buildSourceLineDom('intro\n```js\ncode\n```',true);
 const edited=buildSourceLineDom('intro changed\n```js\ncode\n```',true,new Set(),before);
 assert.equal(edited.highlights,before.highlights);
 assert.equal(edited.elements[2],before.elements[2]);
 const codeEdit=buildSourceLineDom('intro changed\n```js\nnewCode\n```',true,new Set(),edited);
 assert.notEqual(codeEdit.highlights,edited.highlights);
 globalThis.activeWindow.Prism={languages:{js:{}},tokenize:text=>[text]};
 const ready=buildSourceLineDom('intro changed again\n```js\ncode\n```',true,new Set(),edited);
 assert.notEqual(ready.highlights,edited.highlights);
 assert.equal(ready.prismPending,false);
 delete globalThis.activeWindow.Prism;
});
test('geometry capture reads each metric once and reuses surviving row records',()=>{
 let heights=0,tops=0;
 const elements=[0,1,2].map(i=>({get offsetHeight(){heights++;return i===1?0:20;},get offsetTop(){tops++;return i*20;}}));
 const map=new SourceMap();map.capture(elements);
 assert.equal(heights,3);assert.equal(tops,2);
 const first=map.rows[0];map.capture(elements.slice(0,1));
 assert.equal(map.rows.length,1);assert.equal(map.rows[0],first);
});
test('incremental selection matches full renders, including blur and multiselection',()=>{
 const note='# Heading\n\t**bold** [[Note]]\n```\n**literal**\n```\nlast';
 const dom=buildSourceLineDom(note,true);
 for(const active of [new Set([1]),new Set([2]),new Set([2,3,4]),new Set(),new Set([6])]){
  updatePreviewSelection(dom,active);
  assert.deepEqual(snapshot(dom),snapshot(buildSourceLineDom(note,true,active)));
  const children=dom.elements.map(e=>e.children);
  assert.equal(updatePreviewSelection(dom,active),false);
  dom.elements.forEach((e,i)=>assert.equal(e.children,children[i]));
 }
});
test('incremental edits match full renders across structural changes and mode switches',()=>{
 let dom=buildSourceLineDom('first\nsecond\nlast',true);
 const revised=buildSourceLineDom('first\nchanged\nlast',true,new Set(),dom);
 assert.equal(revised.elements[0],dom.elements[0]);
 assert.notEqual(revised.elements[1],dom.elements[1]);
 dom=revised;
 for(const note of ['# head\n\t**bold**\nlast','```\n\t**bold**\n```','---\nkey: value\n---','first\n\nsecond\nlast','first','', '> quote\n- [x] task']){
  for(const preview of [true,false,true]){
   const active=new Set([1]);
   dom=buildSourceLineDom(note,preview,active,dom);
   assert.deepEqual(snapshot(dom),snapshot(buildSourceLineDom(note,preview,active)));
  }
 }
});
test('Live Preview keeps literal tabs, blank rows and nested list depth',()=>{
 const input='\tparent\n\t\tchild\n\n\t1. first\n\t\t2. second\n\t- [x] done';
 assert.deepEqual(texts(buildSourceLineDom(input,true)),['\tparent','\t\tchild','\u200b','\t1. first','\t\t2. second','\t• ☑ done']);
 assert.deepEqual(texts(buildSourceLineDom(input)),input.split('\n').map(t=>t||'\u200b'));
});
test('Live Preview formats inline text but preserves active-line source syntax',()=>{
 const input='# Heading\n\t**bold** *italic* ==mark== ~~strike~~ `code` [[Note|Alias]] [label](url)';
 assert.deepEqual(texts(buildSourceLineDom(input,true)),['Heading','\tbold italic mark strike code Alias label']);
 assert.deepEqual(texts(buildSourceLineDom(input,true,new Set([1,2]))),input.split('\n'));
});
test('Live Preview keeps code and frontmatter literal and never injects HTML',()=>{
 const input='---\nname: **raw**\n---\n```\n\t**code**\n```\n<script>alert(1)</script>';
 assert.deepEqual(texts(buildSourceLineDom(input,true)),input.split('\n'));
});
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
test('automatic right padding uses the rendered strip boundary and keeps theme minimum',()=>{
 assert.equal(requiredEditorPadding(1730,1602,24),140);
 assert.equal(requiredEditorPadding(1000,914,24),98);
 assert.equal(requiredEditorPadding(1000,914,160),160);
 assert.equal(requiredEditorPadding(1000,913.4,24),99);
});
console.log(`${passed} regression tests passed.`);
