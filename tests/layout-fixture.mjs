import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
const js=await build({stdin:{contents:`
import {buildSourceLineDom} from './src/source-view';
import {mirrorDocumentMetrics} from './src/document-metrics';
window.activeDocument=document;window.activeWindow=window;
const pane=document.querySelector('.pane'), content=document.querySelector('.minimap-content'),container=document.querySelector('.minimap-container');
const source=['Tabs:','\\talpha\\tbeta','', 'A long line with words and spaces '.repeat(20),'中文测试 '.repeat(60),'tail'];
for(const line of source){const e=document.createElement('div');e.className='cm-line';e.textContent=line||'\\u200b';document.querySelector('.cm-content').append(e);}
content.append(buildSourceLineDom(source.join('\\n')).fragment);
const results=[];
function run(){
 for(const width of [900,520,320,900]){
  pane.style.width=width+'px';
  for(let i=0;i<3;i++) mirrorDocumentMetrics({element:pane,container,content,readMode:false,rawSourceMode:true,stripLeft:0,reserveSpace:true,scale:.1,scrollbarGutter:14});
  const a=[...document.querySelectorAll('.cm-line')], b=[...document.querySelectorAll('.minimap-source-line')];
  const mismatch=a.some((e,i)=>Math.abs(e.offsetHeight-b[i].offsetHeight)>1);
  const editorRight=a[0].getBoundingClientRect().right,stripLeft=document.querySelector('.minimap-hitbox').getBoundingClientRect().left;
  const good=!mismatch&&editorRight+10<=stripLeft;
  results.push({width,good,editorWidth:a[0].clientWidth,panelWidth:content.clientWidth,gap:stripLeft-editorRight,heights:a.map(e=>e.offsetHeight),panelHeights:b.map(e=>e.offsetHeight)});
 }
 document.querySelector('pre').textContent=JSON.stringify(results,null,2);
 document.querySelector('#status').textContent=results.every(r=>r.good)?'PASS: all layout checks':'FAIL: layout mismatch';
}
document.querySelector('button').onclick=run;run();
`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',minify:true,plugins:[{name:'obsidian-stub',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export class Component {}; export const MarkdownRenderer = {};'}));}}]});
const css=await readFile('styles.css','utf8');
const html=`<!doctype html><meta charset="utf-8"><title>Minimap Source layout regression fixture</title><style>
body{font:16px Arial;background:#191919;color:#ddd}h1{font-size:20px}.pane{position:relative;height:370px;border:1px solid #555;background:#202020}.markdown-source-view{height:100%}.cm-scroller{height:100%;box-sizing:border-box;overflow:auto;padding:24px;display:flex}.cm-sizer{flex:1;min-width:0}.cm-content{font:16px/24px monospace;tab-size:4;letter-spacing:0}.cm-line{white-space:pre-wrap;overflow-wrap:break-word;word-break:normal}.minimap-content{box-sizing:border-box;font:16px/24px monospace;color:#ddd}pre{font-size:12px}.minimap-container{--scale:.1;--minimap-text-opacity:.55}
${css}</style><h1>Source-mode layout checks</h1><button>Run resize checks</button><p id="status"></p><div class="pane"><div class="markdown-source-view mod-cm6"><div class="cm-scroller"><div class="cm-sizer"><div class="cm-content"></div></div></div></div><div class="minimap-container"><div class="minimap-viewport"><div class="minimap-content minimap-content-source"></div></div><div class="minimap-hitbox"></div></div></div><pre></pre><script>${js.outputFiles[0].text}</script>`;
await writeFile('/tmp/minimap-layout.html',html);
