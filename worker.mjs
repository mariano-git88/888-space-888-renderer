import { pathToFileURL } from "node:url";
import { abortable, assertLease, FAILURE_CODES, failureCode, JOB_TIMEOUT_MS, LEASE_MARGIN_MS, loadConfig, logEvent, validateJob, WorkerError } from "./lib/common.mjs";
import { claimJob, completeJob, reportFailure } from "./lib/api.mjs";
import { captureJob } from "./lib/capture.mjs";
import { normalizeCapture } from "./lib/media.mjs";

/** Exactly one claim per invocation. Dependency injection supports no-network tests. */
export async function runOnce(config, deps = {}) {
  const now = deps.now || Date.now;
  const logger = deps.logger || (record => process.stdout.write(`${JSON.stringify(record)}\n`));
  const started = now();
  let job;
  try {
    const claimed = await claimJob(config, deps);
    if (claimed === null) {
      logEvent(logger, "no_job", { elapsedMs: now() - started });
      return { status: "no_job" };
    }
    job = validateJob(claimed);
    assertLease(job, now);
  } catch (error) {
    const code = error instanceof WorkerError ? error.code : "claim_failed";
    logEvent(logger, "job_rejected", { code, elapsedMs: now() - started });
    return { status: "failed", code };
  }

  const controller = new AbortController();
  const budget = Math.min(deps.jobTimeoutMs ?? JOB_TIMEOUT_MS, job.leaseUntil - now() - LEASE_MARGIN_MS);
  const timer = setTimeout(() => controller.abort(), Math.max(1, budget));
  const signal = controller.signal;
  const measurements = { kind: job.kind };
  let phase = "render_failed";
  let uploadStarted = false;
  try {
    let phaseStarted = now();
    const capture = await abortable((deps.capture || captureJob)(config, job, { signal }), signal);
    measurements.renderMs = now() - phaseStarted;
    assertLease(job, now);
    phase = "encode_failed";
    phaseStarted = now();
    const artifact = await abortable((deps.normalize || normalizeCapture)(job, capture, { signal }), signal);
    measurements.encodeMs = now() - phaseStarted;
    assertLease(job, now);
    phase = "upload_failed";
    phaseStarted = now();
    uploadStarted = true;
    await completeJob(config, job, artifact, { ...deps, signal, now });
    measurements.uploadMs = now() - phaseStarted;
    logEvent(logger, "job_succeeded", {
      ...measurements, elapsedMs: now() - started, bytes: artifact.bytes.length,
      width: artifact.width, height: artifact.height, durationMs: artifact.durationMs,
      maxRssKiB: process.resourceUsage().maxRSS,
    });
    return { status: "succeeded", bytes: artifact.bytes.length };
  } catch (error) {
    const code = signal.aborted ? "timeout" : failureCode(error, phase);
    // After an uncertain upload, a successful server commit may already exist.
    // Never overwrite it with a failure. Retain the lease for reconciliation.
    const uncertain = uploadStarted && (signal.aborted || error?.uncertain === true);
    if (!uncertain && FAILURE_CODES.has(code)) await reportFailure(config, job, code, { ...deps, now });
    logEvent(logger, uncertain ? "completion_unconfirmed" : "job_failed", { ...measurements, code, elapsedMs: now() - started });
    return { status: "failed", code, uncertain };
  } finally { clearTimeout(timer); }
}

async function main() {
  const logger = record => process.stdout.write(`${JSON.stringify(record)}\n`);
  // A stuck browser/process cannot keep a billed cron invocation alive forever.
  const hardStop = setTimeout(() => {
    logEvent(logger, "worker_timeout", { code: "timeout" });
    process.exit(1);
  }, JOB_TIMEOUT_MS + 60_000);
  hardStop.unref();
  try {
    if (process.argv.slice(2).some(value => value !== "--once")) throw new WorkerError("configuration_invalid");
    const result = await runOnce(loadConfig(), { logger });
    process.exitCode = result.status === "failed" ? 1 : 0;
  } catch {
    logEvent(logger, "worker_failed", { code: "configuration_invalid" });
    process.exitCode = 1;
  } finally {
    // Flush the small structured log before exiting. A cron process has no other
    // work to preserve; exit also prevents a broken Chromium pipe keeping it up.
    await new Promise(resolve => process.stdout.write("", resolve));
    clearTimeout(hardStop);
    process.exit(process.exitCode ?? 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
