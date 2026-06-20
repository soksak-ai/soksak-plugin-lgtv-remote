#!/usr/bin/env node
// 실 TV 실측 드라이버 — 어떤 SSAP 동작이 실제로 먹히는지 자동 판정(read 전후 비교)으로 찾아낸다.
// 볼륨/음소거는 audio/getVolume 응답으로 객관 검증(±1 후 원복). 화면 변화가 필요한 동작
// (방향키 이동·검색 텍스트 반영)은 응답 코드만 수집하고 육안 확인 대상으로 표시한다.
//
// 전제: make dev 실행 중 + TV 켜짐 + IP 설정(+ 첫 연결이면 TV 화면 페어링 수락).
// 사용: SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/probe-livetv.mjs
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

// audio/getVolume 응답 다양성 흡수(신/구 webOS).
function volOf(r) {
  const p = r && r.result ? r.result : r;
  if (!p) return null;
  if (p.volumeStatus && typeof p.volumeStatus.volume === "number")
    return { volume: p.volumeStatus.volume, muted: !!p.volumeStatus.muteStatus };
  if (typeof p.volume === "number") return { volume: p.volume, muted: !!p.muted };
  return null;
}

const report = [];
function rec(name, verdict, detail) {
  report.push({ name, verdict, detail });
  console.log(`  ${verdict} ${name} — ${detail}`);
}

async function main() {
  await connectSock();
  console.log(`소켓: ${SOCKET}`);
  await rpc("plugin.disable", { id: PLUGIN }).catch(() => {});
  const ld = await rpc("plugin.dev.load", { path: PLUGIN_DIR });
  console.log("dev.load:", ld.ok ? "OK(최신 main.js)" : JSON.stringify(ld));
  await rpc("plugin.enable", { id: PLUGIN });

  const st = await m("status");
  console.log("status:", JSON.stringify(st));
  if (!st.ip) {
    console.log("\n✗ TV IP 미설정 — set-ip 또는 find 필요. 중단.");
    process.exit(2);
  }

  console.log("\n[연결]");
  const c = await m("connect").catch((e) => ({ ok: false, message: String(e) }));
  console.log("connect:", JSON.stringify(c));
  const st2 = await m("status");
  if (st2.state !== "connected") {
    console.log(`\n✗ 연결 실패(state=${st2.state}) — TV 켜짐/IP/페어링 확인. 중단.`);
    const dl = await m("dump-log", { lines: 40 });
    console.log("로그 tail:");
    for (const e of dl.entries || []) console.log(`   [${e.kind}] ${e.detail}`);
    process.exit(2);
  }
  console.log(`✓ 연결됨 (paired=${st2.paired})`);

  // ── A~D. 볼륨/음소거 — 자동 판정(read 전후 비교) ──
  console.log("\n[볼륨/음소거 — 자동 판정]");
  const v0 = volOf(await ssap("ssap://audio/getVolume"));
  if (!v0) {
    rec("audio/getVolume", "?", "응답 구조 불명 — 볼륨 자동판정 불가");
  } else {
    rec("audio/getVolume(read)", "✓", `volume=${v0.volume} muted=${v0.muted}`);
    await m("volume-up");
    await sleep(500);
    const v1 = volOf(await ssap("ssap://audio/getVolume"));
    rec("volume-up", v1 && v1.volume > v0.volume ? "✓동작" : "✗무변화", `${v0.volume} → ${v1 && v1.volume}`);
    await m("volume-down");
    await sleep(500);
    const v2 = volOf(await ssap("ssap://audio/getVolume"));
    const base = v1 ? v1.volume : v0.volume;
    rec("volume-down", v2 && v2.volume < base ? "✓동작" : "✗무변화", `${base} → ${v2 && v2.volume}`);
    await m("mute", { on: true });
    await sleep(500);
    const v3 = volOf(await ssap("ssap://audio/getVolume"));
    rec("mute(on)", v3 && v3.muted ? "✓동작" : "✗무변화", `muted=${v3 && v3.muted}`);
    await m("mute", { on: false });
    await sleep(300);
  }

  // ── E. 채널 — read(방송 입력일 때만 의미) ──
  console.log("\n[채널 — read(방송 입력 시만)]");
  const ch0 = await ssap("ssap://tv/getCurrentChannel");
  if (ch0.ok && ch0.result && ch0.result.channelNumber != null) {
    rec("tv/getCurrentChannel", "✓", `방송 입력, ch=${ch0.result.channelNumber} — channel-up/down 의미 있음`);
  } else {
    rec("tv/getCurrentChannel", "—", "방송 입력 아님(HDMI 등) — channel 동작은 방송에서만 유효");
  }

  // ── F. 현재 앱 — read ──
  console.log("\n[현재 앱 — read]");
  const fg = await ssap("ssap://com.webos.applicationManager/getForegroundAppInfo");
  rec("getForegroundAppInfo", fg.result && fg.result.appId != null ? "✓" : "?", "appId=" + (fg.result && fg.result.appId));

  // ── G. 텍스트 입력(IME) — 응답 코드만(검색창 컨텍스트 없으면 무효일 수 있음) ──
  console.log("\n[텍스트 입력(IME) — 응답 코드 + 육안 확인]");
  const ti = await m("text-input", { text: "soksak", replace: false });
  rec("insertText('soksak')", ti.ok ? "✓응답" : "✗", JSON.stringify(ti).slice(0, 160));
  await m("toast", { message: "soksak 실측: 화면에 이 토스트가 보이면 알림 OK" }).catch(() => {});

  // ── 요약 ──
  console.log("\n" + "=".repeat(54));
  console.log("자동 실측 요약:");
  for (const r of report) console.log(`  ${r.verdict} ${r.name}: ${r.detail}`);
  console.log("\n육안 확인 필요(자동 판정 불가):");
  console.log("  · dpad 방향키가 TV UI 커서를 움직이는가");
  console.log("  · HOME/BACK 버튼이 화면을 전환하는가");
  console.log("  · TV 검색창을 띄운 뒤 insertText 가 입력창에 글자를 넣는가");
  console.log("  · 위 toast 가 TV 화면에 떴는가");

  await rpc("plugin.disable", { id: PLUGIN }).catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error("probe 오류:", e);
  process.exit(1);
});
