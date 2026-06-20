#!/usr/bin/env node
// soksak-plugin-lgtv-remote E2E — 멱등 시나리오 드라이버(실 TV 없이 검증 가능한 범위).
//
// 소켓(JSON-RPC)으로 실제 앱을 구동하고, 리모컨 커맨드 + 코어 ui.tree/ui.input.click 으로 단언한다.
// 통신(SSAP) 실측은 불가하므로(실 TV 필요) 설정 왕복·DOM 노출·명령 무크래시·디버그 로깅·WoL 송신만 검증.
//
// 전제: 코어 app(make dev)이 실행 중 + 이 플러그인 dev-load 가능. dev 소스=동의 면제.
// 사용: SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/lgtv.mjs   (이 plugin repo 루트에서)
// 종료코드: 0 = 전부 PASS, 1 = FAIL.

import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SOCKET =
  process.env.SOKSAK_SOCKET || path.join(os.homedir(), ".soksak", "com.soksak.dev.sock");
const PLUGIN = "soksak-plugin-lgtv-remote";
const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN = Date.now().toString(36);

let sock,
  seq = 0;
const pending = new Map();
let rbuf = "";
function connect() {
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

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}
const section = (n) => console.log(`\n[${n}]`);

async function main() {
  await connect();
  console.log(`소켓: ${SOCKET}`);

  // ── setup ──
  section("setup");
  await rpc("plugin.disable", { id: PLUGIN }).catch(() => {});
  const loaded = await rpc("plugin.dev.load", { path: PLUGIN_DIR });
  ok(loaded.ok, "plugin.dev.load(최신 main.js)");
  const enabled = await rpc("plugin.enable", { id: PLUGIN });
  ok(enabled.ok && enabled.status === "enabled", "plugin.enable(dev 동의 면제)");

  // ── R1: 초기 상태 ──
  section("R1 status");
  const st0 = await m("status");
  ok(st0.ok && st0.state === "disconnected", "초기 상태 disconnected");

  // ── R2: 설정 왕복(storage) ──
  section("R2 set-ip/set-mac 왕복");
  await m("set-ip", { ip: "127.0.0.1" });
  await m("set-mac", { mac: "aa:bb:cc:dd:ee:ff" });
  const st1 = await m("status");
  ok(st1.ip === "127.0.0.1", "set-ip → status.ip 반영");
  ok(st1.mac === "aa:bb:cc:dd:ee:ff", "set-mac → status.mac 반영");

  // ── R3: DOM 노출(ui.tree) + 클릭(ui.input.click) ──
  section("R3 DOM 노출 계약");
  const tree = await rpc("ui.tree");
  const find = (np) => (tree.nodes || []).find((n) => n.nodePath === np);
  ok(!!find("power-on"), "ui.tree: power-on 노드 노출");
  ok(!!find("dpad/up"), "ui.tree: dpad/up 노드 노출(동적 키)");
  ok(!!find("settings-ip"), "ui.tree: settings-ip 입력 노출");
  ok(!!find("search"), "ui.tree: search 텍스트 입력칸 노출(IME)");
  const header = find("titlebar/soksak-plugin-lgtv-remote/remote");
  ok(!!header, "ui.tree: 헤더 리모컨 아이콘 노출(titlebar 좌측)");
  const clicked = await rpc("ui.input.click", { address: header.address });
  ok(clicked.ok && clicked.clicked, "ui.input.click(헤더 아이콘) → 토글");

  // ── R4: 모달 토글(command) ──
  section("R4 모달 토글");
  ok((await m("show")).visible === true, "show → visible true");
  ok((await m("hide")).visible === false, "hide → visible false");
  ok((await m("toggle")).visible === true, "toggle(숨김→표시) → visible true");

  // ── R4b: 시각 산출물(window.snapshot — 창 전체 캡처, 사람이 디자인 검토) ──
  section("R4b 캡처");
  const shotPath = `/tmp/lgtv-remote-${RUN}.png`;
  const snap = await rpc("window.snapshot", { path: shotPath });
  ok(snap.ok && snap.saved === shotPath, `window.snapshot → ${shotPath}`);
  await m("minimize");

  // ── R5: 미연결 명령이 호스트를 죽이지 않음 ──
  section("R5 무크래시");
  const conn = await m("connect"); // 127.0.0.1:3000 — 연결 실패 예상
  ok(conn !== undefined, "connect(가짜 IP) → 응답 수신(크래시 없음)");
  const st2 = await m("status");
  ok(st2.ok, "connect 실패 후에도 status 정상 응답");

  // ── R6: 디버그 로깅(나중 디버그 가능성) ──
  section("R6 dump-log");
  const dl = await m("dump-log", { lines: 100 });
  ok(dl.ok && Array.isArray(dl.entries), "dump-log → entries 배열");

  // ── R7: WoL 경로(power-on → net.udp.send) ──
  section("R7 WoL 송신");
  await m("power-on").catch(() => {}); // connect 단계는 실패해도 WoL 은 먼저 송신됨
  const dl2 = await m("dump-log", { lines: 100 });
  ok(
    dl2.ok && dl2.entries.some((e) => e.kind === "wol"),
    "power-on 이 WoL(net.udp.send) 경유 — dump-log 에 wol 기록",
  );

  // ── teardown ──
  section("teardown");
  ok((await rpc("plugin.disable", { id: PLUGIN })).ok, "plugin.disable");

  console.log(`\n${"=".repeat(40)}`);
  if (failures.length === 0) {
    console.log(`PASS — ${passed}개 단언 전부 통과`);
    process.exit(0);
  } else {
    console.log(`FAIL — ${failures.length}개 실패:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("E2E 오류:", e);
  process.exit(1);
});
