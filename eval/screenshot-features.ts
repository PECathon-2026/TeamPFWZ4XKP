import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";
import os from "os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR = "C:\\Users\\Asus\\.gemini\\antigravity\\brain\\d0a0d8c5-6365-466c-933b-7a764e55e21b";

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "privacylens-features-view-"));
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      `--user-data-dir=${tmpDir}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--window-size=1280,960"
    ],
    defaultViewport: {
      width: 1280,
      height: 960,
      deviceScaleFactor: 2
    }
  });

  const page = await browser.newPage();

  // 1. Capture landing page at #features
  console.log("Navigating to http://127.0.0.1:8787/#features ...");
  await page.goto("http://127.0.0.1:8787/#features", { waitUntil: "domcontentloaded", timeout: 15000 });
  await new Promise(r => setTimeout(r, 1500));

  // Scroll to #features section
  await page.evaluate(() => {
    const el = document.getElementById("features");
    if (el) el.scrollIntoView({ behavior: "instant" });
  });
  await new Promise(r => setTimeout(r, 800));

  const landingFeaturesPath = path.join(ARTIFACT_DIR, "00-landing-features-bento.png");
  await page.screenshot({ path: landingFeaturesPath });
  console.log("Saved landing features bento screenshot to:", landingFeaturesPath);

  // Also capture the top of landing page showing the floating liquid glass navbar
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await new Promise(r => setTimeout(r, 800));
  const landingNavPath = path.join(ARTIFACT_DIR, "00-landing-navbar-live.png");
  await page.screenshot({ path: landingNavPath });
  console.log("Saved landing navbar screenshot to:", landingNavPath);

  // 2. Capture dedicated /features page
  console.log("Navigating to http://127.0.0.1:8787/features ...");
  await page.goto("http://127.0.0.1:8787/features", { waitUntil: "domcontentloaded", timeout: 15000 });
  await new Promise(r => setTimeout(r, 1500));

  // Hover over tool 1 to showcase interactivity
  const tool1 = await page.$("#tool-1");
  if (tool1) {
    await tool1.click();
    await new Promise(r => setTimeout(r, 500));
  }

  const featuresDemoPath = path.join(ARTIFACT_DIR, "00-features-demo-page.png");
  await page.screenshot({ path: featuresDemoPath, fullPage: true });
  console.log("Saved features demo page screenshot to:", featuresDemoPath);

  await browser.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
