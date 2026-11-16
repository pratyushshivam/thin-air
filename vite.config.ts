import { defineConfig, type Plugin } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";

// Dev only: the page can post a frame to /__shot?name=x and it lands in raw/shots.
const shots: Plugin = {
  name: "shots",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__shot", (req, res) => {
      const name = (new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "shot").replace(/[^a-z0-9-]/gi, "");
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        mkdirSync("raw/shots", { recursive: true });
        writeFileSync(`raw/shots/${name}.jpg`, Buffer.concat(chunks));
        res.end("ok");
      });
    });
  },
};

// Relative base: the built page works from any folder on any static host.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  plugins: [shots],
});
