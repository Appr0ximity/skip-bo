import type { NextConfig } from "next";

// Fully static site (no server): `next build` writes plain HTML/JS to `out/`,
// which Firebase Hosting / GitHub Pages can serve for free.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
