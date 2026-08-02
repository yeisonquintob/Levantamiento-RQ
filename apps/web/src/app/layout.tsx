import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@levantamiento-rq/shared-ui/styles.css";
import "./auth.css";

export const metadata: Metadata = {
  title: "Levantamiento RQ",
  description:
    "Plataforma para levantar, analizar, revisar y aprobar requerimientos.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html data-rq-font="normal" data-rq-theme="normal" lang="es">
      <body>{children}</body>
    </html>
  );
}
