import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processMenuPhoto, MAX_EDGE } from "@/lib/photos";

// Uploads are resized before they touch the disk. These run real sharp on
// generated images; there is no mock worth having for a resize.

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 30 } } })
    .png()
    .toBuffer();

describe("processMenuPhoto", () => {
  it("caps the long side and re-encodes as WebP", async () => {
    const out = await processMenuPhoto(await png(3000, 2000));
    expect(out.contentType).toBe("image/webp");
    expect(out.ext).toBe(".webp");
    expect(out.width).toBe(MAX_EDGE);
    expect(out.height).toBe(800);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("webp");
  });

  it("never enlarges a small photo", async () => {
    const out = await processMenuPhoto(await png(400, 300));
    expect(out.width).toBe(400);
    expect(out.height).toBe(300);
  });

  it("refuses bytes that are not an image", async () => {
    await expect(processMenuPhoto(Buffer.from("<html>not a photo</html>"))).rejects.toThrow();
  });
});
