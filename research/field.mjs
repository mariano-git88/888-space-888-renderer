import { fieldSnapshot } from './field-sources.mjs';
import { fieldRules } from './field-rules.mjs';

// An original event-based score, never a reconstruction of Gaetano's actual 3-D landscape.
// Time is on the horizontal axis; marks are categorical, not geographic.
const kinds=new Set(['weather','growth','decision','discovery']);
export function validFieldSnapshot(s) {
  if(!s || !Array.isArray(s.events) || s.events.length<2 || s.events.length>80) return false;
  if(!/^j_[1-9][0-9]{0,14}$/.test(s.lastEventId||''))return false;
  let previous=-1,seen=new Set();
  for(const e of s.events){
    if(!/^j_[1-9][0-9]{0,14}$/.test(e.id||'')||seen.has(e.id)||!Number.isInteger(e.minute)||e.minute<0||e.minute<previous||
       !kinds.has(e.kind)||typeof e.text!=='string'||e.text.length<10||e.text.length>300)return false;
    previous=e.minute;seen.add(e.id);
  }
  return s.events[s.events.length-1].id===s.lastEventId;
}
function dateNumber(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('invalid_date');
  const [year,month,day]=s.split('-').map(Number),t=Date.UTC(year,month-1,day);
  if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==s)throw Error('invalid_date');
  return Math.floor(t/86400000);
}
function hash(value) {
  let h=2166136261;
  for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}
  return h>>>0;
}
const htmlescape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export function fieldScore(date,orientation=null,snapshot=fieldSnapshot){
  if(!validFieldSnapshot(snapshot))throw Error('invalid_field_snapshot');
  const day=dateNumber(date);
  const phase=orientation===null?((day%4)+4)%4:orientation;
  if(!Number.isInteger(phase)||phase<0||phase>3)throw Error('invalid_phase');
  const events=snapshot.events,minimum=events[0].minute,maximum=events[events.length-1].minute,span=Math.max(1,maximum-minimum);
  const lanes=[
    {weather:140,growth:330,decision:500,discovery:510},
    {weather:450,growth:160,decision:330,discovery:300},
    {weather:270,growth:460,decision:155,discovery:210},
    {weather:190,growth:390,decision:300,discovery:330}
  ][phase];
  const marks=events.map((e,i)=>{
    const jitter=(hash(e.id+'-'+date)%67)-33;
    return {...e,x:94+(e.minute-minimum)/span*892,y:lanes[e.kind]+jitter,kind:e.kind,seq:i};
  });
  return {
    date,phase,sourceId:snapshot.snapshotId,sourceLastEvent:snapshot.lastEventId,
    observedDate:snapshot.observedDate,firstMinute:minimum,lastMinute:maximum,
    density:events.length,marks,
    note:[
      'Separate kinds / same horizon',
      'Growth above / weather below',
      'Decision beside / weather between',
      'Returns as interrupted intervals'
    ][phase]
  };
}
// Farthest-time sampling keeps source coverage while letting absence become visible.
// Nothing is deleted from the source ledger, and no locations or causes are inferred.
export function visibleFieldMarks(score, rules=fieldRules){
  if(!Array.isArray(score?.marks)||!Number.isInteger(score.phase)||score.phase<0||score.phase>3)throw Error('invalid_field_score');
  const marks=score.marks, n=marks.length;
  const count=Math.min(n,Math.max(1,Number(rules.markBudgets?.[score.phase])||n));
  if(count===n)return marks.slice();
  const selected=new Map();
  function include(m){if(m)selected.set(m.id,m)}
  include(marks[0]);include(marks[n-1]);
  for(const kind of ['weather','growth','decision','discovery'])include([...marks].reverse().find(m=>m.kind===kind));
  if(selected.size>count)throw Error('rule_budget_excludes_required_evidence');
  while(selected.size<count){
    let best=null,bestDistance=-1;
    for(const mark of marks){
      if(selected.has(mark.id))continue;
      const distance=Math.min(...[...selected.values()].map(s=>Math.abs(s.minute-mark.minute)));
      if(distance>bestDistance||(distance===bestDistance && mark.seq<(best?.seq??Infinity))){
        best=mark;bestDistance=distance;
      }
    }
    if(!best)break;
    include(best);
  }
  return marks.filter(m=>selected.has(m.id));
}
function symbol(m,phase){
  const x=m.x,y=m.y,seed=hash(m.id),w=8+(seed%16),r=9+(seed%12);
  const clr=m.kind==='weather'?'#7c8881':m.kind==='growth'?'#657761':m.kind==='discovery'?'#886d62':'#383733';
  const shape=m.kind==='weather'
    ?'<path d="M '+(x-20)+' '+y+' Q '+x+' '+(y-20)+' '+(x+20)+' '+y+' M '+(x-14)+' '+(y+8)+' Q '+x+' '+(y-5)+' '+(x+14)+' '+(y+8)+'" fill="none" stroke-width="1.4"/>'
    :m.kind==='growth'
    ?'<path d="M '+x+' '+(y+21)+' V '+(y-15)+' M '+x+' '+(y-7)+' L '+(x-12)+' '+(y-17)+' M '+x+' '+(y-3)+' L '+(x+12)+' '+(y-16)+'" fill="none" stroke-width="1.45"/><circle cx="'+x+'" cy="'+(y-20)+'" r="2.6"/>'
    :m.kind==='discovery'
    ?'<path d="M '+(x-14)+' '+(y+16)+' V '+(y-8)+' Q '+x+' '+(y-30)+' '+(x+14)+' '+(y-8)+' V '+(y+16)+'" fill="none" stroke-width="1.55"/><circle cx="'+x+'" cy="'+(y-2)+'" r="2"/>'
    :m.text.startsWith('Revisiting')
    ?'<path d="M '+(x-14)+' '+(y+10)+' Q '+x+' '+(y-20)+' '+(x+14)+' '+(y+10)+'" fill="none" stroke-width="1.55"/><path d="M '+(x-18)+' '+(y+17)+' H '+(x+18)+'" stroke-width=".85"/>'
    :'<path d="M '+(x-w)+' '+(y-4)+' H '+(x+w)+' M '+(x-w/2)+' '+(y+5)+' H '+(x+w/2)+'" fill="none" stroke-width="1.5"/>';
  const rise=phase===3?27:16;
  return '<g stroke="'+clr+'" color="'+clr+'" data-event="'+htmlescape(m.id)+'" tabindex="0" aria-label="'+htmlescape(m.id+' '+m.kind+' at minute '+m.minute+'. '+m.text)+'">'+
    '<title>'+htmlescape(m.id+': '+m.text)+'</title>'+
    '<path d="M '+x+' 605 V '+(y+rise)+'" stroke="'+clr+'" stroke-opacity=".10" stroke-width=".85" fill="none"/>'+
    shape+'<circle cx="'+x+'" cy="605" r="2" fill="'+clr+'" stroke="none"/></g>';
}
export function fieldHTML(date,phase=null,snapshot=fieldSnapshot){
  const score=fieldScore(date,phase,snapshot);
  const visible=visibleFieldMarks(score),visibleIds=new Set(visible.map(m=>m.id));
  const escaped=htmlescape;
  const year=Number(score.date.slice(0,4));
  const view='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 665" role="img" aria-labelledby="drawing-title drawing-desc">'+
    '<title id="drawing-title">An event score, not a map</title>'+
    '<desc id="drawing-desc">'+visible.length+' marks shown of '+score.density+' verified world journal entries. Weather, growth, decisions and one discovery are marked along an axis of recorded minutes. Arrangement number '+(score.phase+1)+'.</desc>'+
    '<path d="M 72 605 H 1006" stroke="#c6c5bb" stroke-width="1"/>'+
    '<text x="72" y="642" font-size="12" fill="#77776e" letter-spacing="2">'+score.firstMinute+'</text>'+
    '<text x="1006" y="642" text-anchor="end" font-size="12" fill="#77776e" letter-spacing="2">'+score.lastMinute+'</text>'+
    '<path d="M 72 45 H 1006 M 72 598 H 1006" stroke="#c6c5bb" stroke-dasharray="2 7" stroke-width=".7"/>'+
    visible.map(m=>symbol(m,score.phase)).join('')+
    '</svg>';
  const ledger='<ol class="ledger">'+snapshot.events.map(e=>'<li><span>'+escaped(e.id)+' / '+e.minute+' / '+escaped(e.kind)+' / '+(visibleIds.has(e.id)?'drawn':'withheld mark')+'</span><p>'+escaped(e.text)+'</p></li>').join('')+'</ol>';
  const other=[0,1,2,3].map(i=>'<a class="'+(i===score.phase?'selected':'')+'" href="?phase='+i+'" '+(i===score.phase?'aria-current="page"':'')+'>'+('0'+(i+1))+'</a>').join('');
  const css=':root{color-scheme:light;--paper:#eeede7;--ink:#272722;--soft:#898a81}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#e3e1d9;color:var(--ink);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}main{max-width:1420px;margin:auto;background:var(--paper);min-height:100vh;padding:clamp(20px,4vw,62px)}header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.eyebrow,.meta{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:#63665f}h1{font:400 clamp(42px,6.5vw,105px)/.92 Georgia,serif;letter-spacing:-.075em;margin:clamp(60px,9vw,125px) 0 25px;max-width:1000px}.under{font-size:13px;color:#62645c;max-width:600px;line-height:1.7}.frame{margin:42px auto 15px;background:#f4f3ed;border:1px solid #d4d3c9;padding:clamp(8px,2vw,28px)}svg{width:100%;height:auto;display:block;overflow:visible}svg g:focus{outline:none;filter:drop-shadow(0 0 2px #777)}.controls{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;border-bottom:1px solid #c9c9bf;padding:20px 0 45px}.switch{display:flex;gap:7px}.switch a{font-size:13px;text-decoration:none;color:inherit;border:1px solid #a5a69d;padding:11px 19px}.switch a.selected{background:#30312e;color:#f0eee9}.explain{display:grid;grid-template-columns:2fr 1fr;gap:30px;margin:70px 0}.explain h2{font:400 clamp(25px,3vw,45px) Georgia,serif;letter-spacing:-.03em;margin:5px 0}.explain p{font-size:13px;line-height:1.9;max-width:560px}.legend{font-size:12px;line-height:2.3;color:#65685f;border-top:1px solid #c9c9bf;padding-top:16px}.legend span{display:inline-block;width:22px;height:1px;background:#657761;margin-right:10px;vertical-align:middle}.legend .weather{background:#7c8881}.legend .choice{background:#383733}.legend .return{background:#886d62}details{padding-top:25px;border-top:1px solid #c9c9bf;margin-bottom:70px}summary{cursor:pointer;font-size:14px}.ledger{padding-left:22px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 45px}.ledger li{font-size:12px;border-bottom:1px solid #d3d2ca;padding:10px 2px}.ledger li span{color:#6c6e65;font-size:11px}.ledger li p{line-height:1.5;margin:6px 0}.footer{padding-top:20px;border-top:1px solid #c9c9bf;display:flex;justify-content:space-between;gap:30px;font-size:11px;line-height:1.7;color:#6c6e65}.footer a{color:inherit}@media(max-width:740px){.explain{grid-template-columns:1fr}.ledger{grid-template-columns:1fr}.switch a{padding:9px 14px}main{padding:20px}header{flex-direction:column}h1{margin:60px 0 20px}.frame{padding:4px}}';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>A field made of returns — 888 Space 888</title><style>'+css+'</style></head><body>'+
    '<main><header><span class="eyebrow">888 Space 888 / Gaetano / Field Study 04</span><span class="meta">Recorded simulation / '+escaped(score.date)+' UTC</span></header>'+
    '<h1>A field made<br>of returns.</h1>'+
    '<p class="under">No coordinates are preserved in these journal entries. The drawing arranges what happened in time, not where it happened in space. A return can be repeated without becoming a road.</p>'+
    '<section class="frame" aria-label="Time-based event score">'+view+'</section>'+
    '<nav class="controls" aria-label="Change the event arrangement"><div class="meta">Arrangement '+(score.phase+1)+' of 4 / '+escaped(score.note)+'</div><div class="switch">'+other+'</div></nav>'+
    '<section class="explain"><div><p class="meta">A generative rule, not a landscape</p><h2>When the same place is mentioned twice, what has changed?</h2><p>The horizontal placement follows recorded world minutes. A rule sometimes withholds a repeated mark to preserve the distance between others; the complete source ledger remains below. Weather becomes a pair of arcs; growth, a short branch; return decisions, an unfinished arch. Their vertical positions are non-spatial and change by daily arrangement. Nothing moves in the original world when this page changes.</p><p>These marks are intentionally incomplete. Each one has a source record beneath it, but the score refuses to draw a path between remembered places whose positions are not in the archive.</p></div><div class="legend"><div><span class="weather"></span>weather</div><div><span></span>growth</div><div><span class="choice"></span>decision or maintenance</div><div><span class="return"></span>confirmed landmark return</div><p>Source: '+escaped(snapshot.snapshotId)+'<br>'+score.density+' real archived event records / '+visible.length+' drawn<br>Rule revision '+fieldRules.revision+'<br>Observed '+escaped(snapshot.observedDate)+'<br>Visual state changes daily, but observations do not update until the source archive is revised.</p></div></section>'+
    '<details><summary>Read the exact source ledger ('+score.density+' entries)</summary>'+ledger+'</details>'+
    '<footer class="footer"><span>An original procedural study. Not Gaetano’s live 3D world, an eyewitness account, a completed physical edition, or an artwork by any other artist.</span><a href="https://www.888space888.com/">888space888.com</a></footer></main></body></html>';
}
