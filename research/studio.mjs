/**
 * A public, self-contained original typographic study based on archived
 * Gaetano world events j_1135 and j_1136, world minute 77149.
 * Neither a third-party artwork reproduction nor proof of physical production.
 *
 * Variable widths and permutations are intentional, reproducible experiments,
 * not claims about the events, the creator or the state of the main world.
 */
export const sourcePair = Object.freeze([
  {id:"j_1135",kind:"weather",text:"Clouds softened the light.",count:26},
  {id:"j_1136",kind:"decision",text:"I chose to reap my garden.",count:26},
]);
export function validateSourcePair(rows=sourcePair) {
  return rows.length===2 && rows.every(x=>Array.from(x.text).length===x.count);
}
export function layoutForDay(dayString, orientation=0) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dayString)||!Number.isInteger(orientation)||orientation<0||orientation>3) throw Error("invalid_study_state");
  // Date.UTC rather than local time makes the daily state reproducible worldwide.
  const [y,m,d]=dayString.split("-").map(Number);
  const t=Date.UTC(y,m-1,d);
  if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==dayString)throw Error("invalid_date");
  const day=Math.floor(t/86400000),phase=((day+orientation)%4+4)%4;
  return {
    day:dayString,
    phase,
    fields:sourcePair.map((row,i)=>({...row,width: phase===0 ? 100 : (phase===1 ? (i===0?100:58) : phase===2?(i===0?58:100):58)})),
    readingOrder:phase===3?[1,0]:[0,1],
    note:["equal / equal","equal / narrow","narrow / equal","narrow / narrow; reversed order"][phase]
  };
}
export function studioHTML(dayString) {
 const init=layoutForDay(dayString,0);
 const escaped=JSON.stringify(init).replace(/</g,"\\u003c").replace(/>/g,"\\u003e");
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Two events / one minute — Study Lab</title>
<style>
:root{color-scheme:light;--paper:#f3f2ef;--ink:#272625;--weak:#85827c;--grid:#d0cec8}
*{box-sizing:border-box}body{margin:0;background:#e7e5e0;color:var(--ink);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.shell{max-width:1200px;margin:auto;display:grid;grid-template-columns:minmax(0,1fr) 280px;min-height:100vh}.paper{background:var(--paper);min-height:100vh;padding:clamp(30px,6.5vw,94px);display:flex;flex-direction:column}.eyebrow,.foot{font-size:clamp(11px,1.2vw,16px);letter-spacing:.08em;text-transform:uppercase}.top{margin-bottom:clamp(75px,13vw,165px)}h1{font-weight:400;letter-spacing:-.055em;font-size:clamp(26px,4vw,56px);line-height:1.05;margin:8px 0}.date{color:var(--weak);font-size:13px}.work{display:flex;flex-direction:column;gap:clamp(48px,7vw,95px);flex:1}.field{border:1px solid var(--weak);min-height:150px;display:flex;align-items:center;padding:25px;transition:width .65s ease,background .65s ease;max-width:100%;overflow-wrap:break-word}.field p{font-size:clamp(18px,2.7vw,31px);line-height:1.55;letter-spacing:-.065em;margin:0}.source{font-size:13px;margin-top:12px;color:var(--weak)}.bottom{margin-top:90px;border-top:1px solid var(--weak);padding-top:14px}.controls{background:#e7e5e0;padding:36px 24px;border-left:1px solid #cfcdc7;display:flex;flex-direction:column;gap:20px}.controls h2{font-size:18px;font-weight:500;margin:0}.controls p{font-size:13px;line-height:1.6;margin:0;color:#65615c}.controls button{width:100%;background:transparent;border:1px solid var(--ink);color:var(--ink);padding:13px;text-align:left;font:inherit;font-size:13px;cursor:pointer}.controls button:hover{background:#d6d4ce}.controls button:focus-visible{outline:3px solid #555}.controls .key{border-top:1px solid #b6b3ad;padding-top:20px;font-size:12px;line-height:1.7}.status{font-size:12px;min-height:35px;color:#555}.small{margin-top:auto}.links a{color:inherit;overflow-wrap:anywhere}@media(max-width:800px){.shell{display:block}.paper{min-height:90vh;padding:28px 20px}.top{margin-bottom:65px}.work{gap:60px}.field{min-height:130px;padding:16px}.field p{font-size:clamp(17px,4.7vw,27px)}.bottom{margin-top:60px}.controls{border-left:0;border-top:1px solid #cfcdc7;min-height:370px}}
@media(prefers-reduced-motion:reduce){.field{transition:none}}
</style></head><body><main class="shell"><section class="paper"><header class="top"><div class="eyebrow">888 Space 888 / Research Studio 03</div><h1>Two events, one minute.</h1><div class="date" id="day"></div></header><section class="work" aria-label="Two recorded events"><div id="slot0"></div><div id="slot1"></div></section><footer class="bottom"><div class="foot" id="mode">EQUAL / EQUAL</div><div class="date">World minute 77149. Independent layout study; not the main world.</div></footer></section><aside class="controls"><h2>A reversible constraint</h2><p>The language remains unchanged. Only the space granted to each event varies. Return tomorrow to see another daily arrangement, or intervene now.</p><div><button id="alter">Change the relation</button><button id="reset">Return to today's state</button></div><div id="status" class="status" role="status"></div><div class="key"><strong>Recorded source</strong><p>Two distinct archived events at the same world minute. These 26-character lines are edits; the originals remain in Gaetano's historical archive. The later harvest is not represented here.</p></div><p class="small">No third-party images, personal data, cookies, analytics or sales. Original digital experiment; no physical edition claimed.</p><div class="links"><a href="https://www.888space888.com/">888space888.com</a></div></aside></main>
<script>
"use strict";
const initial=${escaped};
const rows=[{id:"1135",kind:"weather",text:"Clouds softened the light.",count:26},{id:"1136",kind:"decision",text:"I chose to reap my garden.",count:26}];
let change=0;
const modeNames=["EQUAL / EQUAL","EQUAL / NARROW","NARROW / EQUAL","REVERSED / BOTH NARROW"];
function draw(){
 const phase=(initial.phase+change)%4;
 const order=phase===3?[1,0]:[0,1];
 const widths=phase===0?[100,100]:phase===1?[100,58]:phase===2?[58,100]:[58,58];
 order.forEach((index,slot)=>{
   const row=rows[index],container=document.getElementById("slot"+slot);
   container.replaceChildren();
   const field=document.createElement("div");field.className="field";field.style.width=widths[index]+"%";
   const p=document.createElement("p");p.textContent=row.text;field.append(p);
   const source=document.createElement("div");source.className="source";source.textContent=row.id+" / "+row.count+" characters / "+row.kind;
   container.append(field,source);
 });
 document.getElementById("mode").textContent=modeNames[phase];
 document.getElementById("status").textContent="Arrangement "+(phase+1)+" of 4. "+(change===0?"Daily state.":"Visitor intervention "+change+".");
}
document.getElementById("day").textContent=initial.day+" UTC / shared minute";
document.getElementById("alter").addEventListener("click",()=>{change++;draw()});
document.getElementById("reset").addEventListener("click",()=>{change=0;draw()});
draw();
</script></body></html>`;
}
