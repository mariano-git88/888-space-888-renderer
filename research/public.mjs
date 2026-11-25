/**
 * Safe list of third-party source links for the authorized art researcher.
 * Intentional publication of links, never copied captions, token material,
 * image URLs, owners, private comments or platform account IDs.
 */
// Small, fixed vocabulary. These are machine-matched source cues, not verified
// visual inspection, a published caption, or a learned artistic conclusion.
export function captionCues(caption){
 const s=typeof caption==='string'?caption.slice(0,6000):'';
 const matchers=[
  ['counted-language',/\b(letter.count|letter count|letter-count|strict.{0,30}letter|count.{0,20}restriction)\b/i],
  ['printed-matter',/\b(envelopes?|stationery|paper|postcards?|stickers?)\b/i],
  ['physical-multiples',/\b(multiples?|editions?|minted|coins?|cast objects?)\b/i],
  ['collaborative-authorship',/\b(collaboration|collaborations|collaborator|collaborative|collaborated)\b/i],
  ['material-lettering',/\b(stainless.steel|metal letters?|letterforms?)\b/i],
  ['public-conversation',/\b(lecture|talk|panel discussion|public conversation)\b/i],
  ['found-materials',/\b(old stock|found materials?|found objects?|second.hand)\b/i]
 ];
 return matchers.filter(([,pattern])=>pattern.test(s)).map(([label])=>label).slice(0,4);
}

export function publicSourceManifest(records,limit=12){
 const n=Number.isInteger(limit)?Math.max(1,Math.min(12,limit)):12;
 return {
   project:'888 Space 888',
   purpose:'Source links for art research. Not artworks by Gaetano or proof of following or visual inspection.',
   sources:(Array.isArray(records)?records:[])
    .filter(x=>typeof x?.username==='string' && /^[A-Za-z0-9_.]{1,30}$/.test(x.username)
       && typeof x?.permalink==='string' && /^https:\/\/www\.instagram\.com\/p\/[A-Za-z0-9_-]+\/?$/.test(x.permalink))
    .slice(0,n)
    .map(x=>({username:x.username,permalink:x.permalink,mediaType:x.media_type||null,
      publishedAt:x.posted_at?new Date(x.posted_at).toISOString():null,
      sourceCues:captionCues(x.caption),cueBasis:'unverified_caption_keyword_match'}))
 };
}


// Public source diagnostics: no provider errors, tokens, private identities,
// messages, captions or account numeric identifiers.
export function publicResearchHealth(scans,approved){
  const safe=new Set([...approved].filter(x=>/^[a-zA-Z0-9_.]{1,30}$/.test(x)).map(x=>x.toLowerCase()));
  const byName=new Map((Array.isArray(scans)?scans:[]).filter(x=>safe.has(String(x.username).toLowerCase()))
    .map(x=>[x.username.toLowerCase(),x]));
  return {
    source:'Meta Business Discovery research gateway',
    scope:'Professional accounts only. A failed read is not evidence of a non-professional account or blocked permission.',
    accounts:[...safe].sort().map(username=>{
      const r=byName.get(username);
      const status=r?.last_status==='ok'?'observed':r?.last_status==='unavailable'?'unavailable':'not_checked';
      const date=r?.last_scan_at ? new Date(r.last_scan_at) : null;
      return {username,status,lastAttemptAt:date && Number.isFinite(date.getTime())?date.toISOString():null};
    })
  };
}
