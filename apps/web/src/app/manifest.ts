import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Levantamiento RQ",
    short_name: "RQ",
    description:
      "Gestión trazable de levantamientos, documentos, revisión y aprobación de requerimientos.",
    start_url: "/workspace",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f5",
    theme_color: "#384c59",
    lang: "es-CO",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
