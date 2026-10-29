import { DefaultDenyRegion } from "@privacylens/detector";

const canvas = document.getElementById("mask-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { willReadFrequently: true });

/**
 * Offscreen worker for FR-B5 Visual Default-Deny Solid Fill.
 * Strictly enforces solid opaque #000000 redaction. Reversible blurring/pixelation is forbidden.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "MASK_IMAGE") {
    const { imageDataUrl, regions } = message as {
      imageDataUrl: string;
      regions: DefaultDenyRegion[];
    };

    if (!imageDataUrl || !ctx) {
      sendResponse({ ok: false, error: "Canvas context or image missing" });
      return true;
    }

    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;

      // 1. Draw base screenshot
      ctx.drawImage(img, 0, 0);

      // 2. Apply solid opaque #000000 fill over each region
      ctx.fillStyle = "#000000";
      for (const region of regions || []) {
        const { x, y, width, height } = region.box;
        const clampedX = Math.max(0, x);
        const clampedY = Math.max(0, y);
        const clampedW = Math.min(canvas.width - clampedX, width);
        const clampedH = Math.min(canvas.height - clampedY, height);

        if (clampedW > 0 && clampedH > 0) {
          ctx.fillRect(clampedX, clampedY, clampedW, clampedH);
        }
      }

      // 3. Export sanitized PNG data URL
      const maskedDataUrl = canvas.toDataURL("image/png");
      sendResponse({ ok: true, maskedDataUrl });
    };

    img.onerror = (err) => {
      sendResponse({ ok: false, error: `Failed to load image: ${err}` });
    };

    img.src = imageDataUrl;
    return true; // Keep message channel open for async response
  }
});

