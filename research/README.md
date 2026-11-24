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

## Deployment status

Gateway implementation prepared; full credential setup, redirect approval, authorization and live end-to-end testing remain to be completed. A deployed HTTP service does not imply Meta is connected.
