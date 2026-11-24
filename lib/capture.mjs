import { abortable, CAPTURE_ERROR_NAMES, safeChildEnvironment, WorkerError } from "./common.mjs";

/** Classify in memory, then discard the browser's message. Never log it. */
function captureFailure(error, phase, pageFailure, signal) {
  const timedOut = signal?.aborted || (error instanceof WorkerError && error.code === "timeout");
  const message = typeof error?.message === "string" ? error.message : "";
  let reason = timedOut ? "deadline" : `${phase}_failed`;
  if (!timedOut) {
    if (pageFailure) reason = pageFailure.reason;
    else if (message.includes("Capture initialization timed out.")) reason = "initialize_timeout";
    else if (message.includes("The sculpture asset could not be loaded for this capture.")) reason = "asset_failed";
    else if (message.includes("The 3D view needs WebGL.")) reason = "webgl_unavailable";
    else if (message.includes("The 3D view was interrupted.")) reason = "webgl_context_lost";
    else if (message.includes("There is no clear selfie angle here.")) reason = "no_clear_camera";
    else if (error?.name === "TimeoutError" && ["navigation", "contract"].includes(phase)) reason = `${phase}_timeout`;
    else if (/Target page, context or browser has been closed/.test(message)) reason = "page_closed";
  }
  return new WorkerError(timedOut ? "timeout" : "render_failed", {
    capturePhase: phase, captureReason: reason, errorName: pageFailure?.errorName || error?.name,
  });
}

/** Product renderer. It does not reuse an owner browser, cookie jar or session. */
export async function captureJob(config, job, { signal, chromium, browserEnvironment = process.env } = {}) {
  let browser;
  let closeOnAbort;
  let phase = "browser_launch";
  let pageFailure;
  try {
    const engine = chromium || (await import("playwright")).chromium;
    browser = await abortable(engine.launch({
      headless: true,
      channel: "chromium",
      // Render does not expose custom Docker seccomp/user-namespace options.
      // Run as pwuser, restrict navigation to our own capture origin, and never
      // give the browser service credentials or an authenticated owner session.
      chromiumSandbox: false,
      env: safeChildEnvironment(browserEnvironment),
      args: [
        "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
        "--disable-dev-shm-usage", "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
      ],
    }), signal, value => value.close().catch(() => {}));
    closeOnAbort = () => { void browser.close().catch(() => {}); };
    signal?.addEventListener("abort", closeOnAbort, { once: true });
    phase = "browser_context";
    const context = await abortable(browser.newContext({
      viewport: { width: 1080, height: job.kind === "reel" ? 1920 : 1350 },
      deviceScaleFactor: 1, permissions: [], acceptDownloads: false,
      serviceWorkers: "block", colorScheme: "dark", reducedMotion: "no-preference",
    }), signal);
    await context.route("**/*", async route => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        if (["data:", "blob:"].includes(url.protocol)) return route.continue();
        if (url.origin !== config.origin || url.username || url.password
          || request.method() !== "GET" || /^\/api(?:\/|$)/.test(url.pathname)) return route.abort();
        const requestHeaders = { ...request.headers() };
        delete requestHeaders.authorization;
        delete requestHeaders.cookie;
        return route.continue({ headers: requestHeaders });
      } catch { return route.abort(); }
    });
    const page = await abortable(context.newPage(), signal);
    // Retain only categories: browser messages and stack traces can contain
    // URLs or arbitrary page content and must never enter worker logs.
    page.on("pageerror", error => { pageFailure = {
      reason: "page_error", ...(CAPTURE_ERROR_NAMES.has(error?.name) ? { errorName: error.name } : {}),
    }; });
    page.on("crash", () => { pageFailure = { reason: "page_crashed" }; });
    page.setDefaultTimeout(30_000);
    phase = "navigation";
    const response = await abortable(page.goto(`${config.origin}/capture`, { waitUntil: "domcontentloaded", timeout: 30_000 }), signal);
    if (!response?.ok() || new URL(page.url()).origin !== config.origin || new URL(page.url()).pathname !== "/capture") throw new WorkerError("render_failed");
    phase = "contract";
    await abortable(page.waitForFunction(() => typeof window.gaetanoCapture?.initialize === "function"
      && typeof window.gaetanoCapture?.capture === "function", undefined, { timeout: 45_000 }), signal);
    // These two explicitly selected public arguments are the entire browser input.
    // In particular, never inject job, config, the lease or request headers.
    phase = "initialize";
    await abortable(page.evaluate(async ({ state, camera }) => {
      await window.gaetanoCapture.initialize(state, camera);
    }, { state: job.state, camera: job.camera }), signal);
    phase = "capture";
    return await abortable(page.evaluate(async ({ kind, camera }) => {
      return await window.gaetanoCapture.capture(kind, camera);
    }, { kind: job.kind, camera: job.camera }), signal);
  } catch (error) {
    throw captureFailure(error, phase, pageFailure, signal);
  } finally {
    if (closeOnAbort) signal?.removeEventListener("abort", closeOnAbort);
    if (browser) {
      // Cleanup is bounded even if Chromium's control connection has died.
      const timer = AbortSignal.timeout(5_000);
      await abortable(browser.close(), timer).catch(() => {});
    }
  }
}
