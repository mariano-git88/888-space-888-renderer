import { createHash } from "node:crypto";

export const SCENE_VERSION = "gaetano-scene-v1";
export const RENDERER_VERSION = "gaetano-renderer/0.1.0";
export const MAX_ARTIFACT_BYTES = 24 * 1024 * 1024;
export const MAX_CLAIM_BYTES = 2 * 1024 * 1024;
export const JOB_TIMEOUT_MS = 5 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 30_000;
export const LEASE_MARGIN_MS = 1_000;
export const FAILURE_CODES = new Set(["render_failed", "timeout", "encode_failed", "upload_failed"]);

/** Carries only an approved machine code; never retain upstream errors or bodies. */
export class WorkerError extends Error {
  constructor(code, { uncertain = false } = {}) {
    super(code);
    this.name = "WorkerError";
    this.code = code;
    this.uncertain = uncertain;
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function loadConfig(env = process.env) {
  let origin;
  try {
    const url = new URL(env.GAETANO_SITE_ORIGIN || "https://www.888space888.com");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || (url.protocol !== "https:" && !(url.protocol === "http:" && local && env.GAETANO_ALLOW_LOCAL_HTTP === "1"))) {
      throw new Error();
    }
    origin = url.origin;
  } catch { throw new WorkerError("configuration_invalid"); }
  const token = env.GAETANO_RENDERER_TOKEN;
  if (typeof token !== "string" || !/^[\x21-\x7e]{32,512}$/.test(token)) throw new WorkerError("configuration_invalid");
  const workerId = env.GAETANO_RENDERER_WORKER_ID || "gaetano-renderer-01";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(workerId)) throw new WorkerError("configuration_invalid");
  return { origin, token, workerId };
}

export function validateJob(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(job.id)
    || typeof job.leaseToken !== "string" || !/^[\x21-\x7e]{16,512}$/.test(job.leaseToken)
    || !Number.isSafeInteger(job.leaseUntil) || job.leaseUntil <= 0
    || !Number.isSafeInteger(job.attempt) || job.attempt < 1
    || !["photo", "reel"].includes(job.kind)
    || !["scene", "selfie"].includes(job.camera)
    || job.sceneVersion !== SCENE_VERSION
    || !Number.isSafeInteger(job.worldRevision) || job.worldRevision < 0
    || !/^[a-f0-9]{64}$/.test(job.snapshotSha256)
    || !job.state || typeof job.state !== "object" || Array.isArray(job.state)
    || !Number.isSafeInteger(job.state.worldMinute) || job.state.worldMinute < 0) {
    throw new WorkerError("invalid_job");
  }
  // This is the backend's exact JSON.stringify(state), not sorted/canonical JSON.
  if (sha256(JSON.stringify(job.state)) !== job.snapshotSha256) throw new WorkerError("invalid_job");
  return job;
}

export function assertLease(job, now = Date.now) {
  if (now() + LEASE_MARGIN_MS >= job.leaseUntil) throw new WorkerError("lease_expired");
}

export function safeChildEnvironment(env = process.env) {
  // In particular, do not pass the renderer token, lease token, cloud credentials,
  // proxy credentials, DEBUG or NODE_OPTIONS to Chromium/FFmpeg subprocesses.
  const names = ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH", "XDG_RUNTIME_DIR"];
  return Object.fromEntries(names.filter(name => typeof env[name] === "string").map(name => [name, env[name]]));
}

export async function abortable(promise, signal, lateCleanup) {
  if (!signal) return promise;
  if (signal.aborted) {
    Promise.resolve(promise).then(value => lateCleanup?.(value), () => {}).catch(() => {});
    throw new WorkerError("timeout");
  }
  let abort;
  const aborted = new Promise((_, reject) => {
    abort = () => reject(new WorkerError("timeout"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally {
    signal.removeEventListener("abort", abort);
    if (signal.aborted && lateCleanup) Promise.resolve(promise).then(lateCleanup, () => {}).catch(() => {});
  }
}

export function failureCode(error, fallback = "render_failed") {
  return error instanceof WorkerError && FAILURE_CODES.has(error.code) ? error.code : fallback;
}

export function logEvent(logger, event, measurements = {}) {
  // Never spread arbitrary API/browser/process objects into logs.
  const record = { event, rendererVersion: RENDERER_VERSION };
  for (const key of ["elapsedMs", "renderMs", "encodeMs", "uploadMs", "bytes", "width", "height", "durationMs", "maxRssKiB"])
    if (Number.isFinite(measurements[key]) && measurements[key] >= 0) record[key] = Math.round(measurements[key]);
  if (FAILURE_CODES.has(measurements.code) || ["configuration_invalid", "claim_failed", "invalid_job", "lease_expired"].includes(measurements.code)) record.code = measurements.code;
  if (["photo", "reel"].includes(measurements.kind)) record.kind = measurements.kind;
  logger(record);
}
