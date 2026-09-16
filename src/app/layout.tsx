import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "700", "800"],
});

export const metadata: Metadata = {
  title: "The Heaven — Masadan Sipariş",
  description: "QR ile masadan sipariş — scan, order, done.",
};

// No maximumScale: the customer page is read on phones, often in dim light, and
// pinch-to-zoom must work (WCAG 1.4.4). Double-tap zoom on buttons is handled
// with touch-action in the stylesheet instead.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
