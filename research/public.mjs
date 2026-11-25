/**
 * Safe list of third-party source links for the authorized art researcher.
 * Intentional publication of links, never copied captions, token material,
 * image URLs, owners, private comments or platform account IDs.
 */
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
      publishedAt:x.posted_at?new Date(x.posted_at).toISOString():null}))
 };
}
