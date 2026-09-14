import { NextResponse } from "next/server";
import { readStored } from "@/lib/storage";

// Serves menu photos stored on disk by the on-prem storage adapter. They live
// in UPLOAD_DIR, outside the application directory, so they cannot be served
// straight out of public/ — and keeping them out of public/ is what stops an
// app update from deleting the venue's images.
//
// Public by design: these are menu photos shown to every customer.
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const stored = await readStored(segments.join("/"));
  if (!stored) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(stored.body), {
    headers: {
      "Content-Type": stored.contentType,
      // Filenames contain a random component and are never reused, so the
      // bytes at a given URL never change.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
