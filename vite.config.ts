import { readFileSync } from "fs";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, loadEnv } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return {
    // __APP_VERSION__ espelha o campo "version" do package.json — sobe a cada
    // implantação (ver src/routes/settings.tsx, aba Sistema).
    define: { ...envDefine, __APP_VERSION__: JSON.stringify(pkg.version) },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    server: { host: "::", port: 8080 },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart(),
      nitro({
        compressPublicAssets: { gzip: true, brotli: true },
        handlers: [
          {
            route: "/api/automations/tick",
            method: "POST",
            handler: "./src/server/automations-tick.route.ts",
          },
          {
            route: "/api/webhooks/evolution",
            method: "POST",
            handler: "./src/server/evolution-webhook.route.ts",
          },
          {
            route: "/api/webhooks/meta-whatsapp",
            method: "GET",
            handler: "./src/server/meta-whatsapp-webhook.route.ts",
          },
          {
            route: "/api/webhooks/meta-whatsapp",
            method: "POST",
            handler: "./src/server/meta-whatsapp-webhook.route.ts",
          },
        ],
      }),
      viteReact(),
    ],
  };
});
