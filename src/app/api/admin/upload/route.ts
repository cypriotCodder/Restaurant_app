import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { put } from "@vercel/blob";
import { requireStaff } from "@/lib/staffAuth";

// Menu photo upload → Vercel Blob. Previously written to public/uploads, which
// does not survive on serverless: the filesystem is per-invocation, so an
// uploaded photo vanished on the next deploy (or simply the next request).
export async function POST(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[file.type];
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 415 });

  // Namespaced per venue so one tenant's uploads can never collide with or
  // overwrite another's.
  const key = `menu/${staff.venueId}/${randomBytes(8).toString("hex")}${ext}`;
  try {
    const blob = await put(key, file, { access: "public", contentType: file.type });
    return NextResponse.json({ ok: true, url: blob.url });
  } catch (err) {
    console.error("blob upload failed:", err);
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }
}
