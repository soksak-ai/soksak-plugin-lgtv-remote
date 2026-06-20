#!/usr/bin/env node
// 텍스트 입력 검증 — registerRemoteKeyboard 구독이 입력 포커스(currentWidget.focus)를 잡는지,
// 포커스된 상태에서 insertText 가 실제로 입력창에 들어가는지 실측한다.
// 사용자가 TV 브라우저 주소창을 클릭(커서 포커스)하면 imeFocused=true 가 되고 자동으로 insertText.
// 사용: SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/probe-text.mjs
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SOCKET = process.env.SOKSAK_SOCKET || path.join(os.homedir(), ".soksak", "com.soksak.dev.sock");
const PLUGIN = "soksak-plugin-lgtv-remote";
const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let sock,
  seq = 0;
const pending = new Map();
let rbuf = "";
function connectSock() {
  return new Promise((resolve, reject) => {
    sock = net.createConnection(SOCKET);
    sock.setNoDelay(true);
    sock.once("connect", resolve);
    sock.once("error", reject);
    sock.on("data", (d) => {
      rbuf += d.toString("utf8");
      let i;
      while ((i = rbuf.indexOf("\n")) >= 0) {
        const line = rbuf.slice(0, i);
        rbuf = rbuf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p(msg);
        }
      }
    });
  });
}
function rpc(method, params = {}, opts = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    sock.write(JSON.stringify({ id, method, params, ...opts }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`TIMEOUT ${method}`));
      }
    }, 15000);
  });
}
const m = (name, params, opts) => rpc(`plugin.${PLUGIN}.${name}`, params, opts);
const ssap = (uri, payload) => m("ssap", { uri, payload });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await connectSock();
  console.log(`소켓: ${SOCKET}`);
  await rpc("plugin.dev.load", { path: PLUGIN_DIR }).catch(() => {});
  await rpc("plugin.enable", { id: PLUGIN }).catch(() => {});
  const c = await m("connect");
  console.log("connect:", JSON.stringify(c));
  const st0 = await m("status");
  if (st0.state !== "connected") {
    console.log(`✗ 연결 실패(state=${st0.state}) — 중단`);
    process.exit(2);
  }
  console.log("초기 imeFocused =", st0.imeFocused);

  const fg = await ssap("ssap://com.webos.applicationManager/getForegroundAppInfo");
  console.log("현재 앱:", fg.result && fg.result.appId);
  console.log("→ LG 통합 검색(com.webos.app.voice) 실행 — 텍스트 입력 전용, 시스템 IME 화면");
  await m("launch", { id: "com.webos.app.voice" });
  await sleep(4500);

  console.log("\n=== 통합 검색 입력창에 포커스가 가면(필요하면 OK 한 번) 자동 insertText 합니다 ===");
  console.log("    IME 구독이 입력 포커스를 감지하면 텍스트를 넣습니다 (최대 20초 대기)\n");
  let hit = false;
  for (let i = 0; i < 20; i++) {
    const st = await m("status");
    process.stdout.write(`  [${String(i + 1).padStart(2)}s] imeFocused=${st.imeFocused}    \r`);
    if (st.imeFocused) {
      console.log(`\n  ✓ 입력 포커스 감지! insertText('soksak123') 전송`);
      const ti = await m("text-input", { text: "soksak123", replace: false });
      console.log("    insertText:", JSON.stringify(ti).slice(0, 120));
      hit = true;
      break;
    }
    await sleep(1000);
  }
  if (!hit) {
    console.log("\n  ✗ 20초간 입력 포커스 미감지");
    console.log("    → 주소창 클릭이 안 됐거나, 이 컨텍스트가 시스템 IME 를 안 씀(앱 자체 OSK)");
  }

  console.log("\n[dump-log: IME/상태 이벤트]");
  const dl = await m("dump-log", { lines: 80 });
  for (const e of (dl.entries || []).filter((e) => e.kind === "ime" || e.kind === "state"))
    console.log(`   [${e.kind}] ${e.detail}`);

  console.log("\n육안 확인: 통합 검색/입력창에 'soksak123' 이 들어갔는가?");
  await sleep(300);
  process.exit(0);
}

main().catch((e) => {
  console.error("probe 오류:", e);
  process.exit(1);
});
