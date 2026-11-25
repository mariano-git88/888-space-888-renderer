/**
 * Experimental, read-only Instagram Hashtag Search through Facebook Login.
 * The Meta feature may require additional Public Content Access review.
 * No source is assumed accessible until Meta returns a real receipt.
 */
const allowedTags=Object.freeze(['mailart','artistbooks','conceptualart']);
const validUrl=v=>typeof v==='string'&&/^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(v);
export function validateTag(t){return typeof t==='string'&&allowedTags.includes(t)}
export function publicHashtagSources(records,limit=15){
 const n=Number.isInteger(limit)?Math.min(Math.max(limit,1),15):15;
 return {
  source:'Meta Instagram Hashtag Search / Facebook Login',
  status:'individual_results_require_review',
  caveat:'A hashtag result is not a followed account, an authorized comment target, an inspected image or Gaetano original artwork.',
  media:(Array.isArray(records)?records:[]).filter(x=>validateTag(x.tag)&&validUrl(x.permalink)).slice(0,n).map(x=>({
   tag:x.tag,permalink:x.permalink,mediaType:x.media_type||null,publishedAt:x.published_at instanceof Date?x.published_at.toISOString():x.published_at||null
  }))
 };
}
export function createHashtagReader({pool,installedToken,meta,igId,configured}){
 let busy=false;
 async function init(){
  await pool.query("CREATE TABLE IF NOT EXISTS gaetano_hashtag_reads (tag TEXT PRIMARY KEY,read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_status TEXT NOT NULL)");
  await pool.query("CREATE TABLE IF NOT EXISTS gaetano_hashtag_sources (tag TEXT NOT NULL,media_id TEXT NOT NULL,permalink TEXT NOT NULL,media_type TEXT,published_at TIMESTAMPTZ,seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(tag,media_id))");
 }
 async function scan(){
  if(busy||!configured())return;
  busy=true;
  try{
   await init();
   const {token}=await installedToken();
   for(const tag of allowedTags){
    const last=await pool.query("SELECT read_at,last_status FROM gaetano_hashtag_reads WHERE tag=$1",[tag]);
    const prior=last.rows?.[0],age=prior?.read_at?Date.now()-new Date(prior.read_at).getTime():Infinity;
    if(age<24*60*60*1000)continue;
    if(prior?.last_status==='provider_unavailable'&&age<48*60*60*1000)continue;
    let status='provider_unavailable';
    try{
      const search=await meta('ig_hashtag_search',token,{user_id:igId,q:tag});
      const hashId=String(search?.data?.[0]?.id||'');
      if(!/^\d{8,25}$/.test(hashId))throw Error('unknown_hashtag');
      const response=await meta(hashId+'/recent_media',token,{
        user_id:igId,fields:'id,media_type,permalink,timestamp',limit:5
      });
      if(!Array.isArray(response?.data))throw Error('hashtag_media_unavailable');
      for(const media of response.data.slice(0,5)){
        const id=String(media?.id||'');
        if(!/^\d{8,25}$/.test(id)||!validUrl(media?.permalink))continue;
        await pool.query("INSERT INTO gaetano_hashtag_sources(tag,media_id,permalink,media_type,published_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tag,media_id) DO UPDATE SET seen_at=NOW()",[
          tag,id,media.permalink,media.media_type||null,media.timestamp||null
        ]);
      }
      status='ok';
    }catch{
      // Meta does not expose a verified missing permission in every error.
      // Never assert one from the provider's HTTP or numeric error alone.
      status='provider_unavailable';
    }
    await pool.query("INSERT INTO gaetano_hashtag_reads(tag,read_at,last_status) VALUES($1,NOW(),$2) ON CONFLICT(tag) DO UPDATE SET read_at=NOW(),last_status=EXCLUDED.last_status",[tag,status]);
    console.log('gaetano_hashtag_research_'+status);
   }
   await pool.query("DELETE FROM gaetano_hashtag_sources WHERE seen_at<NOW()-INTERVAL '14 days'");
  }catch{console.log('gaetano_hashtag_scan_unavailable')}
  finally{busy=false}
 }
 async function readPublic(){
   await init();
   const r=await pool.query("SELECT tag,permalink,media_type,published_at FROM gaetano_hashtag_sources ORDER BY seen_at DESC LIMIT 15");
   const statuses=await pool.query("SELECT tag,read_at,last_status FROM gaetano_hashtag_reads ORDER BY tag");
   return {...publicHashtagSources(r.rows),scans:statuses.rows.map(q=>({
     tag:validateTag(q.tag)?q.tag:null,status:q.last_status==='ok'?'ok':'unavailable',checkedAt:q.read_at
   })).filter(q=>q.tag)};
 }
 return {scan,readPublic};
}
