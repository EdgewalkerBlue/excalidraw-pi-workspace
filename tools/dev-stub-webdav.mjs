// 开发用桩：冒充一个 WebDAV 服务器（Basic 认证 + PROPFIND + PUT），
// 供 save-bridge 的离线联调使用 —— 不接触任何真实网盘、不需要凭据。
//
//   node tools/dev-stub-webdav.mjs                 # 默认 127.0.0.1:5111，用户 tester / app-pass
//   STUB_PORT=5119 node tools/dev-stub-webdav.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = parseInt(process.env.STUB_PORT || "5111", 10);
const USER = process.env.STUB_USER || "tester";
const PASS = process.env.STUB_PASS || "app-pass";
// 收到的内容写到这里，便于断言"服务端确实收到了正确字节"
export const RECEIVED_FILE = process.env.STUB_RECEIVED || path.join(os.tmpdir(), "stub-webdav-received.json");

http
  .createServer((req, res) => {
    const expect = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
    if ((req.headers.authorization || "") !== expect) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="stub"' });
      return res.end("unauthorized");
    }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (req.method === "PROPFIND") {
        res.writeHead(207, { "Content-Type": "application/xml" });
        return res.end('<?xml version="1.0"?><multistatus xmlns="DAV:"/>');
      }
      if (req.method === "PUT") {
        fs.writeFileSync(RECEIVED_FILE, body);
        res.writeHead(201);
        return res.end("created");
      }
      res.writeHead(405);
      res.end("method not allowed");
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`stub webdav: http://127.0.0.1:${PORT}  (user=${USER} pass=${PASS})`);
    console.log(`received file: ${RECEIVED_FILE}`);
  });
