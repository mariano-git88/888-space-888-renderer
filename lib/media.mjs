import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MAX_ARTIFACT_BYTES, safeChildEnvironment, safeMeasurements, sha256, WorkerError } from "./common.mjs";

const execFileAsync = promisify(execFile);

export async function runMediaProcess(command, args, { signal } = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      signal, timeout: 4 * 60 * 1000, killSignal: "SIGKILL", encoding: "utf8",
      maxBuffer: 256 * 1024, env: safeChildEnvironment(), windowsHide: true,
    });
    return stdout;
  } catch (error) {
    throw new WorkerError(signal?.aborted ? "timeout" : "encode_failed", {
      mediaReason: signal?.aborted ? "deadline" : error?.killed === true ? "process_timeout" : "process_failed",
    });
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
      "-count_frames", "-show_entries", "format=duration,format_name:stream=codec_name,codec_type,width,height,pix_fmt,duration,avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames",
      "-of", "json", path,
    ], { signal });
    let result;
    try { result = JSON.parse(stdout); } catch { throw new WorkerError("encode_failed", { mediaReason: "probe_invalid" }); }
    if (!result || !Array.isArray(result.streams)) throw new WorkerError("encode_failed", { mediaReason: "probe_invalid" });
    const streams = result.streams.filter(stream => stream.codec_type === "video");
    if (streams.length !== 1) throw new WorkerError("encode_failed", { mediaReason: "video_stream_count", mediaMeasurements: { videoStreamCount: streams.length } });
    return { stream: streams[0], format: result.format || {} };
  } catch (error) {
    if (error instanceof WorkerError) throw error;
    throw new WorkerError(signal?.aborted ? "timeout" : "encode_failed", { mediaReason: signal?.aborted ? "deadline" : "probe_failed" });
  }
}

function frameRate(value) {
  if (typeof value !== "string" || !/^\d{1,9}\/\d{1,9}$/.test(value)) return NaN;
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator > 0 ? numerator / denominator : NaN;
}

function frameCount(value) {
  return typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : NaN;
}

function measuredContainer(value) {
  const formats = typeof value === "string" ? value.split(",") : [];
  return formats.includes("mp4") ? "mp4" : formats.includes("webm") ? "webm" : formats.includes("mjpeg") || formats.includes("jpeg_pipe") ? "jpeg" : "other";
}

function probeMeasurements(inspected, source = false) {
  const { stream, format } = inspected;
  const rawDuration = format.duration ?? stream.duration;
  const duration = rawDuration === undefined || rawDuration === null || rawDuration === "" ? NaN : Number(rawDuration);
  const codec = ["h264", "vp8", "vp9", "av1", "mjpeg"].includes(stream.codec_name) ? stream.codec_name : "other";
  return source ? {
    sourceWidth: stream.width, sourceHeight: stream.height, sourceDurationMs: duration * 1000,
    sourceAverageFps: frameRate(stream.avg_frame_rate), sourceNominalFps: frameRate(stream.r_frame_rate),
    sourceFrameCount: frameCount(stream.nb_frames), sourceDecodedFrames: frameCount(stream.nb_read_frames),
    sourceCodec: codec, sourceContainer: measuredContainer(format.format_name),
  } : {
    width: stream.width, height: stream.height, durationMs: duration * 1000,
    averageFps: frameRate(stream.avg_frame_rate), nominalFps: frameRate(stream.r_frame_rate),
    frameCount: frameCount(stream.nb_frames), decodedFrames: frameCount(stream.nb_read_frames),
    codec, container: measuredContainer(format.format_name),
  };
}

export async function normalizeCapture(job, capture, { signal, runProcess = runMediaProcess } = {}) {
  let dir;
  let phase = "capture_validate";
  const declaredMime = typeof capture?.mimeType === "string" ? capture.mimeType : "";
  const diagnostics = {
    captureMime: /^video\/mp4(?:;|$)/.test(declaredMime) ? "video/mp4" : /^video\/webm(?:;|$)/.test(declaredMime) ? "video/webm" : declaredMime === "image/jpeg" ? "image/jpeg" : "unknown",
    captureCodec: /avc[13]/i.test(declaredMime) ? "h264" : /vp0?8/i.test(declaredMime) ? "vp8" : /vp0?9/i.test(declaredMime) ? "vp9" : /av01/i.test(declaredMime) ? "av1" : "unspecified",
    ...(job.kind === "reel" ? { captureDurationMs: capture?.durationSeconds * 1000 } : {}),
  };
  try {
    const source = decodeCapture(job, capture);
    diagnostics.inputBytes = source.length;
    phase = "input_write";
    dir = await mkdtemp(join(tmpdir(), "gaetano-render-"));
    const input = join(dir, job.kind === "photo" ? "input.jpg" : (capture.mimeType.startsWith("video/mp4") ? "input.mp4" : "input.webm"));
    await writeFile(input, source, { mode: 0o600 });
    let output = input;
    let sourceDurationMs;
    if (job.kind === "reel") {
      phase = "input_probe";
      const inputProbe = await probe(input, runProcess, signal);
      Object.assign(diagnostics, probeMeasurements(inputProbe, true));
      phase = "input_validate";
      if (inputProbe.stream.width !== 1080 || inputProbe.stream.height !== 1920) throw new WorkerError("encode_failed", { mediaReason: "input_dimensions" });
      // MediaRecorder WebM may have no duration header. Preserve a measured
      // duration when available; never replace it with the nominal eight seconds.
      const sourceDuration = Number(inputProbe.format.duration ?? inputProbe.stream.duration);
      if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
        if (sourceDuration > 60) throw new WorkerError("encode_failed", { mediaReason: "source_duration_limit" });
        sourceDurationMs = Math.round(sourceDuration * 1000);
      }
      output = join(dir, "output.mp4");
      phase = "transcode";
      await runProcess("ffmpeg", [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-protocol_whitelist", "file,pipe", "-i", input,
        "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1",
        "-vf", "fps=24,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-threads", "2", "-t", "8", "-movflags", "+faststart", output,
      ], { signal });
    }
    phase = "output_stat";
    const size = (await stat(output)).size;
    diagnostics.outputBytes = size;
    if (!size || size > MAX_ARTIFACT_BYTES) throw new WorkerError("encode_failed", { mediaReason: "output_size" });
    phase = "output_probe";
    const inspected = await probe(output, runProcess, signal);
    Object.assign(diagnostics, probeMeasurements(inspected));
    const { stream, format } = inspected;
    const height = job.kind === "photo" ? 1350 : 1920;
    phase = "output_validate";
    if (stream.width !== 1080 || stream.height !== height) throw new WorkerError("encode_failed", { mediaReason: "output_dimensions" });
    let durationMs, averageFps, nominalFps, measuredFrames;
    if (job.kind === "photo") {
      if (stream.codec_name !== "mjpeg") throw new WorkerError("encode_failed", { mediaReason: "output_codec" });
    } else {
      const duration = Number(format.duration ?? stream.duration);
      averageFps = frameRate(stream.avg_frame_rate);
      nominalFps = frameRate(stream.r_frame_rate);
      measuredFrames = frameCount(stream.nb_frames);
      if (stream.codec_name !== "h264" || stream.pix_fmt !== "yuv420p") throw new WorkerError("encode_failed", { mediaReason: "output_codec" });
      if (!String(format.format_name).split(",").includes("mp4")) throw new WorkerError("encode_failed", { mediaReason: "output_format" });
      if (!Number.isFinite(duration) || duration < 7.5 || duration > 8.5) throw new WorkerError("encode_failed", { mediaReason: "output_duration" });
      if (!Number.isFinite(averageFps) || Math.abs(averageFps - 24) > .01 || !Number.isFinite(nominalFps) || Math.abs(nominalFps - 24) > .01) throw new WorkerError("encode_failed", { mediaReason: "output_frame_rate" });
      if (!Number.isSafeInteger(measuredFrames) || measuredFrames < 1 || measuredFrames > 204 || Math.abs(measuredFrames - averageFps * duration) > 1) throw new WorkerError("encode_failed", { mediaReason: "output_frame_count" });
      durationMs = Math.round(duration * 1000);
    }
    const bytes = await readFile(output);
    return {
      bytes, sha256: sha256(bytes), width: 1080, height,
      mimeType: job.kind === "photo" ? "image/jpeg" : "video/mp4",
      ...(durationMs === undefined ? {} : {
        durationMs, averageFps, nominalFps, frameCount: measuredFrames,
        captureDurationMs: Math.round(capture.durationSeconds * 1000),
        ...(sourceDurationMs === undefined ? {} : { sourceDurationMs }),
      }),
      diagnostics: safeMeasurements(diagnostics),
    };
  } catch (error) {
    const known = error instanceof WorkerError;
    const fallback = { capture_validate: "capture_invalid", input_write: "file_io", input_probe: "probe_failed", input_validate: "input_dimensions", transcode: "transcode_failed", output_stat: "file_io", output_probe: "probe_failed", output_validate: "output_format" }[phase];
    throw new WorkerError(signal?.aborted ? "timeout" : known ? error.code : "encode_failed", {
      mediaPhase: phase, mediaReason: signal?.aborted ? "deadline" : known && error.mediaReason ? error.mediaReason : fallback,
      mediaMeasurements: { ...diagnostics, ...(known ? error.mediaMeasurements : {}) },
    });
  } finally {
    if (dir) await rm(dir, { force: true, recursive: true }).catch(() => {});
  }
}
