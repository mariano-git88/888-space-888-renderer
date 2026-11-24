# Gaetano's unattended renderer

This is a production media worker for **888 Space 888**. Each invocation claims at
most one saved job, opens the public `/capture` scene with a new credential-free
browser, renders its frozen world snapshot, validates the resulting media and
submits the artifact to the Site. It then exits. It does not advance the world,
call a model, publish to Instagram or spend an art project's funds.

## What is implemented

- One authenticated Node-side `POST /api/renderer/claim`; uncertain claims are not
  retried. A `job: null` response exits without starting Chromium.
- The exact SHA-256 of UTF-8 `JSON.stringify(state)` is checked before rendering.
  Scene version and world minute must match the capture result.
- The job lease expires after 15 minutes on the server. This worker has a
  five-minute job deadline and a six-minute process watchdog. It will not start
  or retry work against an expired lease.
- Only public `{ state, camera }` and `{ kind, camera }` arguments enter the
  browser. Service/lease tokens stay in Node; no owner cookies, storage state or
  authentication headers are provided. Browser requests are restricted to GETs
  on the configured origin, and `/api` requests are blocked.
- JPEG photos are 1080 × 1350. Reels are normalized with FFmpeg to H.264,
  `yuv420p`, 1080 × 1920, 24fps, approximately eight seconds and MP4 faststart.
  FFprobe independently verifies output dimensions, codec and video duration.
- Source and final files may not exceed 24 MiB. Temporary files have no persistent
  storage dependency and are removed after each job.
- Completion uploads retry at most three times with the **same bytes, digest,
  lease and headers**. A matching succeeded-job receipt is required. An uncertain
  completion is not rewritten as a failure. Other failures send only one of the
  four approved machine codes.
- Logs contain fixed event names and timing/size measurements. Provider error
  bodies, browser messages, snapshots, service tokens and lease tokens are never
  logged. `maxRssKiB` describes the Node process, not total browser/container RAM.

## Runtime and versions

The Docker image is pinned to `mcr.microsoft.com/playwright:v1.64.1-noble`, and
`package.json` / `package-lock.json` pin Playwright and Playwright Core to
**1.64.1**. The browser package and image version must be upgraded together.
Microsoft's current stable Docker documentation and the release tag were checked
on **2026-11-24**. The image supplies the browser binaries and their dependencies;
the npm package is installed separately with `npm ci`.

FFmpeg and Tini are installed from the base image's Ubuntu package repositories.
Their exact package versions are therefore resolved during the Docker build,
rather than claimed as immutable here. The service runs as the image's non-root
`pwuser`. Render does not expose Docker seccomp/user-namespace options through
this deployment interface, so Chromium's process sandbox is explicitly disabled.
This worker only visits its own trusted capture origin and is not a general
web-browsing worker. Software WebGL is explicitly selected; GPU acceleration is
not assumed.

## Local verification without a browser

From this directory:

```sh
node --test tests/*.test.mjs
```

The tests use fake HTTP responses, a fake browser and fake media subprocesses.
They need neither service credentials nor an installed Playwright browser. They
cover no-job behavior, expiry, snapshot corruption, deadlines, idempotent upload
retries, receipt verification, failure sanitization and credential isolation.

When FFmpeg and FFprobe are already installed, `npm run test:media` additionally
generates temporary synthetic JPEG/WebM fixtures, runs the real normalization
pipeline and checks the output MP4's duration and faststart atom order. It does
not launch a browser, access the Site or benchmark 3D rendering.

For a real runtime build, build this directory as the Docker context:

```sh
docker build --tag gaetano-renderer:0.1.0 services/renderer
```

Run a prepared local environment file only after the Site's queue and capture
endpoint are available:

```sh
docker run --rm --env-file /secure/path/gaetano-renderer.env gaetano-renderer:0.1.0
```

There is no HTTP listener and no required public port. Do not run this package as
a Render web service merely to obtain a process; use a cron job.

## Dedicated public repository

This package is intended for a dedicated public repository. The project owner
explicitly approved public source on 2026-11-24. Publish only the worker package,
lockfile, tests and placeholder configuration. Do not include real environment
values, account information, personal data, private correspondence, world
snapshots or generated artifacts. The repository needs `main` with a committed
Dockerfile before Render can build it.

When publishing this package at the repository root, include `.gitignore`,
`.dockerignore` and the placeholder-only `.env.example`. If it is maintained as a
subdirectory instead, set `services/renderer` as Docker context and
`services/renderer/Dockerfile` as the Dockerfile path.

## Render cron deployment

The dedicated Render workspace is **888space888**, verified on 2026-11-24.
Use that workspace for the renderer and keep credentials in service environment
settings. A configured service is not proof of a completed render: use the
benchmark procedure below to verify actual execution and output.

After the workspace and dedicated repository are confirmed, create a new cron
job with these settings:

| Setting | Value |
| --- | --- |
| Name | `gaetano-renderer` |
| Repository | The dedicated public renderer repository |
| Branch | `main` |
| Runtime | Docker |
| Docker context | `.` when this package is the repository root |
| Dockerfile | `./Dockerfile` |
| Docker command | Leave unset; image CMD runs `node worker.mjs --once` |
| Schedule | `*/5 * * * *` (UTC) |
| Compute | `2c-4g` for the first measured benchmark |
| Region | Frankfurt, unless the verified existing deployment warrants another |
| Automatic deploys | Enabled for the worker's dedicated branch |

The exposed Render cron-creation tool supports these source-based Docker
settings. It does **not** support creating a cron job from a prebuilt image;
that is a separate dashboard/API path. Do not create a Blueprint or public web
service for this first scheduled renderer.

Set the three environment values from `.env.example` in Render's Environment
settings. Generate the scoped renderer credential during installation and set the
corresponding secret/verifier in Sites using its secure configuration path. Never
paste it into chat, print it, commit it or reference it as a Docker build argument.
Merge environment updates; do not replace unrelated settings. No model-provider
credential is required.

With automatic deployments enabled, a code push already starts deployment. Wait
for that deployment to be live before manually testing the cron job. Starting a
manual run may cancel an active run, so use the connector's default
`cancelActiveRun: false` and do not repeatedly trigger it.

Render cron guarantees one active run per service, does not provide a persistent
disk and ends runs after 12 hours. Our shorter application deadline is still
necessary. Durable job state and artifacts reside in D1 and R2 through the Site,
not in the cron container.

### Benchmark and rollout gate

Queue one known photo and then one known reel. Record elapsed/render/encode/upload
times, uploaded bytes, image dimensions, actual video duration and container
memory/CPU from Render. Independently verify the matching succeeded receipt and
stored artifact in the Site. Confirm the next scheduled invocation runs without
an open user browser. Test a restart/expired lease without duplicate artifacts
before expanding the schedule or transferring any independent cognition.

Cron compute is billed for active running time and has a US$1 monthly minimum
per cron service. Check Render's current pricing before changing compute plans.
Workspace, build/network and storage charges are separate where applicable.
Measure this worker before changing its compute allocation; prices do not
establish throughput. Infrastructure costs and the cumulative art-project
budget are separate accounting categories.

## HTTP contract

Claim body: `{ "workerId": "gaetano-renderer-01" }`. The response is
`{ "job": null }` or a job with `id`, `leaseToken`, `leaseUntil` (epoch ms),
`attempt`, `kind`, `camera`, `sceneVersion`, `state`, `worldRevision` and
`snapshotSha256`.

Completion uses `POST /api/renderer/jobs/{id}/complete`, a raw JPEG/MP4 body, the
Node-side bearer credential and these headers:

- `X-Render-Lease`
- `Content-Type: image/jpeg` or `video/mp4`
- `X-Content-Sha256`
- `X-Render-Width`, `X-Render-Height`
- `X-Render-Duration-Ms` for a reel
- `X-Renderer-Version: gaetano-renderer/0.1.0`

The completion response must identify the same job with `status: "succeeded"`.
Any returned artifact digest and receipt dimensions/bytes/content type must match
what was uploaded. Exact retries may return `duplicate: true`.

Failure uses the same bearer and lease with `POST /api/renderer/jobs/{id}/fail`
and only `{ "code": "render_failed" | "timeout" | "encode_failed" | "upload_failed" }`.

The public product page exposes asynchronous
`window.gaetanoCapture.initialize(state, camera)` and
`window.gaetanoCapture.capture(kind, camera)`. Initialization must wait for the
real 3D scene, loaded creature GLB and stable camera. It must not read owner
configuration, fetch an evolving world or mutate world state.

## Primary documentation

- [Playwright Docker image and version matching](https://playwright.dev/docs/docker)
- [Playwright 1.64.1 release](https://github.com/microsoft/playwright/releases/tag/v1.64.1)
- [Render Docker deployments and build-secret cautions](https://render.com/docs/docker)
- [Render cron behavior, billing and concurrency](https://render.com/docs/cronjobs)
- [Render compute pricing](https://render.com/pricing)
