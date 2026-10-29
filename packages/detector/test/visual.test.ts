import { describe, it, expect } from "vitest";
import {
  identifyDefaultDenyRegions,
  applySolidFillRedaction,
  DefaultDenyRegion,
} from "../src/visual.js";

describe("FR-B5 Visual Default-Deny Engine", () => {
  it("identifies video, canvas, and cross-origin iframe elements for default-deny redaction", () => {
    const elements = [
      { id: "vid_1", tag: "video", box: { x: 10, y: 10, width: 640, height: 480 } },
      { id: "canvas_1", tag: "canvas", box: { x: 50, y: 500, width: 300, height: 200 } },
      { id: "frame_thirdparty", tag: "iframe", box: { x: 0, y: 720, width: 800, height: 600 }, isCrossOrigin: true },
      { id: "frame_sameorigin", tag: "iframe", box: { x: 0, y: 1350, width: 800, height: 200 }, isCrossOrigin: false },
      { id: "btn_submit", tag: "button", box: { x: 100, y: 1600, width: 120, height: 40 } },
    ];

    const regions = identifyDefaultDenyRegions(elements);

    expect(regions).toHaveLength(3);
    expect(regions[0].id).toBe("vid_1");
    expect(regions[0].category).toBe("VIDEO_STREAM");
    expect(regions[1].id).toBe("canvas_1");
    expect(regions[1].category).toBe("CANVAS");
    expect(regions[2].id).toBe("frame_thirdparty");
    expect(regions[2].category).toBe("CROSS_ORIGIN_FRAME");
  });

  it("applies solid opaque #000000 fill and clamps coordinates strictly to image viewport bounds", () => {
    const imageDims = { width: 1920, height: 1080 };
    const regions: DefaultDenyRegion[] = [
      {
        id: "v1",
        category: "VIDEO_STREAM",
        box: { x: 100, y: 100, width: 400, height: 300 },
        reason: "Face stream",
      },
      // Box overflowing beyond viewport
      {
        id: "v2",
        category: "VIDEO_STREAM",
        box: { x: 1800, y: 900, width: 500, height: 500 },
        reason: "Overflowing feed",
      },
    ];

    const redaction = applySolidFillRedaction(imageDims, regions, "#000000");

    expect(redaction.redactedRegionCount).toBe(2);
    expect(redaction.fillColor).toBe("#000000");

    // Box 1 should remain unclamped
    expect(redaction.coveredBoxes[0]).toEqual({ x: 100, y: 100, width: 400, height: 300 });

    // Box 2 should be clamped to 1920 - 1800 = 120 width, 1080 - 900 = 180 height
    expect(redaction.coveredBoxes[1]).toEqual({ x: 1800, y: 900, width: 120, height: 180 });
  });

  it("filters out boxes that fall entirely outside image bounds", () => {
    const imageDims = { width: 800, height: 600 };
    const regions: DefaultDenyRegion[] = [
      {
        id: "v_out",
        category: "VIDEO_STREAM",
        box: { x: 900, y: 700, width: 200, height: 200 },
        reason: "Off-screen stream",
      },
    ];

    const redaction = applySolidFillRedaction(imageDims, regions);
    expect(redaction.redactedRegionCount).toBe(0);
  });
});
