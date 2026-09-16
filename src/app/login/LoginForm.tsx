"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const body = await res.json().catch(() => ({}));
      // The server names the landing page from the account's role.
      router.push(body.redirect ?? "/desk");
      router.refresh();
    } else if (res?.status === 429) {
      setError("Çok fazla deneme — birkaç dakika bekleyin / Too many attempts, wait a few minutes");
    } else if (!res) {
      setError("Sunucuya ulaşılamıyor / Cannot reach the server");
    } else {
      setError("E-posta veya şifre hatalı / Invalid credentials");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-bg)" }}>
      <div className="w-full max-w-sm p-6">
        {/* Wordmark */}
        <div className="flex flex-col items-center text-center gap-3 mb-10">
          <div className="h-3 w-3 rounded-full" style={{ background: "var(--color-accent)" }} />
          <h1 className="wordmark text-2xl">
            THE HEAVEN
            <span className="sub">RESTAURANT &amp; CAFE</span>
          </h1>
        </div>

        {/* Login card */}
        <div className="bg-white p-6" style={{ border: "2px solid var(--color-text)" }}>
          <h2 className="wordmark text-base text-center mb-6">
            PERSONEL GİRİŞİ
            <span className="sub">Staff Login</span>
          </h2>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="login-email" className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--color-neutral-900)" }}>
                E-POSTA / EMAIL
              </label>
              <input
                id="login-email"
                type="email"
                required
                placeholder="admin@example.com"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="login-password" className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--color-neutral-900)" }}>
                ŞİFRE / PASSWORD
              </label>
              <input
                id="login-password"
                type="password"
                required
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
              />
            </div>
            {error && <p className="text-sm" role="alert" style={{ color: "var(--color-heaven-orange)" }}>{error}</p>}
            <button disabled={busy} className="btn btn-primary justify-center py-3 mt-2 w-full">
              {busy ? "..." : "GİRİŞ / SIGN IN"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: "var(--color-neutral-900)" }}>
          theheaven.app/login
        </p>
      </div>
    </main>
  );
}
