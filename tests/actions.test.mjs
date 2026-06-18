// executeActions 계약 테스트 — 추상 액션 → 실제 호출 매핑(ssap/wol/connect/error).
import { test } from "node:test";
import assert from "node:assert/strict";
import { executeActions, powerOffActions, powerOnActions, screenOffActions } from "../main.js";

function recorder() {
  const calls = [];
  return {
    calls,
    deps: {
      request: async (uri, payload) => {
        calls.push(["req", uri, payload]);
        return { ok: true };
      },
      wol: async () => calls.push("wol"),
      connect: async () => calls.push("connect"),
    },
  };
}

test("executeActions: powerOff → setMute 후 turnOff(순서)", async () => {
  const { calls, deps } = recorder();
  await executeActions(powerOffActions(), deps);
  assert.deepEqual(calls, [
    ["req", "ssap://audio/setMute", { mute: true }],
    ["req", "ssap://system/turnOff", undefined],
  ]);
});

test("executeActions: powerOn 미연결+MAC → wol 후 connect(순서)", async () => {
  const { calls, deps } = recorder();
  await executeActions(powerOnActions("disconnected", true), deps);
  assert.deepEqual(calls, ["wol", "connect"]);
});

test("executeActions: screenOff → turnOffScreen", async () => {
  const { calls, deps } = recorder();
  await executeActions(screenOffActions(), deps);
  assert.deepEqual(calls, [
    ["req", "ssap://com.webos.service.tvpower/power/turnOffScreen", { standbyMode: "active" }],
  ]);
});

test("executeActions: error 액션은 throw(메시지 전달)", async () => {
  await assert.rejects(() => executeActions([{ kind: "error", message: "MAC 없음" }], {}), /MAC 없음/);
});
