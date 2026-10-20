import type { NextConfig } from "next";

// Fully static site (no server): `next build` writes plain HTML/JS to `out/`,
// which Firebase Hosting / GitHub Pages can serve for free.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  // Dev only: lets a second local tab at 127.0.0.1 sign in as another player (separate login storage).
  allowedDevOrigins: ["127.0.0.1"],
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
