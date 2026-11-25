# 888 Space 888 — Meta permissions and relationship capability runbook

This is the operating record for the public professional Instagram account \`@888.gaetano.888\`. It describes provider-supported actions, not permission to circumvent the Instagram UI, scrape private endpoints, or bulk-contact strangers. Do not insert the creator's personal identity or account details in a public review video or open documentation.

## Already verified

- Meta App professional Instagram login via existing Site plugin (Unified Login); signature-verified inbound DMs and replies observed.
- Single original JPEG published from the Site publisher and provider-owned media receipt confirmed: \`https://www.instagram.com/p/DgKe4z7DqVc/\`.
- A read of that owned post's comments via \`instagram_manage_comments\` succeeded, with zero comments at the time checked. This does **not** prove Advanced Access is approved.
- Separate Facebook Login access to a linked Facebook Page and Business Discovery, with Instagram credentials encrypted server-side.
- Research and account data live behind a separate Render gateway. The account can be read via its read-only public pulse and capabilities routes.
- Metricool connected to the correct professional Instagram account for permitted publishing and analytics; it does **not** supply undocumented follow or cold-DM API methods.

## Verified provider documentation

- IG User and permitted edges: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
- Instagram webhooks and @mentions: https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram/
- Meta Instagram API reference in official Postman workspace: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api

## New read-only capability check

\`GET /public/interaction-capabilities\` exposes only scope booleans and the limitations of this installation. It never discloses OAuth tokens or Facebook identities. It does **not** establish that App Review or webhook subscriptions are complete.

The separate permission grant flow \`GET /auth/facebook/mentions/start\` requests:
- \`instagram_manage_comments\`
- \`pages_manage_metadata\`
- plus the previously used read permissions.

After login, the callback verifies the exact app-scoped user, professional Instagram account and linked Facebook Page, and refuses to store a refreshed token if either new permission was declined. Do not relink the Site's existing Unified Login credentials, or switch the app's existing webhook URL without a migration plan.

## Limited, official reply-to-@mention ability

The gateway supports \`POST /internal/mention-reply\` under an **independent server-only** \`MENTION_WRITE_KEY\`; this is not a public/browser endpoint. It:

1. Accepts only bounded numeric \`mediaId\`, optional \`commentId\`, and a short original response.
2. Checks the Facebook token's currently granted \`instagram_manage_comments\` and \`pages_manage_metadata\` permissions.
3. Uses Meta's \`mentioned_media\` or \`mentioned_comment\` field to confirm an actual reference to \`@888.gaetano.888\`; arbitrary targets are rejected.
4. Reserves the target in PostgreSQL before attempting a **single** \`POST /{IG_USER_ID}/mentions\`; duplicate or uncertain sends are never blindly repeated.
5. Limits first attempts to five per 24 hours. No automatic source discovery, auto-commenting, cold DMs, follows or interaction with private accounts are implemented.

Never share or expose the write key in browser JavaScript, logs, GitHub, public prompts or URLs. No external reply has been sent through this new method until an actual provider receipt can be verified.

## Latest implemented provider-backed steps — 25 November 2026

The gateway now exposes:

- GET /public/interaction-capabilities: granted scope status without secrets; this does **not** prove Advanced Access or webhooks.
- GET /auth/facebook/mentions/start: dedicated permission-grant flow for instagram_manage_comments and pages_manage_metadata, using the same verified Facebook Login callback. A declined grant leaves the prior token unchanged. A successful callback records the new scope state immediately in the private database.
- POST /internal/mention-reply: single provider-verified reply to an actual @888.gaetano.888 mention under an independent server-only bearer, bounded and deduplicated.
- GET/POST /webhooks/instagram-mentions: **passive** event receiver with exact Meta HMAC verification (X-Hub-Signature-256), limited to the known Gaetano Instagram account; requires a separate private verify token. No messages are sent by this receiver.
- GET /internal/mention-queue: private, limited queue of signed event identifiers only. No captions, account owners or comments are exposed.
- GET /public/hashtag-research: experimental, bounded source index for three explicit hashtags (mailart, artistbooks, conceptualart). May be unavailable without Meta Instagram Public Content Access review. No inaccessible media or follow relationship may be inferred from that status.

**Important deployment nuance:** The new webhook endpoint exists and passes signed-payload startup checks, but Meta is *not yet configured to deliver events here*. The existing Site Unified Login webhook has its own callback and must not be replaced before a tested, signed fan-out relay or a genuinely separate supported subscription is verified. Page subscription and App Review are also unverified. The provider tests remain read-only until actual event and grant receipts exist.

**Authorized interactive social actions:** Where the Graph API does not expose follows, unsolicited DMs or ordinary third-party commenting, use a logged-in Instagram browser session in ChatGPT Work mode when available. The interactive agent should inspect the exact profile/post, select an action grounded in Gaetano's Practice, avoid bulk outreach, and verify Instagram actually acknowledges the action. A draft or opened profile is not a completed action.

## Remaining Meta account setup

These steps require the application's genuine administrator in Meta Developers. They **cannot** be inferred from a successful read:

1. Reauthorize Facebook Login for the two new permissions using the gateway's explicit mention-authorize link, if offered to the app administrator.
2. In Meta App Review, verify/request Advanced Access for relevant Instagram comments, mentions and Page metadata permissions. Provide the actual app-owned post, a real test @mention, permission rationale, and a short video that demonstrates the flow without revealing creator identity.
3. Confirm Meta Business verification and app Live status requirements for production webhooks. Inspect actual dashboard state before declaring any permission approved.
4. Configure/subscribed \`mentions\` on the correct Instagram webhook object, and enable the linked Facebook Page's \`subscribed_apps\`. Meta lists \`instagram_manage_comments\`, \`pages_manage_metadata\`, and one of \`pages_read_engagement\`/\`pages_show_list\` for this flow.
5. **Do not replace the existing Unified Login Site webhook URL.** If only a single callback URL can be configured, move to a verified signed relay/fan-out with replay-safe deduplication, testing both old inbox and new mentions before switching provider settings.
6. Wait for a real @mention event and verified provider action to establish end-to-end delivery. Do not insert fabricated @mentions into public art or spam other accounts to trigger testing.

## Actions that are not exposed by the installed official API

- Follow arbitrary Instagram accounts.
- Like/comment on arbitrary outside posts without a qualifying @mention.
- Send unsolicited new DMs to people who have not initiated a permitted conversation.
- Set the Instagram profile picture using the Instagram Graph API.

Those actions require Instagram's **authorized interactive interface**, typically a creator-controlled session. Never use private Instagram mobile endpoints, credential sharing in terminal or headless anti-detection bots to bypass limits. Work mode's authorized browser can assist with interactive sessions, subject to the platform's controls and explicit user login; the present connector cannot perform those UI actions.

## Artist's selection, not the assistant's

An assistant-generated stylized bust from 25 Nov 2026 was an **unadopted candidate**, not a choice made by Gaetano nor the profile image uploaded to Instagram. For a true avatar decision, compare verified self-portrait renders from Gaetano's saved 3D world with original typographic/nonfigurative alternatives. Record in public Practice what each communicates, which uncertainty remains, and a defensible selection. Changing the actual profile photo requires Instagram's interface after the selection; never claim the API made that change.

## Privacy and spending

Do not publicly reveal the creator's identity, personal/business information, contact details, accounts or relationships in any media, review video, account settings, logs or correspondence. Only share strictly necessary shipping details with a verified provider when arranging actual physical deliveries. No new spending occurs from any research or mention-reply diagnostics. All complete physical art projects retain the cumulative US$100 cap and require verified available funds.
