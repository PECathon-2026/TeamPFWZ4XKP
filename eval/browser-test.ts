import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";
import os from "os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EXTENSION_PATH = path.resolve("apps/extension");
const SCREENSHOT_DIR = path.resolve("eval/results/screenshots");
const ARTIFACT_DIR = "C:\\Users\\Asus\\.gemini\\antigravity\\brain\\d0a0d8c5-6365-466c-933b-7a764e55e21b";

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

interface ScenarioTestConfig {
  id: string;
  name: string;
  url: string;
  expectedSelectors: string[];
  screenshotName: string;
}

const SCENARIOS: ScenarioTestConfig[] = [
  {
    id: "Landing",
    name: "Product Landing Page",
    url: "http://127.0.0.1:8787/",
    expectedSelectors: ["#playground", "#play-input", ".proof-bar", ".bento-grid"],
    screenshotName: "00-product-landing.png",
  },
  {
    id: "Hub",
    name: "Interactive Benchmark Hub",
    url: "http://127.0.0.1:8787/hub",
    expectedSelectors: [".metrics-bar", ".grid", "a[href='/demo']"],
    screenshotName: "00-demo-hub.png",
  },
  {
    id: "S1",
    name: "E-Commerce Checkout",
    url: "http://127.0.0.1:8787/demo",
    expectedSelectors: ["#cardNumber", "#pay-btn", "#email", "#phone", "#pan"],
    screenshotName: "01-s1-checkout.png",
  },
  {
    id: "S2",
    name: "Auth & 2FA Verification",
    url: "http://127.0.0.1:8787/auth",
    expectedSelectors: ["#email", "#password-input", "#otp-input", "#submit-btn"],
    screenshotName: "02-s2-auth.png",
  },
  {
    id: "S3",
    name: "Customer Support KYC",
    url: "http://127.0.0.1:8787/support",
    expectedSelectors: [".ticket-card", "#resolve-btn"],
    screenshotName: "03-s3-support.png",
  },
  {
    id: "S4",
    name: "Video Conferencing Default-Deny",
    url: "http://127.0.0.1:8787/video",
    expectedSelectors: [".video-tile", "video", "#mute-btn"],
    screenshotName: "04-s4-video.png",
  },
  {
    id: "S5",
    name: "Developer Settings & API Keys",
    url: "http://127.0.0.1:8787/dev",
    expectedSelectors: ["#key-val", "#webhook-url", "#save-btn"],
    screenshotName: "05-s5-developer.png",
  },
];

async function runFullBrowserSuite() {
  console.log("==================================================");
  console.log(" PrivacyLens — Full Browser Suite & Multi-Scenario Test");
  console.log("==================================================");

  const userDataDir = path.join(os.tmpdir(), "pl-suite-profile-" + Date.now());

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,850",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 850 });

    for (let i = 0; i < SCENARIOS.length; i++) {
      const sc = SCENARIOS[i];
      console.log(`\n[${i + 1}/${SCENARIOS.length}] Testing Scenario ${sc.id}: ${sc.name} (${sc.url})`);

      await page.goto(sc.url, { waitUntil: "networkidle0" });
      const title = await page.title();
      console.log(`   ✓ Page loaded: "${title}"`);

      // Verify DOM selectors
      for (const sel of sc.expectedSelectors) {
        const found = await page.$(sel);
        if (!found) {
          throw new Error(`Element selector "${sel}" not found on page ${sc.url}`);
        }
      }
      console.log(`   ✓ All ${sc.expectedSelectors.length} required elements verified.`);

      // Allow overlay injection and rendering
      await new Promise((r) => setTimeout(r, 600));

      const screenshotFile = path.join(SCREENSHOT_DIR, sc.screenshotName);
      await page.screenshot({ path: screenshotFile });
      console.log(`   ✓ Captured: ${sc.screenshotName}`);

      // Copy to artifact dir
      const artifactDest = path.join(ARTIFACT_DIR, sc.screenshotName);
      try {
        fs.copyFileSync(screenshotFile, artifactDest);
      } catch (err) {
        // ignore if artifact dir not writable
      }
    }

    console.log("\n==================================================");
    console.log(" All 6 Scenarios Successfully Tested in Live Chrome!");
    console.log("==================================================");
  } finally {
    await browser.close();
  }
}

runFullBrowserSuite().catch((err) => {
  console.error("Live browser test failed:", err);
  process.exit(1);
});
