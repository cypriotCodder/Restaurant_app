"use client";

import { useState } from "react";
import useSWR from "swr";
import { swrDefaults } from "@/lib/swr";
import Dialog from "../Dialog";
import type { StaffFormValues, StaffRow } from "./types";
// Staff tokens are stateless 12h JWTs, so "sign out everywhere" and
// deactivation both work by bumping the account's token version. Revocation
// lands within the 30s account-cache window, not 12 hours.
// Staff accounts are managed here rather than in psql: restaurant turnover is
// constant, and a manager needs to add a new starter on their first shift.
//
// Staff tokens are stateless 12h JWTs, so every change that affects who an
// account is — role, password, deactivation — bumps its token version and takes
// effect within the 30s account-cache window rather than in 12 hours.
export default function StaffPanel() {
  const { data, error: swrError, mutate } = useSWR<{ staff: StaffRow[]; self: string }>("/api/admin/staff", swrDefaults);
  const rows = data?.staff ?? [];
  const self = data?.self ?? "";
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [error, setError] = useState("");


  async function act(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError("");
    const res = await fetch(`/api/admin/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(staffErrorText(b.error, b.detail));
      return false;
    }
    await mutate();
    return true;
  }

  const admins = rows.filter((u) => u.role === "admin" && u.active).length;

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wide">Personel / Staff Access</h3>
        <button onClick={() => { setAdding(true); setError(""); }} className="btn btn-primary">
          + Personel Ekle
        </button>
      </div>

      {error && (
        <p className="text-sm mb-3" role="alert" style={{ color: "var(--color-heaven-orange)" }}>{error}</p>
      )}
      {data === undefined && !swrError && (
        <p className="text-sm" style={{ color: "var(--color-neutral-900)" }}>Yükleniyor… / Loading…</p>
      )}
      {swrError && (
        <p className="text-sm mb-3" role="alert" style={{ color: "var(--color-heaven-orange)" }}>
          Personel listesi yüklenemedi / Could not load staff
        </p>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((u) => (
          <div
            key={u.id}
            className="flex items-center justify-between gap-3 text-sm"
            style={u.active ? undefined : { opacity: 0.55 }}
          >
            <span>
              <strong>{u.name}</strong>
              <span style={{ color: "var(--color-neutral-900)" }}>
                {" "}· {u.email} · {u.role}
                {u.active ? "" : " · pasif / inactive"}
                {u.id === self ? " · siz / you" : ""}
              </span>
            </span>
            <span className="flex gap-2 shrink-0">
              <button
                className="btn btn-secondary"
                disabled={busy === u.id}
                onClick={() => { setEditing(u); setError(""); }}
              >
                Düzenle / Edit
              </button>
              <button
                className="btn btn-ghost"
                disabled={busy === u.id}
                onClick={() => act(u.id, { signOutEverywhere: true })}
                title="Tüm cihazlardan çıkış / Sign out everywhere"
              >
                Oturumları Kapat
              </button>
              {u.id !== self && (
                <button
                  className="btn btn-ghost"
                  disabled={busy === u.id}
                  onClick={() => act(u.id, { active: !u.active })}
                >
                  {u.active ? "Devre Dışı" : "Etkinleştir"}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      <p
        className="text-xs mt-4 pt-3"
        style={{ color: "var(--color-neutral-900)", borderTop: "1px solid var(--color-divider)" }}
      >
        Değişiklikler 30 saniye içinde tüm cihazlarda geçerli olur.
        {admins === 1 && " Son yönetici hesabı devre dışı bırakılamaz."}
        <br />
        Changes take effect on every device within 30 seconds.
        {admins === 1 && " The last admin account cannot be disabled."}
      </p>

      {adding && (
        <StaffForm
          title="Yeni Personel / New Staff"
          onClose={() => setAdding(false)}
          onSubmit={async (values) => {
            const res = await fetch("/api/admin/staff", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(values),
            });
            if (!res.ok) {
              const b = await res.json().catch(() => ({}));
              return staffErrorText(b.error, b.detail);
            }
            setAdding(false);
            await mutate();
            return null;
          }}
        />
      )}

      {editing && (
        <StaffForm
          title={`${editing.name} — Düzenle`}
          existing={editing}
          isSelf={editing.id === self}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            // Only send what changed; an unchanged password field must not
            // reset the account's password to an empty string.
            const patch: Record<string, unknown> = { name: values.name, role: values.role };
            if (values.password) patch.password = values.password;
            const res = await fetch(`/api/admin/staff/${editing.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            });
            if (!res.ok) {
              const b = await res.json().catch(() => ({}));
              return staffErrorText(b.error, b.detail);
            }
            setEditing(null);
            await mutate();
            return null;
          }}
        />
      )}
    </div>
  );
}

function staffErrorText(code: string | undefined, detail?: string): string {
  switch (code) {
    case "email_taken":
      return "Bu e-posta zaten kayıtlı / That email is already registered";
    case "last_admin":
      return "Son yönetici hesabı devre dışı bırakılamaz veya düşürülemez / Cannot remove the last admin";
    case "cannot_deactivate_self":
      return "Kendi hesabınızı devre dışı bırakamazsınız / You cannot disable your own account";
    case "cannot_demote_self":
      return "Kendi yetkinizi düşüremezsiniz / You cannot demote yourself";
    case "invalid":
      return detail ?? "Geçersiz bilgi / Invalid input";
    case "rate_limited":
      return "Çok fazla deneme. Lütfen bekleyin / Too many attempts, please wait";
    case "wrong_password":
      return "Mevcut şifre hatalı / Current password is incorrect";
    default:
      return "İşlem başarısız / Could not complete";
  }
}

function StaffForm({
  title,
  existing,
  isSelf,
  onClose,
  onSubmit,
}: {
  title: string;
  existing?: StaffRow;
  isSelf?: boolean;
  onClose: () => void;
  /** Returns an error message to display, or null on success. */
  onSubmit: (values: StaffFormValues) => Promise<string | null>;
}) {
  const [email, setEmail] = useState(existing?.email ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState<"admin" | "desk">(
    (existing?.role as "admin" | "desk") ?? "desk"
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const err = await onSubmit({ email, name, role, password });
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Dialog title={title} onClose={onClose} busy={busy} width="max-w-sm">
      <form onSubmit={submit} className="flex flex-col gap-3">
        {!existing && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide">E-POSTA / EMAIL</span>
            <input
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide">İSİM / NAME</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide">YETKİ / ROLE</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "desk")}
            disabled={isSelf}
            className="input"
          >
            <option value="desk">Mutfak / Order desk</option>
            <option value="admin">Yönetici / Admin</option>
          </select>
          {isSelf && (
            <span className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
              Kendi yetkinizi değiştiremezsiniz / You cannot change your own role
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide">
            {existing ? "YENİ ŞİFRE / NEW PASSWORD" : "ŞİFRE / PASSWORD"}
          </span>
          <input
            type="password"
            required={!existing}
            autoComplete="new-password"
            placeholder={existing ? "Değiştirmemek için boş bırakın" : ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
          <span className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
            {existing
              ? "Şifre değişirse diğer tüm cihazlardan çıkış yapılır."
              : "En az 8 karakter."}
          </span>
        </label>

        {error && <p className="text-sm" role="alert" style={{ color: "var(--color-heaven-orange)" }}>{error}</p>}

        <div className="flex gap-2 mt-1">
          <button disabled={busy} className="btn btn-primary flex-1 justify-center py-3">
            {busy ? "..." : "Kaydet / Save"}
          </button>
          <button type="button" disabled={busy} onClick={onClose} className="btn btn-ghost">
            Vazgeç
          </button>
        </div>
      </form>
    </Dialog>
  );
}
