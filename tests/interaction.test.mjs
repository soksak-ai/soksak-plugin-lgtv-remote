// 상호작용 순수 로직 단위테스트 — 키보드 단축키 매핑 · 연결 보강(keepalive/on-demand 재연결).
// DOM/네트워크 0. main.js 의 named export 대상(키보드 영역과 테스트가 한 매핑을 공유 = 단일 진실).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapRemoteKey, keepalivePlan, shouldConnectOnDemand } from "../main.js";

// ── mapRemoteKey: 네비 단축키 영역 키 → 리모컨 동작(텍스트 입력은 검색칸으로 분리됨) ──
test("mapRemoteKey: 방향키 → dpad", () => {
  assert.deepEqual(mapRemoteKey("ArrowUp"), { type: "dpad", dir: "up" });
  assert.deepEqual(mapRemoteKey("ArrowDown"), { type: "dpad", dir: "down" });
  assert.deepEqual(mapRemoteKey("ArrowLeft"), { type: "dpad", dir: "left" });
  assert.deepEqual(mapRemoteKey("ArrowRight"), { type: "dpad", dir: "right" });
});

test("mapRemoteKey: Enter → OK", () => {
  assert.deepEqual(mapRemoteKey("Enter"), { type: "ok" });
});

test("mapRemoteKey: Backspace/Escape → 뒤로(BACK)", () => {
  assert.deepEqual(mapRemoteKey("Backspace"), { type: "back" });
  assert.deepEqual(mapRemoteKey("Escape"), { type: "back" });
});

test("mapRemoteKey: [ - _ → 볼륨-, ] + = → 볼륨+", () => {
  for (const k of ["[", "-", "_"]) assert.deepEqual(mapRemoteKey(k), { type: "volume", dir: "down" }, k);
  for (const k of ["]", "+", "="]) assert.deepEqual(mapRemoteKey(k), { type: "volume", dir: "up" }, k);
});

test("mapRemoteKey: PageUp/PageDown → 채널", () => {
  assert.deepEqual(mapRemoteKey("PageUp"), { type: "channel", dir: "up" });
  assert.deepEqual(mapRemoteKey("PageDown"), { type: "channel", dir: "down" });
});

test("mapRemoteKey: Space → 재생/일시정지", () => {
  assert.deepEqual(mapRemoteKey(" "), { type: "playpause" });
});

test("mapRemoteKey: m → 음소거 토글(대소문자)", () => {
  assert.deepEqual(mapRemoteKey("m"), { type: "mute" });
  assert.deepEqual(mapRemoteKey("M"), { type: "mute" });
});

test("mapRemoteKey: h → HOME(대소문자)", () => {
  assert.deepEqual(mapRemoteKey("h"), { type: "home" });
  assert.deepEqual(mapRemoteKey("H"), { type: "home" });
});

test("mapRemoteKey: 미매핑 키는 null(기본 동작 유지)", () => {
  assert.equal(mapRemoteKey("a"), null);
  assert.equal(mapRemoteKey("Tab"), null);
  assert.equal(mapRemoteKey("F5"), null);
  assert.equal(mapRemoteKey("1"), null);
});

// ── keepalivePlan: 모달이 열려 있는 동안 주기 틱의 행동 결정 ──
test("keepalivePlan: connected → ping(idle 끊김 예방)", () => {
  assert.equal(keepalivePlan("connected", true), "ping");
  assert.equal(keepalivePlan("connected", false), "ping");
});

test("keepalivePlan: disconnected + ip 있으면 reconnect", () => {
  assert.equal(keepalivePlan("disconnected", true), "reconnect");
});

test("keepalivePlan: disconnected + ip 없으면 idle(설정 전이면 가만)", () => {
  assert.equal(keepalivePlan("disconnected", false), "idle");
});

test("keepalivePlan: screenOff(의도적)·connecting 은 idle(건드리지 않음)", () => {
  assert.equal(keepalivePlan("screenOff", true), "idle");
  assert.equal(keepalivePlan("connecting", true), "idle");
});

// ── shouldConnectOnDemand: 버튼 조작 직전 재연결 필요 여부 ──
test("shouldConnectOnDemand: disconnected 만 true(나머지는 이미 살아있음)", () => {
  assert.equal(shouldConnectOnDemand("disconnected"), true);
  assert.equal(shouldConnectOnDemand("connected"), false);
  assert.equal(shouldConnectOnDemand("connecting"), false);
  assert.equal(shouldConnectOnDemand("screenOff"), false);
});
