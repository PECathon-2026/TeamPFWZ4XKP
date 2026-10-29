import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";

const outdir = path.resolve("dist");
if (!fs.existsSync(outdir)) {
  fs.mkdirSync(outdir, { recursive: true });
}

// 1. Bundle Background, Sidepanel, Options, Popup & Offscreen (ESM)
await esbuild.build({
  entryPoints: {
    background: "entrypoints/background.ts",
    "sidepanel/panel": "entrypoints/sidepanel/panel.ts",
    "options/options": "entrypoints/options/options.ts",
    "popup/popup": "entrypoints/popup/popup.ts",
    "offscreen/worker": "entrypoints/offscreen/worker.ts",
  },
  bundle: true,
  outdir: "dist",
  format: "esm",
  target: "es2022",
  sourcemap: true,
});

// 2. Bundle Content Script (IIFE for safe isolated-world execution)
await esbuild.build({
  entryPoints: {
    content: "entrypoints/content.ts",
  },
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "es2022",
  sourcemap: true,
});

// 3. Copy Sidepanel index.html
fs.mkdirSync(path.join(outdir, "sidepanel"), { recursive: true });
fs.copyFileSync(
  path.resolve("entrypoints/sidepanel/index.html"),
  path.join(outdir, "sidepanel/index.html")
);

// 4. Copy Options index.html
fs.mkdirSync(path.join(outdir, "options"), { recursive: true });
fs.copyFileSync(
  path.resolve("entrypoints/options/index.html"),
  path.join(outdir, "options/index.html")
);

// 5. Copy Popup index.html
fs.mkdirSync(path.join(outdir, "popup"), { recursive: true });
fs.copyFileSync(
  path.resolve("entrypoints/popup/index.html"),
  path.join(outdir, "popup/index.html")
);

// 6. Copy Offscreen index.html
fs.mkdirSync(path.join(outdir, "offscreen"), { recursive: true });
fs.copyFileSync(
  path.resolve("entrypoints/offscreen/index.html"),
  path.join(outdir, "offscreen/index.html")
);

console.log("PrivacyLens Extension bundled successfully into apps/extension/dist/");

