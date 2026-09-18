import { db } from "./src/lib/db";

async function run() {
  await db.bridgeKey.deleteMany({});
  console.log("Deleted all rows from BridgeKey");
}

run().catch(console.error).finally(() => process.exit(0));
