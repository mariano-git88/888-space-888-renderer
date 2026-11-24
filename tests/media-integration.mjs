// Optional FFmpeg-only product-runtime smoke test. No browser, credentials,
// network, owner data or public publication is involved.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeCapture, runMediaProcess } from "../lib/media.mjs";
import { SCENE_VERSION } from "../lib/common.mjs";

const dir = await mkdtemp(join(tmpdir(), "gaetano-media-smoke-"));
const started = Date.now();
try {
  const photoPath = join(dir, "source.jpg");
  const reelPath = join(dir, "source.webm");
  await runMediaProcess("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x556644:s=1080x1350", "-frames:v", "1", "-update", "1", photoPath]);
  await runMediaProcess("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x556644:s=1080x1920:r=24:d=12", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "300k", "-an", reelPath]);
  const base = { sceneVersion: SCENE_VERSION, state: { worldMinute: 100 } };
  const photo = await normalizeCapture({ ...base, kind: "photo" }, {
    base64: (await readFile(photoPath)).toString("base64"), mimeType: "image/jpeg", width: 1080, height: 1350, worldMinute: 100, sceneVersion: SCENE_VERSION,
  });
  const reel = await normalizeCapture({ ...base, kind: "reel" }, {
    base64: (await readFile(reelPath)).toString("base64"), mimeType: "video/webm", width: 1080, height: 1920, durationSeconds: 12, worldMinute: 100, sceneVersion: SCENE_VERSION,
  });
  const atoms = [];
  for (let offset = 0; offset + 8 <= reel.bytes.length;) {
    const size = reel.bytes.readUInt32BE(offset);
    assert.ok(size >= 8 && offset + size <= reel.bytes.length, "valid top-level MP4 atom");
    atoms.push(reel.bytes.toString("ascii", offset + 4, offset + 8));
    offset += size;
  }
  assert.ok(atoms.includes("moov") && atoms.includes("mdat"));
  assert.ok(atoms.indexOf("moov") < atoms.indexOf("mdat"), "faststart moov precedes mdat");
  assert.equal(photo.mimeType, "image/jpeg");
  assert.equal(reel.mimeType, "video/mp4");
  assert.equal(reel.durationMs, 8000);
  assert.equal(reel.sourceDurationMs, 12000);
  assert.equal(reel.averageFps, 24); assert.equal(reel.nominalFps, 24); assert.equal(reel.frameCount, 192);
  process.stdout.write(`${JSON.stringify({ event: "media_smoke_passed", elapsedMs: Date.now() - started, photoBytes: photo.bytes.length, reelBytes: reel.bytes.length, sourceDurationMs: reel.sourceDurationMs, durationMs: reel.durationMs, averageFps: reel.averageFps, nominalFps: reel.nominalFps, frameCount: reel.frameCount, dimensions: [reel.width, reel.height], faststart: true })}\n`);
} finally { await rm(dir, { recursive: true, force: true }); }
