import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";
import os from "os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR = "C:\\Users\\Asus\\.gemini\\antigravity\\brain\\d0a0d8c5-6365-466c-933b-7a764e55e21b";

async function captureLandingPage() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "privacylens-landing-view-"));
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      `--user-data-dir=${tmpDir}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--window-size=1280,900"
    ],
    defaultViewport: {
      width: 1280,
      height: 900,
      deviceScaleFactor: 2
    }
  });

  const page = await browser.newPage();
  console.log("Navigating to http://127.0.0.1:8787/ ...");
  await page.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle0", timeout: 15000 });

  // 1. Capture hero & playground
  const heroPath = path.join(ARTIFACT_DIR, "00-product-landing.png");
  await page.screenshot({ path: heroPath, fullPage: false });
  console.log("Saved hero screenshot to:", heroPath);

  // 2. Click a chip to test interactivity
  const chips = await page.$$(".chip");
  if (chips.length > 1) {
    await chips[1].click();
    await new Promise(r => setTimeout(r, 400));
  }

  // 3. Capture full page
  const fullPagePath = path.join(ARTIFACT_DIR, "00-landing-full.png");
  await page.screenshot({ path: fullPagePath, fullPage: true });
  console.log("Saved full page screenshot to:", fullPagePath);

  await browser.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {}

  console.log("Screenshot capture complete!");
}

captureLandingPage().catch(err => {
  console.error("Error capturing landing page:", err);
  process.exit(1);
});

