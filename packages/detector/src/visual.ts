export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DenyRegionCategory =
  | "VIDEO_STREAM"
  | "CANVAS"
  | "CROSS_ORIGIN_FRAME"
  | "SENSITIVE_BOUNDING_BOX";

export interface DefaultDenyRegion {
  id: string;
  category: DenyRegionCategory;
  box: BoundingBox;
  reason: string;
}

/**
 * Computes default-deny visual regions from DOM metadata (FR-B5).
 * Tags like <video>, <canvas>, and <iframe> must be blocked out by default
 * to prevent leaking faces, private feeds, or cross-origin secrets.
 */
export function identifyDefaultDenyRegions(
  elements: Array<{
    id: string;
    tag: string;
    box: BoundingBox;
    isCrossOrigin?: boolean;
  }>
): DefaultDenyRegion[] {
  const regions: DefaultDenyRegion[] = [];

  for (const el of elements) {
    const tag = el.tag.toLowerCase();

    if (tag === "video") {
      regions.push({
        id: el.id,
        category: "VIDEO_STREAM",
        box: el.box,
        reason: "Default-deny video tile: prevents face or screen leakage",
      });
    } else if (tag === "canvas") {
      regions.push({
        id: el.id,
        category: "CANVAS",
        box: el.box,
        reason: "Default-deny canvas: prevents dynamic graphic/chart leakage",
      });
    } else if (tag === "iframe" && el.isCrossOrigin) {
      regions.push({
        id: el.id,
        category: "CROSS_ORIGIN_FRAME",
        box: el.box,
        reason: "Default-deny cross-origin frame: uninspected third-party content",
      });
    }
  }

  return regions;
}

/**
 * Applies solid opaque fill redactions over target bounding boxes (FR-B5).
 * Strictly forbids blur or pixelation, which are mathematically reversible.
 */
export function applySolidFillRedaction(
  imageDimensions: { width: number; height: number },
  regions: DefaultDenyRegion[],
  fillColorHex: string = "#000000"
): {
  redactedRegionCount: number;
  fillColor: string;
  coveredBoxes: BoundingBox[];
} {
  const coveredBoxes: BoundingBox[] = [];

  for (const region of regions) {
    // Clamp coordinates to image boundary
    const x = Math.max(0, region.box.x);
    const y = Math.max(0, region.box.y);
    const w = Math.min(imageDimensions.width - x, region.box.width);
    const h = Math.min(imageDimensions.height - y, region.box.height);

    if (w > 0 && h > 0) {
      coveredBoxes.push({ x, y, width: w, height: h });
    }
  }

  return {
    redactedRegionCount: coveredBoxes.length,
    fillColor: fillColorHex,
    coveredBoxes,
  };
}

