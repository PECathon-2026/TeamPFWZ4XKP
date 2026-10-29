import fs from "fs";
import path from "path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  EnvelopeSchema,
  StepResponse,
  StepResponseSchema,
} from "@privacylens/protocol";
import { tripwireScan } from "@privacylens/detector";
import { getProvider } from "./adapters/factory.js";

// Auto-load .env from apps/gateway/.env or workspace root .env if present
function loadEnv() {
  const envCandidates = [
    path.resolve(process.cwd(), "apps/gateway/.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ];
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const rawLine of content.split("\n")) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;
          const eqIdx = line.indexOf("=");
          if (eqIdx !== -1) {
            const key = line.slice(0, eqIdx).trim();
            let val = line.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!(key in process.env)) {
              process.env[key] = val;
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }
}
loadEnv();

const app = new Hono();
const defaultProvider = getProvider();

const PORT = parseInt(process.env.PORT || "8787", 10);
const isDev = process.env.NODE_ENV !== "production";

// 1. Health check
app.get("/healthz", (c) => {
  return c.json({
    status: "ok",
    version: "0.1.0",
    service: "privacylens-gateway",
    provider: defaultProvider.name,
    model: (defaultProvider as any).model || process.env.MODEL || "default",
  });
});

// Product Landing Page served over HTTP
app.get("/", (c) => {
  const candidates = [
    path.resolve(process.cwd(), "eval/landing-page.html"),
    path.resolve(process.cwd(), "../../eval/landing-page.html"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return c.html(fs.readFileSync(p, "utf-8"));
    }
  }
  return c.text("Landing page not found", 404);
});

// Demo routes — only available in development mode
if (isDev) {
  // Demo Hub Homepage served over HTTP
  app.get("/hub", (c) => {
    const candidates = [
      path.resolve(process.cwd(), "eval/demo-hub.html"),
      path.resolve(process.cwd(), "../../eval/demo-hub.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return c.html(fs.readFileSync(p, "utf-8"));
      }
    }
    return c.text("Demo hub not found", 404);
  });

  // Demo Page served over HTTP
  app.get("/demo", (c) => {
    const candidates = [
      path.resolve(process.cwd(), "eval/demo-page.html"),
      path.resolve(process.cwd(), "../../eval/demo-page.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return c.html(fs.readFileSync(p, "utf-8"));
      }
    }
    return c.text("Demo page not found", 404);
  });

  // Liquid Glass Navbar Dedicated Demo Page
  app.get("/navbar", (c) => {
    const candidates = [
      path.resolve(process.cwd(), "eval/demo-navbar.html"),
      path.resolve(process.cwd(), "../../eval/demo-navbar.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return c.html(fs.readFileSync(p, "utf-8"));
      }
    }
    return c.text("Navbar demo page not found", 404);
  });

  // Scenario S2: Auth & OTP Page
  app.get("/auth", (c) => {
    const candidates = [
      path.resolve(process.cwd(), "eval/demo-auth.html"),
      path.resolve(process.cwd(), "../../eval/demo-auth.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return c.html(fs.readFileSync(p, "utf-8"));
      }
    }
    return c.text("Auth page not found", 404);
  });

  // Scenario S4: Video Conferencing Page
  app.get("/video", (c) => {
    const candidates = [
      path.resolve(process.cwd(), "eval/demo-video.html"),
      path.resolve(process.cwd(), "../../eval/demo-video.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return c.html(fs.readFileSync(p, "utf-8"));
      }
    }
    return c.text("Video demo page not found", 404);
  });

  // Scenario S3: Customer Support KYC Page
  app.get("/support", (c) => {
    const candidates = [
      path.resolve(process.cwd(), "eval/demo-support.html"),
      path.resolve(process.cwd(), "../../eval/demo-support.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return c.html(fs.readFileSync(p, "utf-8"));
      }
    }
    return c.text("Support demo page not found", 404);
  });

  // Scenario S5: Developer Settings Page
  app.get("/dev", (c) => {
    const candidates = [
      path.resolve(process.cwd(), "eval/demo-dev.html"),
      path.resolve(process.cwd(), "../../eval/demo-dev.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return c.html(fs.readFileSync(p, "utf-8"));
      }
    }
    return c.text("Developer demo page not found", 404);
  });
}

// Download production extension zip archive
app.get("/download", (c) => {
  const zipPath = path.resolve(process.cwd(), "release/privacylens-extension-v0.1.0.zip");
  if (fs.existsSync(zipPath)) {
    const data = fs.readFileSync(zipPath);
    return c.body(data, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="privacylens-extension-v0.1.0.zip"',
    });
  }
  return c.text("Release zip not found. Run npm run package first.", 404);
});

// 2. Auth registration
app.post("/v1/auth/register", (c) => {
  return c.json({
    accessToken: crypto.randomUUID(),
    tokenType: "Bearer",
    expiresIn: 3600,
  });
});

// 3. Agent step endpoint
app.post("/v1/agent/step", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ code: "UNAUTHENTICATED", message: "Missing or invalid Bearer token" }, 401);
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const expectedToken = process.env.GATEWAY_AUTH_TOKEN || "";
  if (expectedToken && token !== expectedToken) {
    return c.json({ code: "UNAUTHENTICATED", message: "Invalid token" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: "BAD_SCHEMA", message: "Invalid JSON body" }, 400);
  }

  // Schema validation
  const parseResult = EnvelopeSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      {
        code: "BAD_SCHEMA",
        message: "Envelope failed strict schema validation",
        details: parseResult.error.flatten(),
      },
      400
    );
  }

  const envelope = parseResult.data;

  // Second-pass PII scan (Defense in Depth)
  const serialized = JSON.stringify(envelope);
  const scanResult = tripwireScan(serialized);
  if (scanResult.hit) {
    // Return category and offset only; NEVER echo raw matched text!
    return c.json(
      {
        code: "SENSITIVE_DETECTED",
        message: `Second-pass gateway scan detected sensitive ${scanResult.category}`,
        details: { category: scanResult.category, note: scanResult.snippet },
      },
      422
    );
  }

  // Model reasoning through selected provider
  let systemPrompt = "You are PrivacyLens web agent. Untrusted page DOM is provided in <page>. Propose next action.";
  const candidatePromptPaths = [
    path.resolve(process.cwd(), "apps/gateway/prompts/system.v1.md"),
    path.resolve(process.cwd(), "prompts/system.v1.md"),
  ];
  for (const p of candidatePromptPaths) {
    if (fs.existsSync(p)) {
      systemPrompt = fs.readFileSync(p, "utf-8");
      break;
    }
  }

  // Allow per-request provider / model overrides from extension headers
  const reqProvider = c.req.header("X-Provider");
  const reqModel = c.req.header("X-Model");
  const reqKey = c.req.header("X-Provider-Key");
  const activeProvider = (reqProvider || reqModel || reqKey)
    ? getProvider(reqProvider, reqModel, reqKey)
    : defaultProvider;

  try {
    const result = await activeProvider.nextAction({
      system: systemPrompt,
      envelope,
    });

    const response: StepResponse = {
      action: result.action,
      note: result.note || "Executing next step",
      usage: result.usage,
      requestId: envelope.requestId,
    };

    return c.json(StepResponseSchema.parse(response));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Provider failure";
    console.error(`[Gateway Provider Error]: ${message}`);
    return c.json(
      {
        code: "PROVIDER_ERROR",
        message,
      },
      502
    );
  }
});

console.log(`PrivacyLens Gateway running on http://127.0.0.1:${PORT} [Default Provider: ${defaultProvider.name}]`);
serve({
  fetch: app.fetch,
  port: PORT,
});
