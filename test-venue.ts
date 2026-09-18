import { db } from "./src/lib/db";
import { listBridgeKeys, CURRENCIES, POS_ADAPTERS } from "./src/lib/venueSettings";

async function run() {
  const staff = await db.staffUser.findFirst({ where: { active: true } });
  if (!staff) throw new Error("No staff");
  console.log("Using venueId:", staff.venueId);

  const venue = await db.venue.findUniqueOrThrow({
    where: { id: staff.venueId },
    select: { name: true, slug: true, currency: true, defaultLocale: true, posAdapter: true },
  });
  const tableCount = await db.table.count({ where: { venueId: staff.venueId } });
  const bridgeKeys = await listBridgeKeys(staff.venueId);

  console.log({ venue, tableCount, bridgeKeys, options: { currencies: CURRENCIES, posAdapters: POS_ADAPTERS } });
}
run().catch(console.error).finally(() => process.exit(0));
