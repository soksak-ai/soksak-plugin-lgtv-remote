// TvClient 계약 테스트(MockTransport, 네트워크 0) — 페어링/요청응답/타임아웃/재연결/포인터.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TvClient } from "../main.js";

// 다음 마이크로태스크/타이머까지 양보(connect 내부 await 체인 flush).
const tick = () => new Promise((r) => setTimeout(r, 0));

class MockTransport {
  constructor() {
    this.sent = [];
    this.url = null;
    this.connectCount = 0;
    this._m = () => {};
    this._c = () => {};
  }
  async connect(url) {
    this.url = url;
    this.connectCount++;
  }
  send(t) {
    this.sent.push(t);
  }
  onMessage(cb) {
    this._m = cb;
  }
  onClose(cb) {
    this._c = cb;
  }
  close() {}
  inject(o) {
    this._m(typeof o === "string" ? o : JSON.stringify(o));
  }
  fireClose() {
    this._c();
  }
  last() {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

function memStorage(init = {}) {
  const m = { ...init };
  return { read: async (k) => m[k] ?? null, write: async (k, v) => void (m[k] = v) };
}

function newClient(extra = {}) {
  const control = new MockTransport();
  const pointer = new MockTransport();
  const storage = memStorage(extra.storage);
  const c = new TvClient({
    control,
    pointer,
    storage,
    registerTimeoutMs: 500,
    timeoutMs: 500,
    ...extra,
  });
  return { c, control, pointer, storage };
}

test("페어링: register 송신 → registered+key → connected + storage 저장", async () => {
  const { c, control, storage } = newClient();
  const p = c.connect("1.2.3.4", false);
  await tick();
  const reg = control.last();
  assert.equal(reg.type, "register");
  assert.equal(control.url, "ws://1.2.3.4:3000");
  control.inject({ type: "registered", id: reg.id, payload: { "client-key": "NEWKEY" } });
  await p;
  assert.equal(c.state, "connected");
  assert.equal(await storage.read("client-key"), "NEWKEY");
});

test("페어링: response(프롬프트) 후 registered 까지 대기", async () => {
  const { c, control } = newClient();
  const p = c.connect("1.2.3.4", false);
  await tick();
  const reg = control.last();
  control.inject({ type: "response", id: reg.id, payload: { pairingType: "PROMPT" } });
  await tick();
  assert.equal(c.state, "connecting"); // 아직 registered 안 옴
  control.inject({ type: "registered", id: reg.id, payload: { "client-key": "K2" } });
  await p;
  assert.equal(c.state, "connected");
});

test("request-response: 같은 id 응답에 payload resolve", async () => {
  const { c, control } = newClient();
  const rp = c.request("ssap://audio/getStatus");
  await tick();
  const req = control.last();
  assert.equal(req.type, "request");
  assert.equal(req.uri, "ssap://audio/getStatus");
  control.inject({ type: "response", id: req.id, payload: { volume: 10 } });
  assert.deepEqual(await rp, { volume: 10 });
});

test("무응답 → timeout reject (호스트 안 죽음)", async () => {
  const { c } = newClient({ timeoutMs: 30 });
  await assert.rejects(() => c.request("ssap://x"), /timeout/i);
});

test("close → disconnected + 이벤트 기반 재연결 1회(폴링 아님)", async () => {
  const { c, control } = newClient();
  const p = c.connect("1.2.3.4", false);
  await tick();
  control.inject({ type: "registered", id: control.last().id, payload: { "client-key": "K" } });
  await p;
  assert.equal(control.connectCount, 1);
  control.fireClose();
  await tick();
  assert.equal(control.connectCount, 2); // 재연결로 connect 재호출
});

test("button: getPointerInputSocket → socketPath → pointer 연결 + 프레임 송신", async () => {
  const { c, control, pointer } = newClient();
  const bp = c.button("UP");
  await tick();
  const req = control.last();
  assert.equal(req.uri, "ssap://com.webos.service.networkinput/getPointerInputSocket");
  control.inject({ type: "response", id: req.id, payload: { socketPath: "ws://1.2.3.4:3001/pointer" } });
  await bp;
  assert.equal(pointer.url, "ws://1.2.3.4:3001/pointer");
  assert.equal(pointer.sent[pointer.sent.length - 1], "type:button\nname:UP\n\n");
});
