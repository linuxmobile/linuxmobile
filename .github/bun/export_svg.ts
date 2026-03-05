import { existsSync } from "fs";
import { file, serve } from "bun";
import { join } from "path";
import puppeteer from "puppeteer-core";
import { generateStats } from "./bun_stats";

const TEMPLATE_PATH = join(import.meta.dir, "template.html");
const OUTPUT_PATH = join(import.meta.dir, "../../profile.svg");
const CHROMIUM_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "/etc/profiles/per-user/linuxmobile/bin/chromium";

console.log("🚀 Starting SVG Export process (File-less mode)...");
console.log(`🔍 Chromium path: ${CHROMIUM_PATH}`);

if (!existsSync(CHROMIUM_PATH)) {
  console.error(`❌ Chromium binary not found at: ${CHROMIUM_PATH}`);
  process.exit(1);
}

try {
  console.log("📊 Fetching GitHub statistics...");
  const stats = await generateStats();

  const server = serve({
    port: 3005,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        let html = await file(TEMPLATE_PATH).text();
        const scriptInjection = `<script>window.profileData = ${JSON.stringify(stats)};</script>`;
        html = html.replace("<head>", `<head>${scriptInjection}`);
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`📡 Transient server running at http://localhost:${server.port}`);

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
  });

  const page = await browser.newPage();

  await page.setViewport({
    width: 1400,
    height: 1000,
    deviceScaleFactor: 2,
  });

  console.log("🌐 Navigating to template with inlined data...");
  await page.goto(`http://localhost:${server.port}`, {
    waitUntil: "networkidle0",
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const dimensions = await page.evaluate(() => {
    return {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    };
  });

  await page.setViewport({
    width: dimensions.width,
    height: dimensions.height,
    deviceScaleFactor: 2,
  });

  console.log(
    `📸 Capturing visual... (${dimensions.width}x${dimensions.height})`,
  );
  const buffer = await page.screenshot({
    type: "png",
    fullPage: true,
    omitBackground: true,
  });

  const base64 = Buffer.from(buffer).toString("base64");

  const svgContent = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimensions.width} ${dimensions.height}" width="${dimensions.width}" height="${dimensions.height}">
  <foreignObject x="0" y="0" width="${dimensions.width}" height="${dimensions.height}">
    <div xmlns="http://www.w3.org/1999/xhtml">
      <img src="data:image/png;base64,${base64}" style="width: 100%; height: auto; display: block;" />
    </div>
  </foreignObject>
</svg>
`.trim();

  await Bun.write(OUTPUT_PATH, svgContent);
  console.log(`✅ SVG Export complete! Saved to ${OUTPUT_PATH}`);

  await browser.close();
  server.stop();
} catch (error) {
  console.error("❌ Export failed:", error);
  process.exit(1);
}
