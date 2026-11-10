import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clawback",
    short_name: "Clawback",
    display: "standalone",
    start_url: "/",
    background_color: "#F2F4F3",
    theme_color: "#0F6E4E",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
