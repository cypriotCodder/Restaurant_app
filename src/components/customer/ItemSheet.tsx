"use client";

import { useState } from "react";
import Image from "next/image";
import { t, type Locale } from "@/lib/i18n";
import { useMoney } from "../MoneyContext";
import Sheet from "./Sheet";
import { name } from "./shared";
import type { CartLine, Group, Item, Option } from "./types";

export default function ItemSheet({
  item,
  locale,
  onClose,
  onAdd,
}: {
  item: Item;
  locale: Locale;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const money = useMoney();
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [optionIds, setOptionIds] = useState<string[]>([]);

  const valid = item.modifierGroups.every((g) => {
    const count = g.options.filter((o) => optionIds.includes(o.id)).length;
    return count >= g.minSelect && count <= g.maxSelect;
  });
  const unit =
    item.priceKurus +
    item.modifierGroups
      .flatMap((g) => g.options)
      .filter((o) => optionIds.includes(o.id))
      .reduce((s, o) => s + o.priceDeltaKurus, 0);

  function toggle(group: Group, opt: Option) {
    setOptionIds((ids) => {
      const inGroup = group.options.map((o) => o.id);
      if (group.maxSelect === 1) {
        const cleared = ids.filter((id) => !inGroup.includes(id));
        return ids.includes(opt.id) && group.minSelect === 0 ? cleared : [...cleared, opt.id];
      }
      if (ids.includes(opt.id)) return ids.filter((id) => id !== opt.id);
      const count = ids.filter((id) => inGroup.includes(id)).length;
      return count >= group.maxSelect ? ids : [...ids, opt.id];
    });
  }

  return (
    <Sheet title={name(item, locale)} onClose={onClose}>
      {/* Photo area */}
      <div className="relative w-full h-40 flex items-center justify-center mb-4" style={{ background: "var(--color-neutral-100)", border: "1px solid var(--color-divider)" }}>
        {item.photoUrl ? (
          <Image
            src={item.photoUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 512px"
            className="object-cover"
          />
        ) : (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        )}
      </div>

      <h3 className="font-bold text-xl">{name(item, locale)}</h3>
      {(locale === "en" ? item.descEn : item.descTr) && (
        <p className="mt-1" style={{ color: "var(--color-neutral-900)" }}>{locale === "en" ? item.descEn : item.descTr}</p>
      )}
      <p className="font-extrabold text-xl mt-2">{money(item.priceKurus)}</p>
      {item.tags.length > 0 && <p className="text-xs mt-1" style={{ color: "var(--color-neutral-900)" }}>{item.tags.join(" · ")}</p>}

      {item.modifierGroups.map((g) => (
        <fieldset key={g.id} className="mt-5">
          <legend className="font-bold text-sm uppercase tracking-wide mb-2">
            {name(g, locale)}{" "}
            <span className="text-xs font-normal normal-case tracking-normal" style={{ color: "var(--color-neutral-900)" }}>
              ({g.minSelect > 0 ? t(locale, "required") : t(locale, "optional")})
            </span>
          </legend>

          {/* Single select → segmented control */}
          {g.maxSelect === 1 ? (
            <div className="seg">
              {g.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(g, o)}
                  className={`seg-opt ${optionIds.includes(o.id) ? "on" : ""}`}
                >
                  {name(o, locale)}
                  {o.priceDeltaKurus > 0 && ` +${money(o.priceDeltaKurus)}`}
                </button>
              ))}
            </div>
          ) : (
            /* Multi select → checklist rows */
            <div className="flex flex-col">
              {g.options.map((o) => (
                <label
                  key={o.id}
                  className="flex items-center justify-between py-2.5"
                  style={{ borderBottom: "1px solid var(--color-divider)" }}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={optionIds.includes(o.id)}
                      onChange={() => toggle(g, o)}
                      className="h-5 w-5"
                    />
                    <span>{name(o, locale)}</span>
                  </div>
                  {o.priceDeltaKurus !== 0 && (
                    <span className="text-sm" style={{ color: "var(--color-neutral-900)" }}>+{money(o.priceDeltaKurus)}</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ))}

      <div className="mt-5">
        <label className="block">
          <span className="text-sm font-medium" style={{ color: "var(--color-neutral-900)" }}>{t(locale, "itemNote")}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder={t(locale, "orderNote")}
            rows={2}
            className="input w-full mt-1 resize-none"
          />
        </label>
      </div>

      <div className="flex items-center gap-4 mt-5">
        <div className="flex items-center gap-2">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-11 w-11 flex items-center justify-center font-bold" style={{ border: "1.5px solid var(--color-text)" }} aria-label="−">
            −
          </button>
          <span className="w-6 text-center font-bold text-lg">{qty}</span>
          <button onClick={() => setQty((q) => Math.min(20, q + 1))} className="h-11 w-11 flex items-center justify-center font-bold" style={{ border: "1.5px solid var(--color-text)" }} aria-label="+">
            +
          </button>
        </div>
        <button
          disabled={!valid}
          onClick={() =>
            onAdd({ key: `${item.id}-${Date.now()}`, itemId: item.id, qty, note: note.trim(), optionIds })
          }
          className="btn btn-primary flex-1 justify-center py-3.5"
        >
          {t(locale, "addToCartCta").toLocaleUpperCase(locale)} · {money(unit * qty)}
        </button>
      </div>
    </Sheet>
  );
}
