"""Chromium RGBA comparison against a git revision (default task baseline), with no network/store writes.
Requires the already installed Python Playwright and Chromium. All temporary files stay in this tree.
"""
import base64
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = sys.argv[1] if len(sys.argv) > 1 else '243f55742929a44da4d2e5ca5cb21cafe9ab7c67'
FILES = ['mode/textdeform.js', 'mode/textdeform-surface.js', 'mode/textdeform-canvas.js']
SETUP = """() => {
  Object.defineProperty(performance, 'now', {value:()=>10000});
  Math.random = ()=>0.4;
  const T=TextDeform;
  Object.assign(T.P,{text:'TYPE FORM',fontFamily:'Helvetica',fontWeight:500,canvasAutoAdd:0,canvasAutoSwap:0,canvasAutoLayout:0,canvasPlate:'off',canvasFull:'off',cvSize:0,vecMode:'off',rhythmMotion:0});
  T.canvas=document.createElement('canvas');T.canvas.width=T.canvas.height=2;T.ctx=T.canvas.getContext('2d');
  T._mountDOM();T._applyStageStyle();T._createSpans(T.P.text);T._measureLayout();T._t=0;T._pointer={x:0,y:0};
  globalThis.rgba = c => {
    const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));
    return {w:c.width,h:c.height,data:btoa(s)};
  };
}"""
CASES = [
 ('text', """() => {TextDeform._renderToCanvas(640,360);return rgba(TextDeform.canvas);}"""),
 ('transparent-palette', """() => {Object.assign(TextDeform.P,{transparentBg:true,palOn:true,stretchX:1.2,stretchY:0.8});TextDeform._renderToCanvas(640,360);return rgba(TextDeform.canvas);}"""),
 ('canvas', """() => {const T=TextDeform;T.P.canvasOn=true;T.P.canvasStamps=Array.from({length:7},(_,i)=>({text:'TYPE',look:'test',x:0.15+i*0.11,y:0.25+(i%2)*0.4,s:0.35,rot:i*3,seed:i*9973+1,z:i}));TDCanvas._scheduleLive=()=>{};TDCanvas._stepBake=()=>{};TDCanvas._sync();for(const i of TDCanvas._inst.values()){i._born=0;i._measureLayout();}for(let j=0;j<3;j++)T._renderToCanvas(640,360);return rgba(T.canvas);}"""),
 ('hero', """() => {return rgba(TextDeform._renderHero(512,320,0.7));}"""),
 ('full-copy', """() => {const C=TDCanvas,T=TextDeform;const st={s:1,seed:1,look:'test'};T.P.canvasStamps=[st];C._sync();const i=C._inst.get(st);i._raster={pf:1,pw:512,ph:320};C._copyLetters=()=>{};C._restoreMain=()=>{};C._featherIfOpaque=()=>{};C._bakeFrame({st,t0:0,frames:3,saved:{}},i,10000);return rgba(i.full);}"""),
 ('surface-copy', """async () => {const S=TDSurf;const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,320,180);g.addColorStop(0,'#e0407099');g.addColorStop(1,'#1020f0');x.fillStyle=g;x.fillRect(0,0,320,180);const bitmap=await createImageBitmap(c);S._pending={key:'test',w:320,h:180,k:2,px:1,ops:[{id:'test',opacity:1,blend:'source-over'}]};if(globalThis.TDPixels)TDPixels.reserve(S,320*180*2);S._onJobState({key:'test',ready:true,busy:false,result:{kind:'frame',layers:{test:bitmap}}});return rgba(S.layers[0].canvas);}"""),
]

with tempfile.TemporaryDirectory(prefix='.td-pixel-test-',dir=ROOT) as temp:
    os.environ['TMPDIR']=temp
    tempfile.tempdir=temp
    with sync_playwright() as p:
        browser=p.chromium.launch(channel=os.environ.get('TD_TEST_BROWSER', 'chrome'),headless=True,env={**os.environ,'TMPDIR':temp})
        def page(old):
            page=browser.new_page(viewport={'width':800,'height':600})
            page.route('**/*',lambda route:route.abort())
            page.set_content('<!doctype html><html><body></body></html>')
            if not old:page.add_script_tag(content=(ROOT/'mode/textdeform-budget.js').read_text())
            for file in FILES:
                code=subprocess.check_output(['git','show',f'{BASE}:{file}'],cwd=ROOT,text=True) if old else (ROOT/file).read_text()
                page.add_script_tag(content=code)
            page.evaluate(SETUP)
            return page
        for name,run in CASES:
            results=[]
            for old in [True,False]:
                tab=page(old)
                results.append(tab.evaluate(run))
                tab.close()
            a,b=results
            assert (a['w'],a['h'])==(b['w'],b['h']),name
            ba,bb=base64.b64decode(a['data']),base64.b64decode(b['data'])
            different=sum(x!=y for x,y in zip(ba,bb))
            assert different==0,(name,different)
            assert any(ba),'empty fixture: '+name
            print(f'PASS: {name} {a["w"]}x{a["h"]}, RGBA differing bytes = {different}',flush=True)
        browser.close()
