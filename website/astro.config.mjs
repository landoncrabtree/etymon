import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.SITE_URL || "https://landoncrabtree.github.io",
  base: process.env.BASE_PATH ?? "/etymon",
  output: "static",
  trailingSlash: "always",
  devToolbar: { enabled: false },
});
