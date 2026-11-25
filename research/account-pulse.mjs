// Read-only account pulse for Gaetano's verified professional Instagram account.
// Never fetches followers, conversations, DMs, owner account information or tokens.
export function publicAccountPulse(row){
  if(!row||row.account_username!=='888.gaetano.888')return {status:'unobserved'};
  const n=v=>(Number.isSafeInteger(Number(v))&&Number(v)>=0)?Number(v):null;
  const posts=Array.isArray(row.recent_media)?row.recent_media:[];
  const safe=posts.filter(p=>typeof p?.permalink==='string'&&/^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(p.permalink))
    .slice(0,5).map(p=>({permalink:p.permalink,mediaType:p.media_type??null,publishedAt:p.published_at??null}));
  return {
    status:row.read_status==='ok'?'observed':'partially_observed',
    account:'888.gaetano.888',
    observedAt:row.checked_at instanceof Date?row.checked_at.toISOString():row.checked_at,
    mediaCount:n(row.media_count),
    followersCount:n(row.followers_count),
    followingCount:n(row.follows_count),
    recentPublications:safe,
    mediaReadVerified:row.read_status==='ok',
    source:'Meta Instagram API with Facebook Login; read-only, account-owned data',
    caveat:'No publication is inferred from a scheduled draft, saved artwork or publication container.'
  };
}
export function validateOwnedProfile(d,expectedUsername){
  return d&&String(d.username||'').toLowerCase()===String(expectedUsername).toLowerCase()&&
  [d.media_count,d.followers_count,d.follows_count].every(n=>n===undefined||Number.isSafeInteger(n)&&n>=0);
}
export function createAccountObserver({pool,installedToken,meta,igId,configured,username='888.gaetano.888'}){
  let working=false;
  async function initialize(){
    await pool.query("CREATE TABLE IF NOT EXISTS gaetano_ig_pulse (id TEXT PRIMARY KEY CHECK(id='gaetano'), account_username TEXT NOT NULL, media_count INTEGER, followers_count INTEGER, follows_count INTEGER, recent_media JSONB NOT NULL DEFAULT '[]'::jsonb, read_status TEXT NOT NULL, checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  }
  async function observe(){
    if(working)return;
    working=true;
    try{
      if(!configured())return;
      await initialize();
      const prev=await pool.query("SELECT checked_at FROM gaetano_ig_pulse WHERE id='gaetano'");
      if(prev.rows[0]?.checked_at && Date.now()-new Date(prev.rows[0].checked_at).getTime()<10*60*60*1000)return;
      const {token}=await installedToken();
      const profile=await meta(igId,token,{fields:'username,followers_count,follows_count,media_count'});
      if(!validateOwnedProfile(profile,username))throw Error('profile_mismatch');
      let readStatus='media_unavailable',posts=[];
      try{
        const data=await meta(igId+'/media',token,{fields:'id,media_type,permalink,timestamp,like_count,comments_count',limit:10});
        if(!Array.isArray(data.data))throw Error('media_invalid');
        posts=data.data.filter(p=>typeof p.permalink==='string').slice(0,10).map(p=>({
          permalink:p.permalink,media_type:p.media_type||null,published_at:p.timestamp||null,
          like_count:Number.isSafeInteger(p.like_count)?p.like_count:null,
          comments_count:Number.isSafeInteger(p.comments_count)?p.comments_count:null
        }));
        readStatus='ok';
      }catch{
        // Never report a confirmed empty feed if the media read failed.
        console.log('gaetano_owned_media_unavailable');
      }
      await pool.query("INSERT INTO gaetano_ig_pulse(id,account_username,media_count,followers_count,follows_count,recent_media,read_status,checked_at) VALUES('gaetano',$1,$2,$3,$4,$5::jsonb,$6,NOW()) ON CONFLICT (id) DO UPDATE SET account_username=EXCLUDED.account_username,media_count=EXCLUDED.media_count,followers_count=EXCLUDED.followers_count,follows_count=EXCLUDED.follows_count,recent_media=EXCLUDED.recent_media,read_status=EXCLUDED.read_status,checked_at=NOW()",[
        username,profile.media_count??null,profile.followers_count??null,profile.follows_count??null,JSON.stringify(posts),readStatus
      ]);
      console.log('gaetano_account_pulse_observed status='+readStatus);
    }catch{console.log('gaetano_account_pulse_unavailable')}
    finally{working=false}
  }
  async function read(){
    await initialize();
    const r=await pool.query("SELECT account_username,media_count,followers_count,follows_count,recent_media,read_status,checked_at FROM gaetano_ig_pulse WHERE id='gaetano'");
    return publicAccountPulse(r.rows[0]);
  }
  return {observe,read};
}
