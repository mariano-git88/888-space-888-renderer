import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import { runOnce } from "../worker.mjs";
import { captureJob } from "../lib/capture.mjs";
import { normalizeCapture } from "../lib/media.mjs";
import { completeJob } from "../lib/api.mjs";
import { loadConfig, logEvent, safeChildEnvironment, sha256, WorkerError, SCENE_VERSION, RENDERER_VERSION } from "../lib/common.mjs";

const TOKEN = "test-service-token-that-must-never-reach-browser";
const LEASE = "test-lease-token-that-must-never-reach-browser";
const CONFIG = { origin: "https://www.888space888.com", token: TOKEN, workerId: "test-worker" };
const TIME = 1_800_000_000_000;
const STATE = { worldMinute: 1234, day: 1, creature: { position: { x: 1, z: 2 } } };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 0xff, 0xd9]);

function job(overrides = {}) {
  return {
    id: "render-job-01", leaseToken: LEASE, leaseUntil: TIME + 15 * 60 * 1000,
    attempt: 1, kind: "photo", camera: "scene", sceneVersion: SCENE_VERSION,
    state: STATE, worldRevision: 7, snapshotSha256: sha256(JSON.stringify(STATE)), ...overrides,
  };
}
function capture(overrides = {}) {
  return { base64: JPEG.toString("base64"), mimeType: "image/jpeg", width: 1080, height: 1350,
    worldMinute: STATE.worldMinute, sceneVersion: SCENE_VERSION, ...overrides };
}
function artifact(overrides = {}) {
  return { bytes: JPEG, sha256: sha256(JPEG), mimeType: "image/jpeg", width: 1080, height: 1350, ...overrides };
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
function receipt(current = job(), media = artifact()) {
  return { job: { id: current.id, status: "succeeded", receipt: {
    sha256: media.sha256, byteLength: media.bytes.length, contentType: media.mimeType,
    width: media.width, height: media.height, rendererVersion: RENDERER_VERSION,
    completedAt: TIME + 1, artifactPath: `/api/renderer/jobs/${current.id}/artifact`,
    snapshotSha256: current.snapshotSha256, worldRevision: current.worldRevision, sceneVersion: current.sceneVersion,
    ...(media.durationMs === undefined ? {} : { durationMs: media.durationMs }),
  } }, duplicate: false };
}
function deps(extra = {}) {
  return { now: () => TIME, logger: () => {}, capture: async () => capture(), normalize: async () => artifact(), sleep: async () => {}, ...extra };
}

test("configuration accepts only a clean HTTPS origin (explicit loopback HTTP is separate)", () => {
  assert.deepEqual(loadConfig({ GAETANO_RENDERER_TOKEN: TOKEN }), { ...CONFIG, workerId: "gaetano-renderer-01" });
  for (const origin of ["https://user:password@example.com", "https://example.com/private", "https://example.com/?secret=x", "http://example.com"]) {
    assert.throws(() => loadConfig({ GAETANO_RENDERER_TOKEN: TOKEN, GAETANO_SITE_ORIGIN: origin }), /configuration_invalid/);
  }
  assert.equal(loadConfig({ GAETANO_RENDERER_TOKEN: TOKEN, GAETANO_SITE_ORIGIN: "http://127.0.0.1:3000", GAETANO_ALLOW_LOCAL_HTTP: "1" }).origin, "http://127.0.0.1:3000");
});

test("a no-job response exits after exactly one claim and launches no browser", async () => {
  const calls = [];
  const result = await runOnce(CONFIG, deps({
    fetchImpl: async (url, options) => { calls.push({ url, options }); return json({ job: null }); },
    capture: () => assert.fail("browser launched without a job"),
  }));
  assert.equal(result.status, "no_job");
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.body), { workerId: CONFIG.workerId });
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].options.redirect, "error");
});

test("an expired lease never renders, uploads, or reports failure against that lease", async () => {
  let calls = 0;
  const result = await runOnce(CONFIG, deps({
    fetchImpl: async () => { calls++; return json({ job: job({ leaseUntil: TIME - 1 }) }); },
    capture: () => assert.fail("expired lease rendered"),
  }));
  assert.equal(result.code, "lease_expired");
  assert.equal(calls, 1);
});

test("snapshot corruption is rejected before browser injection", async () => {
  const result = await runOnce(CONFIG, deps({
    fetchImpl: async () => json({ job: job({ snapshotSha256: "a".repeat(64) }) }),
    capture: () => assert.fail("invalid snapshot rendered"),
  }));
  assert.equal(result.code, "invalid_job");
});

test("a genuine receipt is required before reporting success", async () => {
  const logs = [];
  const calls = [];
  const result = await runOnce(CONFIG, deps({ logger: record => logs.push(record), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return json(url.endsWith("/claim") ? { job: job() } : receipt());
  } }));
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.body, JPEG);
  assert.equal(calls[1].options.headers["X-Content-Sha256"], sha256(JPEG));
  assert.equal(calls[1].options.headers["X-Render-Lease"], LEASE);
  assert.equal(logs[0].event, "job_succeeded");
  assert.equal(JSON.stringify(logs).includes(TOKEN), false);
  assert.equal(JSON.stringify(logs).includes(LEASE), false);
});

test("upload retries reuse the identical body, digest, lease and endpoint", async () => {
  const calls = [];
  let uploads = 0;
  const result = await runOnce(CONFIG, deps({ fetchImpl: async (url, options) => {
    if (url.endsWith("/claim")) return json({ job: job() });
    calls.push({ url, options });
    uploads++;
    return uploads === 1 ? json({ error: `upstream leaked ${TOKEN}` }, 503) : json(receipt());
  } }));
  assert.equal(result.status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.equal(calls[0].options.body, calls[1].options.body);
  assert.deepEqual(calls[0].options.headers, calls[1].options.headers);
});

test("HTTP 200 with wrong receipt stays unconfirmed after bounded retries; it cannot overwrite success with failure", async () => {
  const calls = [];
  const logs = [];
  const result = await runOnce(CONFIG, deps({ logger: record => logs.push(record), fetchImpl: async url => {
    calls.push(url);
    if (url.endsWith("/claim")) return json({ job: job() });
    const wrong = receipt();
    wrong.job.receipt.sha256 = "f".repeat(64);
    return json(wrong);
  } }));
  assert.equal(result.status, "failed");
  assert.equal(result.uncertain, true);
  assert.equal(calls.filter(url => url.endsWith("/complete")).length, 3);
  assert.equal(calls.some(url => url.endsWith("/fail")), false);
  assert.equal(logs[0].event, "completion_unconfirmed");
});

test("mismatched receipt identity cannot be considered a completed job", async () => {
  const wrong = receipt();
  wrong.job.id = "another-job";
  await assert.rejects(completeJob(CONFIG, job(), artifact(), { now: () => TIME, sleep: async () => {}, fetchImpl: async () => json(wrong) }), /upload_failed/);
});

test("missing receipt or missing digest stays uncertain and never reports success", async () => {
  for (const removeReceipt of [true, false]) {
    const partial = receipt();
    if (removeReceipt) delete partial.job.receipt;
    else delete partial.job.receipt.sha256;
    const calls = [];
    const logs = [];
    const result = await runOnce(CONFIG, deps({ logger: record => logs.push(record), fetchImpl: async url => {
      calls.push(url);
      return json(url.endsWith("/claim") ? { job: job() } : partial);
    } }));
    assert.equal(result.status, "failed");
    assert.equal(result.code, "upload_failed");
    assert.equal(result.uncertain, true);
    assert.equal(calls.filter(url => url.endsWith("/complete")).length, 3);
    assert.equal(calls.some(url => url.endsWith("/fail")), false);
    assert.equal(logs.some(record => record.event === "job_succeeded"), false);
  }
});

test("receipt requires complete matching artifact and snapshot provenance plus a valid completion time", async () => {
  const required = ["byteLength", "contentType", "width", "height", "rendererVersion", "artifactPath", "snapshotSha256", "worldRevision", "sceneVersion", "completedAt"];
  const invalid = required.map(key => {
    const value = receipt();
    delete value.job.receipt[key];
    return value;
  });
  for (const overrides of [
    { snapshotSha256: "e".repeat(64) }, { worldRevision: 8 }, { sceneVersion: "other-scene" },
    { completedAt: 0 }, { completedAt: "2026-11-24T00:00:00Z" }, { completedAt: 8_640_000_000_000_001 },
    { completedAt: job().leaseUntil }, { durationMs: 8000 },
  ]) {
    const value = receipt();
    Object.assign(value.job.receipt, overrides);
    invalid.push(value);
  }
  for (const value of invalid) {
    await assert.rejects(completeJob(CONFIG, job(), artifact(), {
      now: () => TIME, sleep: async () => {}, fetchImpl: async () => json(value),
    }), error => error instanceof WorkerError && error.code === "upload_failed" && error.uncertain === true);
  }
});

test("a reel receipt requires the exact measured duration", async () => {
  const current = job({ kind: "reel" });
  const media = artifact({ mimeType: "video/mp4", height: 1920, durationMs: 8000 });
  await completeJob(CONFIG, current, media, { now: () => TIME, fetchImpl: async () => json(receipt(current, media)) });
  for (const durationMs of [undefined, null, 7999, "8000"]) {
    const value = receipt(current, media);
    value.job.receipt.durationMs = durationMs;
    await assert.rejects(completeJob(CONFIG, current, media, {
      now: () => TIME, sleep: async () => {}, fetchImpl: async () => json(value),
    }), error => error instanceof WorkerError && error.code === "upload_failed" && error.uncertain === true);
  }
});

test("a photo receipt may omit duration or explicitly return null", async () => {
  const saved = receipt();
  saved.job.receipt.durationMs = null;
  await completeJob(CONFIG, job(), artifact(), { now: () => TIME, fetchImpl: async () => json(saved) });
});

test("a permanent upload rejection is not retried and sends a generic upload_failed", async () => {
  const calls = [];
  const result = await runOnce(CONFIG, deps({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/claim")) return json({ job: job() });
    return url.endsWith("/complete") ? json({ internal: TOKEN }, 422) : json({});
  } }));
  assert.equal(result.code, "upload_failed");
  assert.equal(calls.filter(item => item.url.endsWith("/complete")).length, 1);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { code: "upload_failed" });
});

test("a lease expiring between upload retries prevents another network attempt", async () => {
  let now = TIME;
  let calls = 0;
  await assert.rejects(completeJob(CONFIG, job(), artifact(), {
    now: () => now, sleep: async () => { now = TIME + 16 * 60 * 1000; },
    fetchImpl: async () => { calls++; return json({}, 503); },
  }), /lease_expired/);
  assert.equal(calls, 1);
});

test("claim network errors are never retried and their content is not logged", async () => {
  const logs = [];
  let calls = 0;
  const result = await runOnce(CONFIG, deps({ logger: record => logs.push(record), fetchImpl: async () => {
    calls++; throw new Error(`private payload ${TOKEN} ${LEASE}`);
  } }));
  assert.equal(result.code, "claim_failed");
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(logs).includes(TOKEN), false);
});

test("browser errors send only the approved generic failure code", async () => {
  const calls = [];
  const logs = [];
  const result = await runOnce(CONFIG, deps({ logger: record => logs.push(record),
    capture: async () => { throw new Error(`https://private.example/?token=${TOKEN} ${LEASE}`); },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return json(url.endsWith("/claim") ? { job: job() } : {});
    },
  }));
  assert.equal(result.code, "render_failed");
  assert.deepEqual(JSON.parse(calls[1].options.body), { code: "render_failed" });
  assert.equal(JSON.stringify(logs).includes(TOKEN), false);
  assert.equal(JSON.stringify(logs).includes("private.example"), false);
});

test("the job deadline aborts a stuck capture and reports timeout once", async () => {
  const calls = [];
  const result = await runOnce(CONFIG, deps({ jobTimeoutMs: 15,
    capture: () => new Promise(() => {}),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return json(url.endsWith("/claim") ? { job: job() } : {}); },
  }));
  assert.equal(result.code, "timeout");
  assert.deepEqual(JSON.parse(calls[1].options.body), { code: "timeout" });
});

test("the product browser receives only public snapshot arguments and a credential-free environment", async () => {
  const recorded = { evaluations: [] };
  const page = {
    on() {},
    setDefaultTimeout() {},
    goto: async (url, options) => { recorded.navigation = { url, options }; return { ok: () => true }; },
    url: () => `${CONFIG.origin}/capture`,
    waitForFunction: async () => {},
    evaluate: async (_fn, args) => { recorded.evaluations.push(args); return Object.hasOwn(args, "kind") ? capture() : undefined; },
  };
  const context = { route: async (_pattern, handler) => { recorded.route = handler; }, newPage: async () => page };
  const browser = { newContext: async options => { recorded.context = options; return context; }, close: async () => { recorded.closed = true; } };
  const chromium = { launch: async options => { recorded.launch = options; return browser; } };
  const result = await captureJob(CONFIG, job(), { chromium, signal: new AbortController().signal,
    browserEnvironment: { PATH: "/usr/bin", HOME: "/home/pwuser", GAETANO_RENDERER_TOKEN: TOKEN, AWS_SECRET_ACCESS_KEY: "private", DEBUG: "pw:*", NODE_OPTIONS: "--inspect" },
  });
  assert.deepEqual(result, capture());
  assert.deepEqual(recorded.evaluations, [{ state: STATE, camera: "scene" }, { kind: "photo", camera: "scene" }]);
  assert.deepEqual(recorded.launch.env, { PATH: "/usr/bin", HOME: "/home/pwuser" });
  assert.equal(recorded.context.extraHTTPHeaders, undefined);
  assert.equal(recorded.context.storageState, undefined);
  assert.equal(recorded.closed, true);
  assert.equal(JSON.stringify(recorded).includes(TOKEN), false);
  assert.equal(JSON.stringify(recorded).includes(LEASE), false);
  const exerciseRoute = async (url, method = "GET") => {
    let outcome;
    await recorded.route({ request: () => ({ url: () => url, method: () => method, headers: () => ({ authorization: TOKEN, cookie: "owner=private", accept: "*/*" }) }),
      continue: async options => { outcome = options || "allowed"; }, abort: async () => { outcome = "blocked"; },
    });
    return outcome;
  };
  assert.equal(await exerciseRoute("https://unrelated.example/image.jpg"), "blocked");
  assert.equal(await exerciseRoute(`${CONFIG.origin}/api/world`), "blocked");
  assert.equal(await exerciseRoute(`${CONFIG.origin}/capture`, "POST"), "blocked");
  assert.deepEqual(await exerciseRoute(`${CONFIG.origin}/models/creature-v2.glb`), { headers: { accept: "*/*" } });
});

test("capture initialization failures retain only diagnostic categories and still report the generic API code", async () => {
  const fixtures = [
    { message: "Capture initialization timed out.", reason: "initialize_timeout" },
    { message: "The sculpture asset could not be loaded for this capture.", reason: "asset_failed" },
    { message: "The 3D view needs WebGL.", reason: "webgl_unavailable" },
    { message: "The 3D view was interrupted.", reason: "webgl_context_lost" },
  ];
  for (const fixture of fixtures) {
    let closed = false;
    const page = {
      on() {}, setDefaultTimeout() {},
      goto: async () => ({ ok: () => true }), url: () => `${CONFIG.origin}/capture`,
      waitForFunction: async () => {},
      evaluate: async () => { throw new Error(`${fixture.message} https://private.example/?token=${TOKEN} ${LEASE}`); },
    };
    const browser = { newContext: async () => ({ route: async () => {}, newPage: async () => page }), close: async () => { closed = true; } };
    const calls = [], logs = [];
    const result = await runOnce(CONFIG, deps({
      capture: (config, current, options) => captureJob(config, current, { ...options, chromium: { launch: async () => browser } }),
      logger: record => logs.push(record),
      fetchImpl: async (url, options) => { calls.push({ url, options }); return json(url.endsWith("/claim") ? { job: job() } : {}); },
    }));
    assert.equal(result.code, "render_failed");
    assert.equal(closed, true);
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { code: "render_failed" });
    assert.equal(logs[0].capturePhase, "initialize");
    assert.equal(logs[0].captureReason, fixture.reason);
    assert.equal(logs[0].errorName, "Error");
    assert.equal(JSON.stringify(logs).includes(TOKEN), false);
    assert.equal(JSON.stringify(logs).includes(LEASE), false);
    assert.equal(JSON.stringify(logs).includes("private.example"), false);
  }
});

test("an uncaught page error is distinguishable from a readiness timeout without retaining its text", async () => {
  const handlers = {};
  const page = {
    on: (event, handler) => { handlers[event] = handler; }, setDefaultTimeout() {},
    goto: async () => ({ ok: () => true }), url: () => `${CONFIG.origin}/capture`, waitForFunction: async () => {},
    evaluate: async () => { handlers.pageerror(new TypeError(`private ${TOKEN}`)); throw new Error("Capture initialization timed out."); },
  };
  const browser = { newContext: async () => ({ route: async () => {}, newPage: async () => page }), close: async () => {} };
  await assert.rejects(captureJob(CONFIG, job(), { chromium: { launch: async () => browser } }), error => {
    assert.equal(error.code, "render_failed");
    assert.equal(error.capturePhase, "initialize");
    assert.equal(error.captureReason, "page_error");
    assert.equal(error.errorName, "TypeError");
    assert.equal(JSON.stringify(error).includes(TOKEN), false);
    return true;
  });
});

test("reel recording failures have safe categories without leaking browser messages", async () => {
  for (const [message, reason] of [
    ["Recording took too long on this device. Try saving a photo.", "recording_timeout"],
    ["Recording stopped because the world tab was hidden.", "page_hidden"],
    ["This browser does not provide a supported video encoder.", "encoder_unavailable"],
    ["The browser could not finish encoding the clip.", "encoder_failed"],
    ["The browser produced an empty clip.", "empty_clip"],
    ["The clip exceeded the capture size limit.", "media_limit"],
  ]) {
    const page = {
      on() {}, setDefaultTimeout() {}, goto: async () => ({ ok: () => true }),
      url: () => `${CONFIG.origin}/capture`, waitForFunction: async () => {},
      evaluate: async (_fn, args) => { if (args.kind) throw new Error(`${message} ${TOKEN} ${LEASE}`); },
    };
    const browser = { newContext: async () => ({ route: async () => {}, newPage: async () => page }), close: async () => {} };
    await assert.rejects(captureJob(CONFIG, job({ kind: "reel" }), { chromium: { launch: async () => browser } }), error => {
      assert.equal(error.capturePhase, "capture");
      assert.equal(error.captureReason, reason);
      assert.equal(JSON.stringify(error).includes(TOKEN), false);
      assert.equal(JSON.stringify(error).includes(LEASE), false);
      return true;
    });
  }
});

test("diagnostic fields reject values outside their fixed vocabulary", () => {
  const error = new WorkerError("render_failed", { capturePhase: TOKEN, captureReason: LEASE, errorName: "https://private.example" });
  assert.equal(error.capturePhase, undefined);
  assert.equal(error.captureReason, undefined);
  assert.equal(error.errorName, undefined);
  const logs = [];
  logEvent(record => logs.push(record), "job_failed", { capturePhase: TOKEN, captureReason: LEASE, errorName: "https://private.example", message: TOKEN });
  assert.deepEqual(logs, [{ event: "job_failed", rendererVersion: RENDERER_VERSION }]);
});

test("subprocess environments cannot inherit provider tokens or debug settings", () => {
  assert.deepEqual(safeChildEnvironment({ PATH: "/usr/bin", GAETANO_RENDERER_TOKEN: TOKEN, OPENAI_API_KEY: "private", NODE_OPTIONS: "--inspect", DEBUG: "*" }), { PATH: "/usr/bin" });
});

test("a Chromium launch failure does not expose its raw exception", async () => {
  await assert.rejects(captureJob(CONFIG, job(), { signal: new AbortController().signal,
    chromium: { launch: async () => { throw new Error(`launch private ${TOKEN}`); } },
  }), error => error instanceof WorkerError && error.message === "render_failed");
});

test("JPEG output dimensions are verified by ffprobe and temporary files are removed", async () => {
  let input;
  const output = await normalizeCapture(job(), capture(), { runProcess: async (command, args) => {
    assert.equal(command, "ffprobe");
    input = args.at(-1);
    assert.deepEqual(await readFile(input), JPEG);
    return JSON.stringify({ streams: [{ codec_type: "video", codec_name: "mjpeg", width: 1080, height: 1350 }] });
  } });
  assert.deepEqual(output.bytes, JPEG);
  assert.equal(output.sha256, sha256(JPEG));
  await assert.rejects(access(input));
});

test("reel normalization uses H264, yuv420p, faststart and validated eight-second MP4", async () => {
  const commands = [];
  const mp4 = Buffer.from("00000000ftypisom-normalized-media");
  const output = await normalizeCapture(job({ kind: "reel", camera: "selfie" }), capture({
    base64: Buffer.from("webm-source").toString("base64"), mimeType: "video/webm;codecs=vp9", height: 1920, durationSeconds: 8,
  }), { runProcess: async (command, args) => {
    commands.push({ command, args });
    if (command === "ffmpeg") { await writeFile(args.at(-1), mp4); return ""; }
    return JSON.stringify({ streams: [{ codec_type: "video", codec_name: args.at(-1).endsWith("output.mp4") ? "h264" : "vp9", width: 1080, height: 1920, pix_fmt: "yuv420p", avg_frame_rate: "24/1", r_frame_rate: "24/1", nb_frames: "192" }], format: { duration: "8.000000", format_name: "mov,mp4,m4a,3gp,3g2,mj2" } });
  } });
  const args = commands.find(item => item.command === "ffmpeg").args;
  assert.equal(args[args.indexOf("-c:v") + 1], "libx264");
  assert.equal(args[args.indexOf("-vf") + 1], "fps=24,format=yuv420p");
  assert.equal(args[args.indexOf("-movflags") + 1], "+faststart");
  assert.ok(args.includes("-an"));
  assert.equal(output.mimeType, "video/mp4");
  assert.equal(output.durationMs, 8000);
  assert.equal(output.sourceDurationMs, 8000);
  assert.equal(output.averageFps, 24); assert.equal(output.nominalFps, 24); assert.equal(output.frameCount, 192);
  assert.ok(commands.filter(item => item.command === "ffprobe").every(item => item.args.some(value => value.includes("avg_frame_rate,r_frame_rate,nb_frames"))));
  assert.equal(output.sha256, sha256(mp4));
});

test("a bounded longer raw reel is normalized while preserving measured source and capture durations", async () => {
  const result = await normalizeCapture(job({ kind: "reel" }), capture({
    base64: Buffer.from("long-webm-source").toString("base64"), mimeType: "video/webm", height: 1920, durationSeconds: 18.25,
  }), { runProcess: async (command, args) => {
    if (command === "ffmpeg") { await writeFile(args.at(-1), Buffer.from("normalized-mp4")); return ""; }
    const output = args.at(-1).endsWith("output.mp4");
    return JSON.stringify({ streams: [{ codec_type: "video", codec_name: output ? "h264" : "vp9", width: 1080, height: 1920, pix_fmt: "yuv420p", avg_frame_rate: "24/1", r_frame_rate: "24/1", nb_frames: output ? "192" : "432" }], format: { duration: output ? "8.000" : "18.000", format_name: "mov,mp4" } });
  } });
  assert.equal(result.captureDurationMs, 18250);
  assert.equal(result.sourceDurationMs, 18000);
  assert.equal(result.durationMs, 8000);
  assert.equal(result.averageFps, 24); assert.equal(result.frameCount, 192);
});

test("raw reel durations outside the unattended bound are rejected before media processes run", async () => {
  for (const durationSeconds of [0, 6.99, 60.001, Infinity, NaN]) {
    await assert.rejects(normalizeCapture(job({ kind: "reel" }), capture({
      base64: Buffer.from("webm-source").toString("base64"), mimeType: "video/webm", height: 1920, durationSeconds,
    }), { runProcess: () => assert.fail("out-of-bounds source reached a media process") }), /render_failed/);
  }
});

test("normalization rejects a final frame rate or count that disagrees with the required clip", async () => {
  for (const incorrect of [{ avg_frame_rate: "25/1" }, { r_frame_rate: "0/0" }, { nb_frames: "N/A" }, { nb_frames: "1" }]) {
    await assert.rejects(normalizeCapture(job({ kind: "reel" }), capture({
      base64: Buffer.from("webm-source").toString("base64"), mimeType: "video/webm", height: 1920, durationSeconds: 8,
    }), { runProcess: async (command, args) => {
      if (command === "ffmpeg") { await writeFile(args.at(-1), Buffer.from("invalid-mp4")); return ""; }
      const output = args.at(-1).endsWith("output.mp4");
      return JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920, pix_fmt: "yuv420p", avg_frame_rate: "24/1", r_frame_rate: "24/1", nb_frames: "192", ...(output ? incorrect : {}) }], format: { duration: "8.000", format_name: "mov,mp4" } });
    } }), /encode_failed/);
  }
});

test("a false JPEG dimension claim is rejected by independent probe", async () => {
  await assert.rejects(normalizeCapture(job(), capture(), { runProcess: async () => JSON.stringify({ streams: [{ codec_type: "video", codec_name: "mjpeg", width: 1, height: 1 }] }) }), /encode_failed/);
});

test("browser output from a different scene/world minute is rejected before processing", async () => {
  for (const mismatch of [{ worldMinute: STATE.worldMinute + 1 }, { sceneVersion: "other-scene" }]) {
    await assert.rejects(normalizeCapture(job(), capture(mismatch), { runProcess: () => assert.fail("invalid capture processed") }), /render_failed/);
  }
});

test("a truncated reel is rejected after independent probing", async () => {
  await assert.rejects(normalizeCapture(job({ kind: "reel" }), capture({
    base64: Buffer.from("webm-source").toString("base64"), mimeType: "video/webm", height: 1920, durationSeconds: 8,
  }), { runProcess: async (command, args) => {
    if (command === "ffmpeg") { await writeFile(args.at(-1), Buffer.from("ftypisom-truncated")); return ""; }
    return JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920, pix_fmt: "yuv420p" }], format: { duration: "2", format_name: "mov,mp4" } });
  } }), /encode_failed/);
});

test("process failure details are replaced with encode_failed", async () => {
  await assert.rejects(normalizeCapture(job(), capture(), { runProcess: async () => { throw new Error(`ffprobe leaked ${TOKEN}`); } }), error => error instanceof WorkerError && error.message === "encode_failed");
});
