import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

console.log("==================================================");
console.log(" PrivacyLens — Extension Production Packager");
console.log("==================================================");

// 1. Validate manifest
const manifestPath = path.resolve("apps/extension/manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("Error: manifest.json not found!");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
console.log(`Packaging ${manifest.name} v${manifest.version} (Manifest V${manifest.manifest_version})...`);

// 2. Build extension
console.log("\n[1/3] Building clean production bundles with esbuild...");
execSync("npm run build -w apps/extension", { stdio: "inherit" });

// 3. Verify all bundle assets exist
console.log("\n[2/3] Verifying bundle assets integrity...");
const requiredFiles = [
  "apps/extension/manifest.json",
  "apps/extension/dist/background.js",
  "apps/extension/dist/content.js",
  "apps/extension/dist/sidepanel/index.html",
  "apps/extension/dist/sidepanel/panel.js",
  "apps/extension/dist/options/index.html",
  "apps/extension/dist/options/options.js",
  "apps/extension/dist/popup/index.html",
  "apps/extension/dist/popup/popup.js",
  "apps/extension/dist/offscreen/index.html",
  "apps/extension/dist/offscreen/worker.js",
];

for (const rel of requiredFiles) {
  const full = path.resolve(rel);
  if (!fs.existsSync(full)) {
    console.error(`Missing required build asset: ${rel}`);
    process.exit(1);
  }
  const size = fs.statSync(full).size;
  console.log(`  ✓ Verified ${rel} (${size.toLocaleString()} bytes)`);
}

// 4. Create release directory & zip
const releaseDir = path.resolve("release");
if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

const zipPath = path.join(releaseDir, `privacylens-extension-v${manifest.version}.zip`);
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

console.log("\n[3/3] Creating distribution zip archive...");
// Package apps/extension into zip using PowerShell Compress-Archive
const psCmd = `Compress-Archive -Path "apps/extension/manifest.json", "apps/extension/dist" -DestinationPath "${zipPath}" -Force`;
execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: "inherit" });

if (fs.existsSync(zipPath)) {
  const zipBuffer = fs.readFileSync(zipPath);
  const zipSize = zipBuffer.length;
  const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");

  console.log("\n==================================================");
  console.log(" PRODUCTION ZIP PACKAGE CREATED SUCCESSFULLY!");
  console.log("==================================================");
  console.log(`Destination: ${zipPath}`);
  console.log(`Size:        ${(zipSize / 1024).toFixed(1)} KB (${zipSize.toLocaleString()} bytes)`);
  console.log(`SHA-256:     ${sha256}`);
  console.log("==================================================\n");
} else {
  console.error("Packaging failed: zip archive was not generated.");
  process.exit(1);
}

