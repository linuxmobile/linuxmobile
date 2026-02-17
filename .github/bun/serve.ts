import { file } from "bun";
import { join } from "path";

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(file(join(import.meta.dir, "template.html")));
    }
    if (url.pathname === "/data.json") {
      const dataFile = file(join(import.meta.dir, "data.json"));
      if (await dataFile.exists()) {
        return new Response(dataFile);
      }
      return new Response(JSON.stringify({ error: "Data not found" }), {
        status: 404,
      });
    }
    return new Response("404!", { status: 404 });
  },
});

console.log(`Listening on http://localhost:${server.port} ...`);
