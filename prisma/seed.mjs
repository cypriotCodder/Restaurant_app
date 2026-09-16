import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";

const db = new PrismaClient();
const code = () => randomBytes(6).toString("base64url");
// Mirrors src/lib/bridgeKey.ts: only the hash is stored, the plaintext is
// printed once below.
const bridgeKey = "bridge-" + randomBytes(16).toString("hex");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Staff credentials come from the environment so a real deployment is never
// seeded with a password published in the README. Anything unset gets a fresh
// random password, printed once below — capture it then, it is not recoverable.
const generated = [];
function password(envVar) {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  const secret = randomBytes(12).toString("base64url");
  generated.push([envVar, secret]);
  return secret;
}

async function main() {
  if (await db.venue.findFirst()) {
    console.log("Seed skipped: venue already exists.");
    return;
  }
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@theheaven.local";
  const deskEmail = process.env.SEED_DESK_EMAIL ?? "desk@theheaven.local";
  const adminHash = await bcrypt.hash(password("SEED_ADMIN_PASSWORD"), 10);
  const deskHash = await bcrypt.hash(password("SEED_DESK_PASSWORD"), 10);

  const venue = await db.venue.create({
    data: {
      slug: process.env.SEED_VENUE_SLUG ?? "the-heaven",
      name: process.env.SEED_VENUE_NAME ?? "The Heaven Restaurant & Cafe",
      qrSecret: randomBytes(24).toString("base64url"),
      posAdapter: "escpos_bridge",
      staff: {
        create: [
          { email: adminEmail, name: "Yönetici", passwordHash: adminHash, role: "admin" },
          { email: deskEmail, name: "Mutfak", passwordHash: deskHash, role: "desk" },
        ],
      },
      tables: {
        create: Array.from({ length: 8 }, (_, i) => ({ name: `Masa ${i + 1}`, code: code() })),
      },
      bridgeKeys: {
        create: { keyHash: sha256(bridgeKey), hint: bridgeKey.slice(-6), label: "kitchen-bridge" },
      },
    },
  });

  const cats = {};
  for (const [i, [tr, en]] of [
    ["Kahveler", "Coffee"],
    ["Soğuk İçecekler", "Cold Drinks"],
    ["Ana Yemekler", "Mains"],
    ["Tatlılar", "Desserts"],
  ].entries()) {
    cats[tr] = await db.category.create({
      data: { venueId: venue.id, nameTr: tr, nameEn: en, sortOrder: i },
    });
  }

  const sizeGroup = (small, large) => ({
    nameTr: "Boyut",
    nameEn: "Size",
    minSelect: 1,
    maxSelect: 1,
    options: {
      create: [
        { nameTr: "Küçük", nameEn: "Small", priceDeltaKurus: small, sortOrder: 0 },
        { nameTr: "Büyük", nameEn: "Large", priceDeltaKurus: large, sortOrder: 1 },
      ],
    },
  });
  const milkGroup = {
    nameTr: "Süt",
    nameEn: "Milk",
    minSelect: 0,
    maxSelect: 1,
    sortOrder: 1,
    options: {
      create: [
        { nameTr: "Yulaf sütü", nameEn: "Oat milk", priceDeltaKurus: 1500, sortOrder: 0 },
        { nameTr: "Laktozsuz süt", nameEn: "Lactose-free milk", priceDeltaKurus: 1000, sortOrder: 1 },
      ],
    },
  };

  const items = [
    ["Kahveler", "Türk Kahvesi", "Turkish Coffee", "Közde pişmiş, lokum ile", "Ember-brewed, served with Turkish delight", 9000, "", []],
    ["Kahveler", "Latte", "Latte", "Çift shot espresso, buharda süt", "Double espresso, steamed milk", 12000, "", [sizeGroup(0, 2500), milkGroup]],
    ["Kahveler", "Filtre Kahve", "Filter Coffee", "Günün çekirdeği", "Bean of the day", 10000, "", [sizeGroup(0, 2000)]],
    ["Kahveler", "Espresso", "Espresso", "", "", 8000, "", []],
    ["Soğuk İçecekler", "Ev Yapımı Limonata", "Homemade Lemonade", "Nane ile", "With fresh mint", 9500, "vegan", []],
    ["Soğuk İçecekler", "Ice Latte", "Iced Latte", "", "", 13000, "", [milkGroup]],
    ["Soğuk İçecekler", "Ayran", "Ayran", "", "", 5000, "", []],
    ["Ana Yemekler", "Izgara Köfte", "Grilled Meatballs", "Pilav ve közlenmiş biber ile", "With rice and roasted peppers", 32000, "gluten", [
      { nameTr: "Ekstra", nameEn: "Extras", minSelect: 0, maxSelect: 3, options: { create: [
        { nameTr: "Ekstra köfte (2 ad.)", nameEn: "Extra meatballs (2 pc)", priceDeltaKurus: 9000, sortOrder: 0 },
        { nameTr: "Yanında salata", nameEn: "Side salad", priceDeltaKurus: 6000, sortOrder: 1 },
        { nameTr: "Acı sos", nameEn: "Hot sauce", priceDeltaKurus: 0, sortOrder: 2 },
      ] } },
    ]],
    ["Ana Yemekler", "Tavuklu Sezar Salata", "Chicken Caesar Salad", "Izgara tavuk, parmesan, kruton", "Grilled chicken, parmesan, croutons", 26000, "gluten", []],
    ["Ana Yemekler", "Sebzeli Makarna", "Veggie Pasta", "Mevsim sebzeleri, domates sos", "Seasonal vegetables, tomato sauce", 22000, "vegan,gluten", []],
    ["Tatlılar", "San Sebastian Cheesecake", "San Sebastian Cheesecake", "", "", 16000, "gluten", []],
    ["Tatlılar", "Fıstıklı Baklava (3 dilim)", "Pistachio Baklava (3 pc)", "", "", 18000, "gluten,kuruyemiş", []],
    ["Tatlılar", "Sütlaç", "Rice Pudding", "Fırında", "Oven-baked", 11000, "", []],
  ];

  for (const [i, [cat, nameTr, nameEn, descTr, descEn, price, tags, groups]] of items.entries()) {
    await db.menuItem.create({
      data: {
        venueId: venue.id,
        categoryId: cats[cat].id,
        nameTr,
        nameEn,
        descTr,
        descEn,
        priceKurus: price,
        tags,
        sortOrder: i,
        modifierGroups: { create: groups.map((g, gi) => ({ sortOrder: gi, ...g })) },
      },
    });
  }

  console.log(`Seeded ${venue.name}.`);
  console.log("  admin:", adminEmail);
  console.log("  desk: ", deskEmail);
  console.log("  bridge key:", bridgeKey, "(shown once — only its hash is stored)");
  if (generated.length) {
    console.log("\n  Generated passwords — copy these now, they are not stored anywhere:");
    for (const [envVar, secret] of generated) {
      console.log(`    ${envVar}=${secret}`);
    }
  }
}

main().finally(() => db.$disconnect());
