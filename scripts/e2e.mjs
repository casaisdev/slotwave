// End-to-end smoke test against a running dev server.
// Usage: npm run e2e   (needs `npm run dev` on localhost:3000)
import puppeteer from "puppeteer-core";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
const failures = [];
const check = (name, condition) => {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}`);
  if (!condition) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    // CI runners often need the sandbox disabled to launch system Chrome
    ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
  ],
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(BASE, { waitUntil: "networkidle2" });

  const clickButton = (text) =>
    page.evaluate((t) => {
      const button = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.trim().includes(t),
      );
      if (!button) return false;
      button.click();
      return true;
    }, text);
  const slotText = () =>
    page.$eval('[data-testid="slot-readout"]', (el) => el.textContent ?? "");
  const transportLabel = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .map((b) => b.textContent?.trim())
        .find((t) => t === "pause" || t === "resume" || t === "start"),
    );

  // idle state
  check(
    "idle shows the start affordance",
    await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("start listening"),
      ),
    ),
  );

  // farcaster mini app surface
  const manifest = await page.evaluate(() =>
    fetch("/.well-known/farcaster.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  );
  check(
    "farcaster manifest served",
    manifest?.miniapp?.version === "1" &&
      typeof manifest?.miniapp?.iconUrl === "string",
  );
  const embedMeta = await page.evaluate(
    () =>
      document
        .querySelector('meta[name="fc:miniapp"]')
        ?.getAttribute("content") ?? "",
  );
  check("fc:miniapp embed meta present", embedMeta.includes('"launch_frame"'));
  check(
    "embed image responds",
    await page.evaluate(() =>
      fetch("/embed-image").then((r) => r.ok).catch(() => false),
    ),
  );

  // live is the default source
  check(
    "live is the default mode",
    (await page.evaluate(
      () =>
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent?.trim() === "live")
          ?.getAttribute("aria-pressed"),
    )) === "true",
  );

  // the tape tests run on replay (deterministic, no RPC)
  check("replay toggle lands", await clickButton("replay"));
  check("start click lands", await clickButton("start listening"));
  await sleep(3000);
  const firstSlot = await slotText();
  await sleep(1500);
  const secondSlot = await slotText();
  check(
    "playback advances the slot readout",
    firstSlot !== "—" && firstSlot !== "" && secondSlot !== firstSlot,
  );

  // the stage actually painted something
  const paintedSamples = await page.$eval("canvas", (canvas) => {
    const data = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let hits = 0;
    for (let i = 3; i < data.length; i += 400) if (data[i] > 0) hits += 1;
    return hits;
  });
  check("canvas painted the tape", paintedSamples > 50);

  // rewind moves the playhead back (replay lag reads "N / M")
  const lagPosition = async () => {
    const text = await page.$eval(
      '[data-testid="lag"]',
      (el) => el.textContent ?? "",
    );
    return Number(text.match(/(\d+)\s*\//)?.[1] ?? NaN);
  };
  const positionBefore = await lagPosition();
  await clickButton("‹ 30s");
  await sleep(700);
  const positionAfter = await lagPosition();
  check(
    "rewind moves the playhead back",
    Number.isFinite(positionBefore) && positionAfter < positionBefore,
  );

  // space toggles pause/resume
  await page.keyboard.press("Space");
  await sleep(400);
  check("space pauses", (await transportLabel()) === "resume");
  await page.keyboard.press("Space");
  await sleep(400);
  check("space resumes", (await transportLabel()) === "pause");

  // deep link forces live mode; with a key it lands, without it falls back
  const tip = await page
    .evaluate(() =>
      fetch("/api/tip").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    );
  if (tip?.finalized) {
    const target = tip.finalized - 100;
    await page.goto(`${BASE}/?slot=${target}`, { waitUntil: "networkidle2" });
    const livePressed = await page.evaluate(
      () =>
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent?.trim() === "live")
          ?.getAttribute("aria-pressed"),
    );
    check("deep link forces live mode", livePressed === "true");
    await clickButton("start listening");
    // poll instead of a fixed wait: cold windows on a busy machine (or a CI
    // runner) can take well over the usual few seconds
    let landed = false;
    let fellBack = false;
    for (let i = 0; i < 15 && !landed && !fellBack; i++) {
      await sleep(2000);
      const landedText = (await slotText()).replace(/,/g, "");
      landed =
        landedText !== "—" &&
        landedText !== "" &&
        Math.abs(Number(landedText) - target) < 200;
      fellBack = !!(await page.evaluate(() =>
        document.body.textContent?.includes("live unavailable"),
      ));
    }
    check("deep link lands the tape (or falls back cleanly)", landed || fellBack);
  } else {
    console.log("skip deep-link block: /api/tip unavailable");
  }

  if (pageErrors.length > 0) console.error(pageErrors);
  check("no uncaught page errors", pageErrors.length === 0);
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`E2E FAILED (${failures.length}): ${failures.join(" | ")}`);
  process.exit(1);
}
console.log("E2E PASS");
