// Private, bounded observation cache. This does not inspect images or create art.
export function makeResearchCollector({ pool, installedToken, meta, igId, approved, sanitizeDiscovery, configured }) {
  let active = false;
  async function initialize() {
    await pool.query("CREATE TABLE IF NOT EXISTS gaetano_research_posts (username TEXT NOT NULL, media_id TEXT NOT NULL, permalink TEXT, caption TEXT NOT NULL DEFAULT '', media_type TEXT, posted_at TIMESTAMPTZ, visual_metadata JSONB NOT NULL DEFAULT '{}'::jsonb, first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(username,media_id))");
    await pool.query("CREATE TABLE IF NOT EXISTS gaetano_research_scans (username TEXT PRIMARY KEY, last_scan_at TIMESTAMPTZ NOT NULL, last_status TEXT NOT NULL)");
  }
  async function scan() {
    if(active) return;
    active=true;
    try {
      if(!configured()) { console.log('gaetano_research_not_configured'); return; }
      const { token }=await installedToken();
      await initialize();
      const targets=[...approved].slice(0,8);
      for(const username of targets) {
        try {
          const prev=await pool.query("SELECT last_scan_at FROM gaetano_research_scans WHERE username=$1",[username]);
          const last=prev.rows[0]?.last_scan_at?new Date(prev.rows[0].last_scan_at).getTime():0;
          if(last && Date.now()-last < 20*60*60*1000)continue;
          const count=3;
          const base='business_discovery.username('+username+'){username,media.limit('+count+'){id,caption,media_type,permalink,timestamp';
          let result,hasVisualFields=true;
          try {
            result=await meta(igId,token,{fields:base+',media_url,thumbnail_url,children{media_type,media_url}}}'});
          } catch {
            hasVisualFields=false;
            result=await meta(igId,token,{fields:base+'}}'});
          }
          const clean=sanitizeDiscovery(result,username,count);
          for(const media of clean.media) {
            await pool.query("INSERT INTO gaetano_research_posts(username,media_id,permalink,caption,media_type,posted_at,visual_metadata,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),NOW()) ON CONFLICT(username,media_id) DO UPDATE SET permalink=EXCLUDED.permalink,caption=EXCLUDED.caption,media_type=EXCLUDED.media_type,posted_at=EXCLUDED.posted_at,visual_metadata=EXCLUDED.visual_metadata,last_seen_at=NOW()",[
              username,media.id,media.permalink,media.caption,media.mediaType,media.timestamp,
              JSON.stringify({imageURL:media.imageURL,thumbnailURL:media.thumbnailURL,children:media.children,visualInspectionPerformed:false})
            ]);
          }
          await pool.query("INSERT INTO gaetano_research_scans(username,last_scan_at,last_status) VALUES($1,NOW(),'ok') ON CONFLICT(username) DO UPDATE SET last_scan_at=NOW(),last_status='ok'",[username]);
          // No captions, media URLs, private identifiers, or bearer tokens in logs.
          console.log('gaetano_research_scan_ok count='+clean.media.length+' rich_metadata='+hasVisualFields);
        }catch{
          console.log('gaetano_research_scan_failed');
        }
      }
      // Research cache is temporary, not the durable artistic reference archive.
      await pool.query("DELETE FROM gaetano_research_posts WHERE last_seen_at < NOW() - INTERVAL '14 days'");
    }catch(err){
      console.log(err?.code==='authorization_expired'?'gaetano_research_authorization_expired':'gaetano_research_scan_unavailable');
    }finally {active=false;}
  }
  async function readArchive(limit=20) {
    await initialize();
    const n=Math.max(1,Math.min(20,Number.isInteger(limit)?limit:20));
    const r=await pool.query("SELECT username,media_id,permalink,caption,media_type,posted_at,visual_metadata,first_seen_at FROM gaetano_research_posts ORDER BY posted_at DESC NULLS LAST LIMIT $1",[n]);
    return {source:'meta-business-discovery',visualInspectionPerformed:false,records:r.rows.map(x=>({
      username:x.username,mediaId:x.media_id,permalink:x.permalink,caption:x.caption,mediaType:x.media_type,publishedAt:x.posted_at,observedAt:x.first_seen_at,metadata:x.visual_metadata
    }))};
  }
  async function readPublicSources(limit=12) {
    await initialize();
    const n=Math.max(1,Math.min(12,Number.isInteger(limit)?limit:12));
    const r=await pool.query("SELECT username,permalink,media_type,posted_at FROM gaetano_research_posts WHERE permalink LIKE 'https://www.instagram.com/p/%' ORDER BY posted_at DESC NULLS LAST LIMIT $1",[n]);
    return r.rows;
  }
  async function readStatus() {
    await initialize();
    const r=await pool.query("SELECT username,last_scan_at,last_status FROM gaetano_research_scans ORDER BY username LIMIT 8");
    return {scans:r.rows};
  }
  return { scan,readArchive,readStatus,readPublicSources };
}
