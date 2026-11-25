# Gaetano: Meta research gateway

This Node service extends 888 Space 888 with a **separate Facebook Login authorization** for read-only Business Discovery. It does not alter the existing Instagram Unified Login, webhook, replies, media publishing or world clock.

## Safety

- Never add tokens, app secrets, owner IDs, mailbox data, or private content to GitHub or to public logs.
- The callback validates the exact authorized Facebook app-scoped user, the exact 888space888 Facebook Page, and the linked @888.gaetano.888 professional Instagram account.
- It checks all five permissions, seals the exchanged longer-lived token using AES-256-GCM, and stores the ciphertext in an isolated PostgreSQL database.
- The internal status and research endpoints require an independent bearer key; external research names must appear in an allowlist, with a maximum of five posts per query and a modest hourly limit.
- The output distinguishes captions from actually inspected images. It never follows, comments, sends messages or publishes.
- Access expires or can be revoked. It must be reauthorized when expired; there is no guaranteed everlasting token.
- This code is only the gateway. It still requires a secure integration from the Site agent and a recurring research schedule to constitute unattended research.

## Render

Deploy an independent **Node web service** from branch \`gaetano-meta-research\` of \`mariano-git88/888-space-888-renderer\`.

Build: \`npm install --prefix research --omit=dev --no-audit --no-fund\`

Start: \`node research/server.mjs\`

Health: \`GET /health\`.

Configure environment variables **in Render only**:

- \`META_APP_ID\`: existing Meta app identifier for Gaetano
- \`META_APP_SECRET\`: Meta App Settings → Basic secret (never paste into chats)
- \`META_GRAPH_VERSION\`: \`v27.0\`
- \`META_PAGE_ID\`: Page linked to Gaetano
- \`META_IG_ID\`: Instagram professional account
- \`META_IG_USERNAME\`: \`888.gaetano.888\`
- \`OWNER_META_ASID\`: expected **app-scoped Facebook User ID**, privately
- \`META_REDIRECT_URI\`: the exact \`https://<service-host>/auth/facebook/callback\`, registered as a valid Meta Facebook Login for Business redirect
- \`META_LOGIN_CONFIG_ID\`: optional Facebook Login for Business config ID if required
- \`DATABASE_URL\`: internal connection string of the isolated research Postgres
- \`TOKEN_ENCRYPTION_KEY\`: random 32-byte base64 key
- \`RESEARCH_READ_KEY\`: independent strong random bearer token
- \`RESEARCH_ALLOWLIST\`: comma-separated professional artist usernames (default \`micahlexier\`)

Once configured, the owner can visit \`https://<service-host>/auth/facebook/start\` and authorize through the actual Facebook Login screen. A successful callback records a restricted account binding and token expiry.

The private API:
- \`GET /internal/status\`: returns connected or expired state (requires internal bearer).
- \`POST /internal/discover\` with \`{"username":"micahlexier","limit":3}\`: Meta Business Discovery research. It tries image metadata first, then captions-only if the fields are not supported.

Do not place the internal bearer token or raw provider response in any public browser page. Never copy source images into original Gaetano artworks without a license or authorization. The Site's existing research MCP uses the **separate Unified Login token** until a specifically authenticated Site-to-gateway adapter is deployed.

## Verified deployment — 24 November 2026

- Research gateway: `gaetano-meta-research.onrender.com` (Render Frankfurt, Starter).
- Private DB: `gaetano-meta-research-db` (Render Frankfurt). No external IPs added to its allowlist.
- Facebook Login for Business authorization completed; the callback returned its success page after checking the authorized app-scoped user, granted permissions, Facebook Page, linked Instagram account and encrypted token storage.
- The **first independent server-side Business Discovery call succeeded**, logging `gaetano_research_scan_ok count=3 rich_metadata=true`. This means metadata was received, **not** that anyone inspected image pixels.
- The service now checks its approved artist allowlist on startup and at six-hour wakeups, but skips accounts successfully checked in the previous 20 hours. It caches up to three posts per artist privately in PostgreSQL, deduplicated, deleting source posts not reobserved for 14 days.
- Private read endpoints `GET /internal/archive` and `GET /internal/research-status` require an independent bearer. **Do not expose the bearer in URLs, prompts, client-side code or GitHub.**
- The token still expires or can be revoked. Reauthorization may be needed, typically after about 60 days, and the running service must be monitored for `gaetano_research_authorization_expired` or `gaetano_research_scan_unavailable`.
- The site-side `instagram_research_read` tool **still uses Unified Login**, not this service. The archive has not yet been connected to the agent's Site/Practice ingestion path. Its posts are source observations, not completed readings or artistic choices.

## Next integration

Implement a server-to-server adapter inside the existing Site backend that accesses this gateway's archive with an independently managed secret, exposes one read-only research tool to Gaetano's automated agent, and makes reflection/Practice revision optional, not automatic from every caption. This must preserve scope, do no posting or following, and clearly label image URLs as uninspected. Do not force source data into public-facing pages or store OAuth tokens in the Site client.


## Field Study 04: A field made of returns (25 November 2026)

- Public installation: `/field/returns` on the gateway host. A deterministic, original event-based **SVG score**, not the main 3D world.
- Its starting journal snapshot has 17 publicly recorded simulation events, j_1268 through j_1289. The source ledger, event IDs, minutes and complete text remain visible. Horizontal distance represents elapsed simulated minutes; vertical grouping is a compositional convention, **not map coordinates**.
- The four arrangements vary daily. The versioned artistic rule in `field-rules.mjs` can deliberately withhold some marks to expose intervals. Every withheld event stays in the source ledger. The rule is tied to the saved Practice review `artreview_41d4e8023d95c211bfa604bd`, 'A return is not an arrival.' A decision to return is not a confirmed visit.
- `field-sources.mjs` contains only grounded public-world journal records. A daily ChatGPT automation can propose and write new snapshots **only** after actually reading the Site world history and validating event IDs, chronological minutes and text; do not fabricate records or insert creator/private information.
- The service runs `verifyCreativeRelease` at boot. It validates source integrity, reproducibility, privacy-sensitive source cues, and that the score remains anchored in actual event IDs. Runtime checks do not replace pixel inspection in a browser.
- Separate `/lab/two-events` remains a reversible typographic experiment based on two simultaneous archived events, without claiming that the main world changed.

## Caption-safe Instagram source cues

The public `/public/research-sources` endpoint provides public Instagram permalinks and a very small, fixed vocabulary of caption-term matches (`sourceCues`). It never exposes copied captions, media URLs, account bearer tokens, private DMs, creator details, or images. `cueBasis: unverified_caption_keyword_match` means **only** that a public caption contained matching terms; it is not source verification, visual inspection, or Gaetano's artistic conclusion. The scheduled research agent must visit available original sources and decide whether independent, evidence-backed Practice notes are warranted. A cue can be false or uninformative.
