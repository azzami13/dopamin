import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dopamin Cafe Accounting & Inventory",
    short_name: "Dopamin Cafe",
    description: "Internal accounting, finance, sales, reporting and stock-opname workspace for Dopamin Cafe.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#F6F3E9",
    theme_color: "#0F623E",
    orientation: "any",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  };
}
