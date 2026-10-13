// Test server only. These fixture pixels do not represent any model's output.
import http from "node:http";
import fs from "node:fs";
const png = fs.readFileSync("../../work/qa-v02/image-fixture.png");
const requests = [];
const tasks = new Map();
let hold = false;
http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const json = (value) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/stats") return json({ requests });
    if (path === "/control") {
      hold = JSON.parse(raw.toString() || "{}").hold || false;
      return json({ hold });
    }
    const body = req.headers["content-type"]?.includes("application/json")
      ? JSON.parse(raw.toString() || "{}")
      : undefined;
    requests.push({
      method: req.method,
      path,
      body,
      multipartBytes: body ? 0 : raw.length,
    });
    if (
      path === "/system_stats" ||
      path === "/sdapi/v1/options" ||
      path === "/v1/models"
    )
      return json({ ok: true });
    if (path === "/upload/image")
      return json({ name: "confirmed.png", subfolder: "novel", type: "input" });
    if (path === "/prompt") {
      const id = crypto.randomUUID();
      tasks.set(id, body);
      return json({ prompt_id: id });
    }
    if (path.startsWith("/history/")) {
      const id = path.split("/").at(-1);
      return json(
        !tasks.has(id) || hold
          ? {}
          : {
              [id]: {
                status: { status_str: "success", completed: true },
                outputs: {
                  9: {
                    images: [
                      {
                        filename: "fixture.png",
                        subfolder: "novel",
                        type: "output",
                      },
                    ],
                  },
                },
              },
            },
      );
    }
    if (path === "/view") {
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(png);
    }
    if (path === "/v1/images/generations" || path === "/v1/images/edits")
      return json({ data: [{ b64_json: png.toString("base64") }] });
    if (path === "/sdapi/v1/txt2img" || path === "/sdapi/v1/img2img")
      return json({ images: [png.toString("base64")] });
    res.writeHead(404);
    res.end("{}");
  })
  .listen(8788, "127.0.0.1", () =>
    console.log("Mock image services :8788 (test fixtures only)"),
  );
