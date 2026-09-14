"use client";

export default function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg max-h-[85vh] overflow-y-auto p-5" style={{ background: "var(--color-bg)", borderTop: "2px solid var(--color-text)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="wordmark text-lg">{title}</h2>
          <button onClick={onClose} className="btn-icon" style={{ border: "2px solid var(--color-text)" }} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
