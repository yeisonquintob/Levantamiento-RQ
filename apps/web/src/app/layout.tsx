import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "@levantamiento-rq/shared-ui/styles.css";
import "./auth.css";
import { PwaRegistration } from "./pwa-registration";

export const metadata: Metadata = {
  applicationName: "Levantamiento RQ",
  title: "Levantamiento RQ",
  description:
    "Plataforma para levantar, analizar, revisar y aprobar requerimientos.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Levantamiento RQ",
  },
};

export const viewport: Viewport = {
  themeColor: "#384c59",
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html data-rq-font="normal" data-rq-theme="normal" lang="es">
      <body>
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
