// 순수 로직 단위테스트(네트워크 0) — node --test. main.js 의 named export 대상.
// 원본 포팅 검증: 매직패킷·SSAP 페이로드·상태머신·전원 시퀀스. DOM/WebSocket 불요.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMagicPacket,
  bytesToHex,
  buildRegisterPayload,
  buildRequest,
  parseRegistered,
  nextState,
  shouldReconnect,
  powerOnActions,
  powerOffActions,
  screenOffActions,
} from "../main.js";

// ── magicPacket (wol.go 포팅) ────────────────────────────────────────────────
test("buildMagicPacket: 102바이트 = 0xFF×6 + MAC×16", () => {
  const p = buildMagicPacket("3c:cd:93:7b:91:9e");
  const mac = [0x3c, 0xcd, 0x93, 0x7b, 0x91, 0x9e];
  assert.equal(p.length, 102);
  assert.deepEqual(p.slice(0, 6), [255, 255, 255, 255, 255, 255]);
  assert.deepEqual(p.slice(6, 12), mac);
  assert.deepEqual(p.slice(96, 102), mac); // 16번째 반복
});

test("buildMagicPacket: 하이픈 구분 MAC 도 허용", () => {
  const p = buildMagicPacket("3C-CD-93-7B-91-9E");
  assert.deepEqual(p.slice(6, 12), [0x3c, 0xcd, 0x93, 0x7b, 0x91, 0x9e]);
});

test("buildMagicPacket: 잘못된 MAC 은 throw", () => {
  assert.throws(() => buildMagicPacket("3c:cd:93:7b:91")); // 5옥텟
  assert.throws(() => buildMagicPacket("zz:cd:93:7b:91:9e")); // 비-hex
});

test("bytesToHex: 바이트 배열 → 소문자 hex(zero-pad)", () => {
  assert.equal(bytesToHex([255, 0, 1, 171]), "ff0001ab");
});

// ── ssapPayload (api.go register 포팅) ───────────────────────────────────────
test("buildRegisterPayload: client-key 있으면 payload 에 포함", () => {
  const m = buildRegisterPayload("KEY123", "id-1");
  assert.equal(m.type, "register");
  assert.equal(m.id, "id-1");
  assert.equal(m.payload["client-key"], "KEY123");
  assert.ok(m.payload.manifest, "manifest 포함");
});

test("buildRegisterPayload: client-key 없으면 키 미포함", () => {
  const m = buildRegisterPayload(undefined, "id-2");
  assert.equal("client-key" in m.payload, false);
});

test("buildRequest: type/id/uri + 선택 payload", () => {
  const a = buildRequest("ssap://audio/volumeUp", undefined, "id-3");
  assert.deepEqual(a, { type: "request", id: "id-3", uri: "ssap://audio/volumeUp" });
  const b = buildRequest("ssap://audio/setVolume", { volume: 10 }, "id-4");
  assert.deepEqual(b.payload, { volume: 10 });
});

test("parseRegistered: registered 응답에서 client-key 추출(객체/문자열)", () => {
  assert.equal(parseRegistered({ type: "registered", payload: { "client-key": "abc" } }), "abc");
  assert.equal(parseRegistered('{"type":"registered","payload":{"client-key":"xyz"}}'), "xyz");
  assert.equal(parseRegistered({ type: "response", payload: {} }), null);
  assert.equal(parseRegistered({ type: "registered", payload: {} }), null);
});

// ── stateMachine (tvservice.go 상태) ─────────────────────────────────────────
test("nextState: 정상 전이표", () => {
  assert.equal(nextState("disconnected", "connect"), "connecting");
  assert.equal(nextState("connecting", "registered"), "connected");
  assert.equal(nextState("connecting", "close"), "disconnected");
  assert.equal(nextState("connected", "close"), "disconnected");
  assert.equal(nextState("connected", "screenOff"), "screenOff");
  assert.equal(nextState("screenOff", "connect"), "connecting");
});

test("nextState: 정의 안 된 전이는 현상 유지", () => {
  assert.equal(nextState("disconnected", "registered"), "disconnected");
  assert.equal(nextState("screenOff", "screenOff"), "screenOff");
});

test("shouldReconnect: ScreenOff(의도적 꺼짐)에서는 재연결 안 함", () => {
  assert.equal(shouldReconnect("disconnected"), true);
  assert.equal(shouldReconnect("screenOff"), false);
  assert.equal(shouldReconnect("connected"), false);
});

// ── powerSequence (개선 ON/OFF) ──────────────────────────────────────────────
test("powerOnActions: 연결/화면오프 상태면 turnOnScreen", () => {
  assert.deepEqual(powerOnActions("connected", false), [
    { kind: "ssap", uri: "ssap://com.webos.service.tvpower/power/turnOnScreen" },
  ]);
  assert.deepEqual(powerOnActions("screenOff", false), [
    { kind: "ssap", uri: "ssap://com.webos.service.tvpower/power/turnOnScreen" },
  ]);
});

test("powerOnActions: 미연결+MAC 있으면 WoL→connect (자동연결 보강)", () => {
  assert.deepEqual(powerOnActions("disconnected", true), [{ kind: "wol" }, { kind: "connect" }]);
});

test("powerOnActions: 미연결+MAC 없으면 error", () => {
  const r = powerOnActions("disconnected", false);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, "error");
});

test("powerOffActions: 소리+전원 완전 종료(setMute→turnOff 순서)", () => {
  assert.deepEqual(powerOffActions(), [
    { kind: "ssap", uri: "ssap://audio/setMute", payload: { mute: true } },
    { kind: "ssap", uri: "ssap://system/turnOff" },
  ]);
});

test("screenOffActions: 화면만 끄기(원본 동작 보존)", () => {
  assert.deepEqual(screenOffActions(), [
    {
      kind: "ssap",
      uri: "ssap://com.webos.service.tvpower/power/turnOffScreen",
      payload: { standbyMode: "active" },
    },
  ]);
});
