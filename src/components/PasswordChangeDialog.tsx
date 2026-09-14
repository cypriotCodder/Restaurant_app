"use client";

import { useState } from "react";

/**
 * Self-service password change, reachable from the desk as well as the admin
 * panel — desk staff never see /admin, and previously had no way to change
 * their own password at all.
 */
export default function PasswordChangeDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (next !== confirm) {
      setError("Şifreler eşleşmiyor / Passwords do not match");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      setTimeout(onClose, 2000);
      return;
    }
    const b = await res.json().catch(() => ({}));
    setError(
      b.error === "wrong_password"
        ? "Mevcut şifre hatalı / Current password is incorrect"
        : b.error === "rate_limited"
          ? "Çok fazla deneme. Lütfen bekleyin / Too many attempts"
          : (b.detail ?? "Şifre değiştirilemedi / Could not change password")
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={() => !busy && onClose()}
    >
      <form
        onSubmit={submit}
        className="bg-white p-5 w-full max-w-sm flex flex-col gap-3"
        style={{ border: "2px solid var(--color-text)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="wordmark text-base">ŞİFRE DEĞİŞTİR / CHANGE PASSWORD</h2>

        {done ? (
          <p className="text-sm py-4" style={{ color: "var(--color-accent-700)" }}>
            Şifreniz değiştirildi. Diğer cihazlardan çıkış yapıldı.
            <br />
            Password changed. Other devices have been signed out.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-wide">MEVCUT ŞİFRE</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-wide">YENİ ŞİFRE</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-wide">YENİ ŞİFRE (TEKRAR)</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input"
              />
            </label>
            <p className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
              En az 8 karakter. Bu cihazda oturumunuz açık kalır, diğerleri kapanır.
            </p>
            {error && <p className="text-sm" style={{ color: "var(--color-heaven-orange)" }}>{error}</p>}
            <div className="flex gap-2 mt-1">
              <button disabled={busy} className="btn btn-primary flex-1 justify-center py-3">
                {busy ? "..." : "Kaydet / Save"}
              </button>
              <button type="button" disabled={busy} onClick={onClose} className="btn btn-ghost">
                Vazgeç
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
