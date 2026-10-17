const { chromium } = require(process.env.POSTURE_PLAYWRIGHT || "playwright");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
(async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.resolve(root, "." + decodeURIComponent(req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0]));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const body = await fs.readFile(file);
      res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.POSTURE_CHROMIUM || undefined });
    for (const [width, height] of [[320,568],[375,667],[390,844],[430,932],[844,390],[1280,900]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("http://127.0.0.1:" + server.address().port);
      await page.waitForFunction(() => document.querySelector("#startCamera") && document.querySelector("#overlay"));
      const layout = await page.evaluate(() => {
        const rect = (node) => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
        return {
          width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          buttons: [...document.querySelectorAll(".action-row button,.mode-tabs button,.tools button,#startCamera,#imageButtonStart")].map((node) => ({ id:node.id || node.textContent, ...rect(node) })),
          stage: rect(document.querySelector(".stage")),
          zoom: document.querySelector('meta[name="viewport"]').content,
          touch: getComputedStyle(document.querySelector("#analyzeButton")).touchAction,
        };
      });
      assert.equal(errors.length, 0, errors.join(","));
      assert.ok(layout.scrollWidth <= width, "horizontal overflow " + width);
      assert.ok(layout.scrollHeight <= height + 1, "vertical overflow " + width + "x" + height);
      for (const button of layout.buttons) {
        assert.ok(button.x >= -1 && button.right <= width + 1 && button.y >= -1 && button.bottom <= height + 1, JSON.stringify({ width, height, button }));
      }
      assert.ok(!layout.zoom.includes("user-scalable=no"));
      assert.equal(layout.touch, "manipulation");
      for (const id of ["result", "history"]) {
        await page.evaluate((id) => {
          const content = document.querySelector(id === "result" ? "#resultList" : "#historyList");
          content.innerHTML = Array.from({length:40}, (_,i) => '<div class="result-card">検証 ' + i + '</div>').join("");
          document.querySelector("#" + id + "Dialog").showModal();
        }, id);
        const dialog = await page.evaluate((id) => {
          const article = document.querySelector("#" + id + "Dialog article");
          return { scroll:article.scrollHeight, client:article.clientHeight, width:article.scrollWidth, clientWidth:article.clientWidth };
        }, id);
        assert.ok(dialog.scroll > dialog.client, "internal dialog scroll");
        assert.ok(dialog.width <= dialog.clientWidth + 1, "dialog horizontal overflow");
        await page.evaluate((id) => document.querySelector("#" + id + "Dialog").close(), id);
      }
      if (process.env.POSTURE_SCREENSHOTS && (width === 320 || width === 844)) await page.screenshot({ path:path.join(__dirname, ".layout-" + width + ".png") });
      console.log("PASS layout " + width + "x" + height + ", preview " + Math.round(layout.stage.height) + "px, controls visible, dialogs scroll");
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
