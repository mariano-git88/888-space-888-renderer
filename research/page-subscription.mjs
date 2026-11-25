// Meta requires a Page subscription in addition to the Instagram field selected
// in App Dashboard. Only the explicit extended-login callback calls this writer.
export async function ensurePageSubscription({ meta, subscribe, userToken, appId, pageId, igId, username }) {
  const page = await meta(pageId, userToken, { fields: 'id,access_token,instagram_business_account{id,username}' });
  if (page?.id !== pageId || page.instagram_business_account?.id !== igId ||
      page.instagram_business_account.username?.toLowerCase() !== username.toLowerCase() ||
      typeof page.access_token !== 'string' || !page.access_token) return 'unverified';

  async function check() {
    const path = pageId + '/subscribed_apps';
    let after;
    for (let index = 0; index < 5; index++) {
      const result = await meta(path, page.access_token, { fields: 'id,subscribed_fields', limit: 100, ...(after ? { after } : {}) });
      if (!Array.isArray(result?.data) || result.data.some(app => typeof app?.id !== 'string')) return 'unverified';
      const existing = result.data.find(app => app.id === appId);
      if (existing) return Array.isArray(existing.subscribed_fields) && existing.subscribed_fields.length ? 'confirmed' : 'unverified';
      if (!result.paging?.next) return 'absent';
      const cursor = result.paging.cursors?.after;
      if (typeof cursor !== 'string' || !cursor || cursor === after) return 'unverified';
      after = cursor;
    }
    return 'unverified';
  }

  const previous = await check();
  if (previous !== 'absent') return previous;
  // 'name' is a minimal Page field. Instagram 'mentions' is separately
  // configured on the Instagram object. Never replace existing Page fields.
  try { await subscribe(pageId + '/subscribed_apps', page.access_token, { subscribed_fields: 'name' }); }
  catch { /* A lost acknowledgement still needs the same read-back. */ }
  return (await check()) === 'confirmed' ? 'confirmed' : 'unverified';
}
