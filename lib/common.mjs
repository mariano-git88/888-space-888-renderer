import { createHash } from "node:crypto";

export const SCENE_VERSION = "gaetano-scene-v1";
export const RENDERER_VERSION = "gaetano-renderer/0.1.3";
export const MAX_ARTIFACT_BYTES = 24 * 1024 * 1024;
export const MAX_CLAIM_BYTES = 2 * 1024 * 1024;
export const JOB_TIMEOUT_MS = 5 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 30_000;
export const LEASE_MARGIN_MS = 1_000;
export const FAILURE_CODES = new Set(["render_failed", "timeout", "encode_failed", "upload_failed"]);
export const CAPTURE_PHASES = new Set(["browser_launch", "browser_context", "navigation", "contract", "initialize", "capture"]);
export const CAPTURE_REASONS = new Set([
  "deadline", "browser_launch_failed", "browser_context_failed", "navigation_failed", "navigation_timeout",
  "contract_failed", "contract_timeout", "initialize_failed", "initialize_timeout", "asset_failed",
  "webgl_unavailable", "webgl_context_lost", "page_error", "page_crashed", "page_closed",
  "no_clear_camera", "capture_failed",
  "recording_timeout", "page_hidden", "encoder_unavailable", "encoder_failed", "empty_clip", "media_limit",
]);
export const CAPTURE_ERROR_NAMES = new Set(["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "TimeoutError", "AbortError", "TargetClosedError"]);
export const MEDIA_PHASES = new Set(["capture_validate", "input_write", "input_probe", "input_validate", "transcode", "output_stat", "output_probe", "output_validate"]);
export const MEDIA_REASONS = new Set([
  "capture_invalid", "file_io", "probe_failed", "probe_invalid", "video_stream_count", "input_dimensions",
  "source_duration_limit", "transcode_failed", "output_size", "output_dimensions", "output_codec", "output_format",
  "output_duration", "output_frame_rate", "output_frame_count", "process_failed", "process_timeout", "deadline",
]);

export function safeMeasurements(measurements = {}) {
  const record = {};
  for (const key of [
    "elapsedMs", "renderMs", "encodeMs", "uploadMs", "bytes", "inputBytes", "outputBytes", "width", "height", "durationMs",
    "sourceWidth", "sourceHeight", "sourceDurationMs", "captureDurationMs", "sourceFrameCount", "frameCount",
    "sourceDecodedFrames", "decodedFrames", "videoStreamCount", "maxRssKiB",
  ]) if (Number.isFinite(measurements[key]) && measurements[key] >= 0) record[key] = Math.round(measurements[key]);
  for (const key of ["averageFps", "nominalFps", "sourceAverageFps", "sourceNominalFps"])
    if (Number.isFinite(measurements[key]) && measurements[key] >= 0 && measurements[key] <= 1_000_000_000) record[key] = Math.round(measurements[key] * 10_000) / 10_000;
  if (["image/jpeg", "video/mp4", "video/webm", "unknown"].includes(measurements.captureMime)) record.captureMime = measurements.captureMime;
  for (const key of ["captureCodec", "sourceCodec", "codec"])
    if (["h264", "vp8", "vp9", "av1", "mjpeg", "unspecified", "other"].includes(measurements[key])) record[key] = measurements[key];
  for (const key of ["sourceContainer", "container"])
    if (["mp4", "webm", "jpeg", "other"].includes(measurements[key])) record[key] = measurements[key];
  return record;
}

/** Carries only approved codes; never retain upstream errors, messages or bodies. */
export class WorkerError extends Error {
  constructor(code, { uncertain = false, capturePhase, captureReason, errorName, mediaPhase, mediaReason, mediaMeasurements } = {}) {
    super(code);
    this.name = "WorkerError";
    this.code = code;
    this.uncertain = uncertain;
    if (CAPTURE_PHASES.has(capturePhase)) this.capturePhase = capturePhase;
    if (CAPTURE_REASONS.has(captureReason)) this.captureReason = captureReason;
    if (CAPTURE_ERROR_NAMES.has(errorName)) this.errorName = errorName;
    if (MEDIA_PHASES.has(mediaPhase)) this.mediaPhase = mediaPhase;
    if (MEDIA_REASONS.has(mediaReason)) this.mediaReason = mediaReason;
    if (mediaMeasurements && typeof mediaMeasurements === "object") this.mediaMeasurements = safeMeasurements(mediaMeasurements);
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
  const record = { event, rendererVersion: RENDERER_VERSION, ...safeMeasurements(measurements) };
  if (FAILURE_CODES.has(measurements.code) || ["configuration_invalid", "claim_failed", "invalid_job", "lease_expired"].includes(measurements.code)) record.code = measurements.code;
  if (["photo", "reel"].includes(measurements.kind)) record.kind = measurements.kind;
  if (CAPTURE_PHASES.has(measurements.capturePhase)) record.capturePhase = measurements.capturePhase;
  if (CAPTURE_REASONS.has(measurements.captureReason)) record.captureReason = measurements.captureReason;
  if (CAPTURE_ERROR_NAMES.has(measurements.errorName)) record.errorName = measurements.errorName;
  if (MEDIA_PHASES.has(measurements.mediaPhase)) record.mediaPhase = measurements.mediaPhase;
  if (MEDIA_REASONS.has(measurements.mediaReason)) record.mediaReason = measurements.mediaReason;
  logger(record);
}
