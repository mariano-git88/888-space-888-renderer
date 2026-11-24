import { abortable, safeChildEnvironment, WorkerError } from "./common.mjs";

/** Product renderer. It does not reuse an owner browser, cookie jar or session. */
export async function captureJob(config, job, { signal, chromium, browserEnvironment = process.env } = {}) {
  let browser;
  let closeOnAbort;
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
    page.setDefaultTimeout(30_000);
    const response = await abortable(page.goto(`${config.origin}/capture`, { waitUntil: "domcontentloaded", timeout: 30_000 }), signal);
    if (!response?.ok() || new URL(page.url()).origin !== config.origin || new URL(page.url()).pathname !== "/capture") throw new WorkerError("render_failed");
    await abortable(page.waitForFunction(() => typeof window.gaetanoCapture?.initialize === "function"
      && typeof window.gaetanoCapture?.capture === "function", undefined, { timeout: 45_000 }), signal);
    // These two explicitly selected public arguments are the entire browser input.
    // In particular, never inject job, config, the lease or request headers.
    await abortable(page.evaluate(async ({ state, camera }) => {
      await window.gaetanoCapture.initialize(state, camera);
    }, { state: job.state, camera: job.camera }), signal);
    return await abortable(page.evaluate(async ({ kind, camera }) => {
      return await window.gaetanoCapture.capture(kind, camera);
    }, { kind: job.kind, camera: job.camera }), signal);
  } catch (error) {
    if (signal?.aborted || (error instanceof WorkerError && error.code === "timeout")) throw new WorkerError("timeout");
    throw new WorkerError("render_failed");
  } finally {
    if (closeOnAbort) signal?.removeEventListener("abort", closeOnAbort);
    if (browser) {
      // Cleanup is bounded even if Chromium's control connection has died.
      const timer = AbortSignal.timeout(5_000);
      await abortable(browser.close(), timer).catch(() => {});
    }
  }
}
