import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MAX_ARTIFACT_BYTES, safeChildEnvironment, sha256, WorkerError } from "./common.mjs";

const execFileAsync = promisify(execFile);

export async function runMediaProcess(command, args, { signal } = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      signal, timeout: 4 * 60 * 1000, killSignal: "SIGKILL", encoding: "utf8",
      maxBuffer: 256 * 1024, env: safeChildEnvironment(), windowsHide: true,
    });
    return stdout;
  } catch {
    throw new WorkerError(signal?.aborted ? "timeout" : "encode_failed");
  }
}

function decodeCapture(job, capture) {
  const height = job.kind === "photo" ? 1350 : 1920;
  if (!capture || capture.width !== 1080 || capture.height !== height
    || capture.sceneVersion !== job.sceneVersion || capture.worldMinute !== job.state.worldMinute
    || typeof capture.base64 !== "string" || !capture.base64.length
    || capture.base64.length > 4 * Math.ceil(MAX_ARTIFACT_BYTES / 3)
    || capture.base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(capture.base64)) throw new WorkerError("render_failed");
  const bytes = Buffer.from(capture.base64, "base64");
  if (!bytes.length || bytes.length > MAX_ARTIFACT_BYTES || bytes.toString("base64") !== capture.base64) throw new WorkerError("render_failed");
  if (job.kind === "photo") {
    if (capture.mimeType !== "image/jpeg" || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new WorkerError("render_failed");
  } else if (typeof capture.mimeType !== "string" || !/^video\/(?:webm|mp4)(?:;.*)?$/.test(capture.mimeType)
    || !Number.isFinite(capture.durationSeconds) || capture.durationSeconds < 7 || capture.durationSeconds > 60) {
    throw new WorkerError("render_failed");
  }
  return bytes;
}

async function probe(path, runProcess, signal) {
  try {
    const stdout = await runProcess("ffprobe", [
      "-v", "error", "-protocol_whitelist", "file,pipe",
      "-show_entries", "format=duration,format_name:stream=codec_name,codec_type,width,height,pix_fmt,duration,avg_frame_rate,r_frame_rate,nb_frames",
      "-of", "json", path,
    ], { signal });
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.streams)) throw new Error();
    const streams = result.streams.filter(stream => stream.codec_type === "video");
    if (streams.length !== 1) throw new Error();
    return { stream: streams[0], format: result.format || {} };
  } catch {
    throw new WorkerError(signal?.aborted ? "timeout" : "encode_failed");
  }
}

function frameRate(value) {
  if (typeof value !== "string" || !/^\d{1,9}\/\d{1,9}$/.test(value)) return NaN;
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator > 0 ? numerator / denominator : NaN;
}

export async function normalizeCapture(job, capture, { signal, runProcess = runMediaProcess } = {}) {
  const source = decodeCapture(job, capture);
  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), "gaetano-render-"));
    const input = join(dir, job.kind === "photo" ? "input.jpg" : (capture.mimeType.startsWith("video/mp4") ? "input.mp4" : "input.webm"));
    await writeFile(input, source, { mode: 0o600 });
    let output = input;
    let sourceDurationMs;
    if (job.kind === "reel") {
      const inputProbe = await probe(input, runProcess, signal);
      if (inputProbe.stream.width !== 1080 || inputProbe.stream.height !== 1920) throw new WorkerError("encode_failed");
      // MediaRecorder WebM may have no duration header. Preserve a measured
      // duration when available; never replace it with the nominal eight seconds.
      const sourceDuration = Number(inputProbe.format.duration ?? inputProbe.stream.duration);
      if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
        if (sourceDuration > 60) throw new WorkerError("encode_failed");
        sourceDurationMs = Math.round(sourceDuration * 1000);
      }
      output = join(dir, "output.mp4");
      await runProcess("ffmpeg", [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-protocol_whitelist", "file,pipe", "-i", input,
        "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1",
        "-vf", "fps=24,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-threads", "2", "-t", "8", "-movflags", "+faststart", output,
      ], { signal });
    }
    const size = (await stat(output)).size;
    if (!size || size > MAX_ARTIFACT_BYTES) throw new WorkerError("encode_failed");
    const inspected = await probe(output, runProcess, signal);
    const { stream, format } = inspected;
    const height = job.kind === "photo" ? 1350 : 1920;
    if (stream.width !== 1080 || stream.height !== height) throw new WorkerError("encode_failed");
    let durationMs, averageFps, nominalFps, frameCount;
    if (job.kind === "photo") {
      if (stream.codec_name !== "mjpeg") throw new WorkerError("encode_failed");
    } else {
      const duration = Number(format.duration ?? stream.duration);
      averageFps = frameRate(stream.avg_frame_rate);
      nominalFps = frameRate(stream.r_frame_rate);
      frameCount = typeof stream.nb_frames === "string" && /^\d{1,9}$/.test(stream.nb_frames) ? Number(stream.nb_frames) : NaN;
      if (stream.codec_name !== "h264" || stream.pix_fmt !== "yuv420p"
        || !String(format.format_name).split(",").includes("mp4")
        || !Number.isFinite(duration) || duration < 7.5 || duration > 8.5
        || !Number.isFinite(averageFps) || Math.abs(averageFps - 24) > .01
        || !Number.isFinite(nominalFps) || Math.abs(nominalFps - 24) > .01
        || !Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 204
        || Math.abs(frameCount - averageFps * duration) > 1) throw new WorkerError("encode_failed");
      durationMs = Math.round(duration * 1000);
    }
    const bytes = await readFile(output);
    return {
      bytes, sha256: sha256(bytes), width: 1080, height,
      mimeType: job.kind === "photo" ? "image/jpeg" : "video/mp4",
      ...(durationMs === undefined ? {} : {
        durationMs, averageFps, nominalFps, frameCount,
        captureDurationMs: Math.round(capture.durationSeconds * 1000),
        ...(sourceDurationMs === undefined ? {} : { sourceDurationMs }),
      }),
    };
  } catch (error) {
    if (error instanceof WorkerError) throw error;
    throw new WorkerError(signal?.aborted ? "timeout" : "encode_failed");
  } finally {
    if (dir) await rm(dir, { force: true, recursive: true }).catch(() => {});
  }
}
