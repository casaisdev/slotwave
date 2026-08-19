// Headless screenshots of the stage for visual review (idle + playing).
// Usage: node scripts/screenshot.mjs [outDir] [width] [height]
// (needs `npm run dev` running)
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const outDir = process.argv[2] ?? "screenshots";
const width = Number(process.argv[3] ?? 1440);
const height = Number(process.argv[4] ?? 900);
const CHROME =
  process.env.CHROME_PATH ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${outDir}/stage-idle.png` });

const clicked = await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("start listening"),
  );
  if (!button) return false;
  button.click();
  return true;
});
console.log("start clicked:", clicked);

await new Promise((r) => setTimeout(r, 30_000)); // ~75 slots of tape
await page.screenshot({ path: `${outDir}/stage-playing.png` });
await browser.close();
console.log(`wrote ${outDir}/stage-idle.png and ${outDir}/stage-playing.png`);
