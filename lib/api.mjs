import { setTimeout as delay } from "node:timers/promises";
import { assertLease, MAX_CLAIM_BYTES, REQUEST_TIMEOUT_MS, RENDERER_VERSION, WorkerError } from "./common.mjs";

async function limitedJson(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes) throw new WorkerError("invalid_response");
  if (!response.body) throw new WorkerError("invalid_response");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new WorkerError("invalid_response");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    await reader.cancel().catch(() => {});
    throw new WorkerError("invalid_response");
  } finally { reader.releaseLock(); }
}

function requestSignal(signal, timeout = REQUEST_TIMEOUT_MS) {
  const timed = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, timed]) : timed;
}

function headers(config, leaseToken) {
  const result = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
  if (leaseToken) result["X-Render-Lease"] = leaseToken;
  return result;
}

function options(config, body, signal, leaseToken) {
  return {
    method: "POST", headers: headers(config, leaseToken), body,
    signal: requestSignal(signal), redirect: "error", credentials: "omit", cache: "no-store",
  };
}

export async function claimJob(config, { fetchImpl = fetch } = {}) {
  // Do not retry an uncertain claim: a second claim could lease another job.
  try {
    const response = await fetchImpl(`${config.origin}/api/renderer/claim`, options(config, JSON.stringify({ workerId: config.workerId })));
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new WorkerError("claim_failed"); }
    const result = await limitedJson(response, MAX_CLAIM_BYTES);
    if (!result || !Object.hasOwn(result, "job") || (result.job !== null && typeof result.job !== "object")) throw new WorkerError("claim_failed");
    return result.job;
  } catch { throw new WorkerError("claim_failed"); }
}

function validReceipt(receipt, job, artifact) {
  const saved = receipt?.job;
  if (!saved || saved.id !== job.id || saved.status !== "succeeded") return false;
  const proof = saved.receipt;
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return false;
  // These are required server receipt fields, not optional metadata. A success
  // status without evidence of this exact artifact/snapshot is unconfirmed.
  const expected = {
    sha256: artifact.sha256, byteLength: artifact.bytes.length, contentType: artifact.mimeType,
    width: artifact.width, height: artifact.height, rendererVersion: RENDERER_VERSION,
    snapshotSha256: job.snapshotSha256, worldRevision: job.worldRevision, sceneVersion: job.sceneVersion,
    artifactPath: `/api/renderer/jobs/${job.id}/artifact`,
  };
  if (!Object.entries(expected).every(([key, value]) => proof[key] === value)) return false;
  if (!Number.isSafeInteger(proof.completedAt) || proof.completedAt <= 0
    || !Number.isFinite(new Date(proof.completedAt).getTime()) || proof.completedAt >= job.leaseUntil) return false;
  if (job.kind === "reel") return Number.isSafeInteger(proof.durationMs) && proof.durationMs === artifact.durationMs;
  return proof.durationMs === undefined || proof.durationMs === null;
}

export async function completeJob(config, job, artifact, {
  fetchImpl = fetch, signal, now = Date.now, sleep = (ms, signal) => delay(ms, undefined, { signal }),
} = {}) {
  const body = artifact.bytes;
  const completeHeaders = {
    ...headers(config, job.leaseToken),
    "Content-Type": artifact.mimeType,
    "X-Content-Sha256": artifact.sha256,
    "X-Render-Width": String(artifact.width),
    "X-Render-Height": String(artifact.height),
    "X-Renderer-Version": RENDERER_VERSION,
  };
  if (artifact.durationMs !== undefined) completeHeaders["X-Render-Duration-Ms"] = String(artifact.durationMs);
  let uncertain = false;
  const checkLease = () => {
    try { assertLease(job, now); }
    catch { throw new WorkerError("lease_expired", { uncertain }); }
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    checkLease();
    if (signal?.aborted) throw new WorkerError("timeout", { uncertain });
    let response;
    try {
      response = await fetchImpl(`${config.origin}/api/renderer/jobs/${encodeURIComponent(job.id)}/complete`, {
        ...options(config, body, signal, job.leaseToken), headers: completeHeaders,
      });
    } catch {
      uncertain = true;
      if (signal?.aborted) throw new WorkerError("timeout", { uncertain: true });
    }
    if (response) {
      if (response.ok) {
        let receipt;
        try { receipt = await limitedJson(response, 64 * 1024); } catch { /* Retry the exact idempotent upload. */ }
        if (validReceipt(receipt, job, artifact)) return receipt;
        uncertain = true;
      } else {
        const retryable = [408, 425, 429].includes(response.status) || response.status >= 500;
        await response.body?.cancel().catch(() => {});
        if (!retryable) throw new WorkerError("upload_failed", { uncertain });
        // A server failure can happen after committing the uploaded artifact.
        uncertain = true;
      }
    }
    if (attempt < 2) {
      checkLease();
      try { await sleep([250, 1_000][attempt], signal); }
      catch { throw new WorkerError("timeout", { uncertain }); }
    }
  }
  throw new WorkerError("upload_failed", { uncertain });
}

export async function reportFailure(config, job, code, { fetchImpl = fetch, now = Date.now } = {}) {
  if (!["render_failed", "timeout", "encode_failed", "upload_failed"].includes(code)) return;
  try {
    assertLease(job, now);
    const response = await fetchImpl(`${config.origin}/api/renderer/jobs/${encodeURIComponent(job.id)}/fail`, {
      ...options(config, JSON.stringify({ code }), undefined, job.leaseToken), signal: requestSignal(undefined, 10_000),
    });
    await response.body?.cancel().catch(() => {});
  } catch { /* Never log response bodies or replace the original outcome. */ }
}
