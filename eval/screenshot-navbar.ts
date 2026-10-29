import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";
import os from "os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR = "C:\\Users\\Asus\\.gemini\\antigravity\\brain\\d0a0d8c5-6365-466c-933b-7a764e55e21b";

async function captureNavbarDemo() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "privacylens-navdemo-"));
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      `--user-data-dir=${tmpDir}`,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--window-size=1280,800"
    ],
    defaultViewport: {
      width: 1280,
      height: 800,
      deviceScaleFactor: 2
    }
  });

  const page = await browser.newPage();
  console.log("Navigating to http://127.0.0.1:8787/navbar ...");
  await page.goto("http://127.0.0.1:8787/navbar", { waitUntil: "domcontentloaded", timeout: 15000 });
  await new Promise(r => setTimeout(r, 1200));

  const navPath = path.join(ARTIFACT_DIR, "00-liquid-navbar-demo.png");
  await page.screenshot({ path: navPath, fullPage: false });
  console.log("Saved navbar demo screenshot to:", navPath);

  await browser.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {}
}

captureNavbarDemo().catch(console.error);

