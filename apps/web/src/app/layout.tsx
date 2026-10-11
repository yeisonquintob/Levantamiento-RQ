import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
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

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      data-rq-font="normal"
      data-rq-motion="normal"
      data-rq-theme="normal"
      lang="es"
      suppressHydrationWarning
    >
      <head>
        {/* Apply saved preferences before the body paints, including full-page navigation. */}
        <script
          nonce={nonce}
          // Browsers hide the nonce attribute before hydration; the .nonce property remains intact.
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(() => {
              const root = document.documentElement;
              try {
                const theme = localStorage.getItem("rq-theme");
                if (["normal", "cold", "warm", "dark"].includes(theme)) {
                  root.dataset.rqTheme = theme;
                }
              } catch {}
              try {
                const font = localStorage.getItem("rq-font");
                if (["compact", "normal", "large", "extra-large"].includes(font)) {
                  root.dataset.rqFont = font;
                }
              } catch {}
              try {
                const motion = localStorage.getItem("rq-motion");
                if (["reduced", "fast", "normal", "slow"].includes(motion)) {
                  root.dataset.rqMotion = motion;
                }
              } catch {}
            })();`,
          }}
        />
      </head>
      <body>
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
