// Runs once when the server starts. Validating here means a deployment with a
// missing or malformed variable fails immediately and visibly, instead of
// booting "healthy" and only breaking when a customer scans a QR.
export async function register() {
  // Only the Node.js server runtime has the full environment; skip on edge.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEnv } = await import("./src/lib/env");
  getEnv();
}
