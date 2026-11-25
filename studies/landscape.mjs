// Public-state-only aesthetic studies. No I/O, credentials, or mutation.
function smooth(t){return t*t*(3-2*t)}
function clamp(x,lo=0,hi=1){return Math.max(lo,Math.min(hi,x))}
function mix(a,b,t){return a.map((v,i)=>v+(b[i]-v)*t)}
function hex(rgb){return "#"+rgb.map(x=>Math.round(clamp(x,0,255)).toString(16).padStart(2,"0")).join("")}
function hash(seed,epoch,channel){let n=(seed|0)^Math.imul(epoch|0,0x9e3779b1)^Math.imul(channel|0,0x85ebca6b);n^=n>>>16;n=Math.imul(n,0x7feb352d);n^=n>>>15;n=Math.imul(n,0x846ca68b);return ((n^(n>>>16))>>>0)/4294967295}
export function visualRecipe(s){
 if(!s||!Number.isSafeInteger(s.worldMinute)||s.worldMinute<0||!Number.isFinite(s.seed))throw new TypeError("invalid public world clock or seed");
 const palettes={
  spring:[[191,196,176],[230,224,203],[112,125,105],[72,85,66]],
  summer:[[176,190,195],[233,218,183],[154,148,110],[83,99,75]],
  autumn:[[183,177,167],[226,206,172],[140,115,91],[87,76,62]],
  winter:[[173,181,186],[218,220,216],[130,136,130],[73,86,86]]
 };
 const season=Object.hasOwn(palettes,s.season)?s.season:"summer",weather=["clear","cloudy","rain","storm","fog","snow"].includes(s.weather)?s.weather:"clear";
 const t=s.worldMinute, epoch=Math.floor(t/4320),q=smooth((t%4320)/4320);
 const drift=ch=>(hash(s.seed,epoch,ch)*(1-q)+hash(s.seed,epoch+1,ch)*q);
 const day=(t%1440)/1440,light=clamp(0.5-0.5*Math.cos(2*Math.PI*day));
 const softness=({clear:0.08,cloudy:0.3,rain:0.48,storm:0.65,fog:0.7,snow:0.5})[weather];
 const night=[[36,42,51],[67,70,80],[51,57,57],[39,48,45]];
 const colors=palettes[season].map((p,i)=>{
  const base=mix(night[i],p,0.18+0.82*light);
  const avg=(base[0]+base[1]+base[2])/3;
  const tone=mix(base,[avg,avg,avg],softness*.5);
  return hex(tone.map((v,j)=>v+(drift(i*3+j)-.5)*12));
 });
 return {schema:1,sky:colors[0],horizon:colors[1],ground:colors[2],foreground:colors[3],
  atmosphere:clamp(.08+softness*.58+drift(13)*.07),contrast:clamp(.62+light*.22-softness*.32),horizonFraction:.42+drift(14)*.10,
  contourAmplitude:.018+drift(15)*.038,contourSpacing:.06+drift(16)*.055,grainOpacity:.025+drift(17)*.045,
  epoch,weather,season};
}
export function renderStudy(state, width=1080,height=720){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<320||height<240||width>2400||height>2400)throw new RangeError("invalid study size");
 const r=visualRecipe(state),W=width,H=height,horizon=H*r.horizonFraction;
 const f=n=>Number(n.toFixed(2)), out=[];
 // No labels, external URLs, user strings or private notebook data enter the SVG.
 const svg=(tag,attrs)=>"<"+tag+" "+Object.entries(attrs).map(([k,v])=>k+'="'+v+'"').join(" ")+"/>";
 out.push('<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Generative landscape study">');
 out.push('<defs><linearGradient id="air" x2="0" y2="1"><stop stop-color="'+r.sky+'"/><stop offset="1" stop-color="'+r.horizon+'"/></linearGradient><linearGradient id="land" x2="0" y2="1"><stop stop-color="'+r.horizon+'"/><stop offset=".3" stop-color="'+r.ground+'"/><stop offset="1" stop-color="'+r.foreground+'"/></linearGradient></defs>');
 out.push(svg("rect",{width:W,height:H,fill:"url(#air)"}));
 let ridge="M0 "+f(horizon);
 for(let i=0;i<=24;i++){const x=i*W/24,y=horizon+Math.sin(i*.52+hash(state.seed,0,3)*6)*H*r.contourAmplitude+Math.sin(i*.91)*H*.009;ridge+=" L"+f(x)+" "+f(y)}
 ridge+=" L"+W+" "+H+" L0 "+H+" Z";
 out.push(svg("path",{d:ridge,fill:"url(#land)"}));
 for(let k=1;k<=7;k++){
  const y=horizon+(H-horizon)*(k/8)**1.8;
  let d="M0 "+f(y);
  for(let i=1;i<=20;i++){d+=" L"+f(i*W/20)+" "+f(y+Math.sin(i*.31+k*.7)*H*r.contourAmplitude*(k/8));}
  out.push(svg("path",{d,fill:"none",stroke:r.foreground,"stroke-opacity":f(.09+k*.015),"stroke-width":f(.7+k*.12)}))
 }
 // Fixed domain: never rescale the world when a new object is planted.
 // Draw known public object categories only; this is schematic, not actual geometry.
 const objects=(Array.isArray(state.objects)?state.objects:[]).filter(o=>o&&["tree","rock","landmark","garden","shelter","berry"].includes(o.type)&&Number.isFinite(o.x)&&Number.isFinite(o.z)&&Math.abs(o.x)<=40&&Math.abs(o.z)<=40).slice(0,200).sort((a,b)=>b.z-a.z||a.x-b.x||a.type.localeCompare(b.type));
 for(const o of objects){
  const depth=clamp((40-o.z)/80),x=f(W/2+o.x*W/85*(.65+.35*depth)),y=f(horizon+8+(H-horizon-20)*depth**1.65),scale=H/720*(.35+.95*depth),opacity=f(.42+.48*depth);
  const color=r.foreground;
  if(o.type==="tree"){
   const tall=clamp(Number.isFinite(o.stage)?o.stage:1,1,5)*5+12;
   out.push(svg("path",{d:"M"+x+" "+y+" v"+f(-tall*scale),stroke:color,"stroke-width":f(1.4*scale),opacity}));
   out.push(svg("ellipse",{cx:x,cy:f(y-tall*scale),rx:f(6*scale),ry:f(13*scale),fill:color,opacity}));
  }else if(o.type==="shelter"){
   out.push(svg("path",{d:"M"+f(x-13*scale)+" "+y+" v"+f(-12*scale)+" l"+f(13*scale)+" "+f(-10*scale)+" l"+f(13*scale)+" "+f(10*scale)+" v"+f(12*scale)+" Z",fill:color,opacity}));
  }else if(o.type==="landmark"){
   out.push(svg("path",{d:"M"+f(x-6*scale)+" "+y+" v"+f(-18*scale)+" h"+f(12*scale)+" v"+f(18*scale),fill:"none",stroke:color,"stroke-width":f(3*scale),opacity}));
  }else{
   out.push(svg("ellipse",{cx:x,cy:y,rx:f((o.type==="garden"?11:4)*scale),ry:f(2.5*scale),fill:color,opacity}));
  }
 }
 out.push(svg("rect",{width:W,height:H,fill:r.horizon,opacity:f(r.atmosphere*.25)}));
 out.push("</svg>");
 return out.join("\n");
}
