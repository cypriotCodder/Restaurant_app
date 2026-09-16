import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireStaff } from "@/lib/staffAuth";
import { getStorage } from "@/lib/storage";
import { processMenuPhoto } from "@/lib/photos";

// Menu photo upload. Photos are resized and re-encoded as WebP before they
// are written to UPLOAD_DIR on the venue's disk — deliberately outside the
// application directory, so an app update cannot delete them — and read back
// through /api/media. See src/lib/storage and src/lib/photos.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  // Generous: the original is never stored, only what comes out of the resize.
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
  if (!ACCEPTED.has(file.type)) return NextResponse.json({ error: "bad_type" }, { status: 415 });

  let photo;
  try {
    photo = await processMenuPhoto(Buffer.from(await file.arrayBuffer()));
  } catch {
    // The declared type was a lie, or the bytes are not decodable.
    return NextResponse.json({ error: "bad_type" }, { status: 415 });
  }

  // Namespaced per venue so one tenant's uploads can never collide with or
  // overwrite another's.
  const key = `menu/${staff.venueId}/${randomBytes(8).toString("hex")}${photo.ext}`;
  try {
    const stored = await getStorage().put(key, photo.bytes);
    return NextResponse.json({ ok: true, url: stored.url, width: photo.width, height: photo.height });
  } catch (err) {
    console.error("upload failed:", err);
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }
}
