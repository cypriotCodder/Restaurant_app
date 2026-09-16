import sharp from "sharp";

// Menu photo processing.
//
// Uploads used to be written byte-for-byte: a 4 MB phone photo stayed 4 MB on
// the venue's disk, went into every backup, and was decoded in full by the
// image optimiser for each size it served — on the Windows venue PC through
// WebAssembly sharp, which is several times slower than native. Nothing on a
// phone menu is ever shown wider than a few hundred CSS pixels, so the stored
// file is capped at MAX_EDGE on its long side and re-encoded as WebP.

/** Long-side cap. Two cards per row at 3× DPR on a large phone needs ~700px. */
export const MAX_EDGE = 1200;
export const WEBP_QUALITY = 82;
/** Anything above this is not a menu photo; refuse before decoding it. */
export const MAX_SOURCE_PIXELS = 40_000_000;

export type ProcessedPhoto = { bytes: Buffer; contentType: "image/webp"; ext: ".webp"; width: number; height: number };

export async function processMenuPhoto(input: Buffer): Promise<ProcessedPhoto> {
  const meta = await sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS }).metadata();
  if (!meta.width || !meta.height) throw new Error("not an image");

  const out = sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS })
    // Phones store orientation in EXIF; bake it in and drop the metadata.
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY });
  const { data, info } = await out.toBuffer({ resolveWithObject: true });
  return { bytes: data, contentType: "image/webp", ext: ".webp", width: info.width, height: info.height };
}
