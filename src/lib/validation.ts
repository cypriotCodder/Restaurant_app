import { z } from "zod";

export const itemSchema = z.object({
  categoryId: z.string(),
  nameTr: z.string().min(1),
  nameEn: z.string().default(""),
  descTr: z.string().default(""),
  descEn: z.string().default(""),
  priceKurus: z.number().int().min(0),
  photoUrl: z.string().nullable().default(null),
  tags: z.string().default(""),
  available: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  modifierGroups: z
    .array(
      z.object({
        nameTr: z.string().min(1),
        nameEn: z.string().default(""),
        minSelect: z.number().int().min(0).default(0),
        maxSelect: z.number().int().min(1).default(1),
        options: z.array(
          z.object({
            nameTr: z.string().min(1),
            nameEn: z.string().default(""),
            priceDeltaKurus: z.number().int().default(0),
          })
        ),
      })
    )
    .default([]),
});
