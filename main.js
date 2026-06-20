// soksak-plugin-lgtv-remote — LG webOS TV 리모컨.
// 단일 ESM entry(spec §0-2: Blob import 라 상대 import 불가 → 단일 파일). 순수 함수는 named export
// 하여 node --test 로 검증(claude-gui 패턴). 실제 동작은 activate(ctx) 안에서만(top-level 부수효과 0).
//
// SSAP 프로토콜·매직패킷은 원본(lg-tv-control-macos: wol.go, internal/webostv/api.go)을 충실히 포팅.

// ── magicPacket (wol.go 포팅) ────────────────────────────────────────────────
// MAC "aa:bb:cc:dd:ee:ff"(또는 하이픈) → Wake-on-LAN 매직패킷 102바이트(0xFF×6 + MAC×16).
export function buildMagicPacket(mac) {
  const parts = String(mac).trim().replace(/-/g, ":").split(":");
  if (parts.length !== 6) throw new Error(`잘못된 MAC(6옥텟 아님): ${mac}`);
  const bytes = parts.map((p) => {
    if (!/^[0-9a-fA-F]{1,2}$/.test(p)) throw new Error(`잘못된 MAC 옥텟: ${p}`);
    return parseInt(p, 16);
  });
  const packet = [];
  for (let i = 0; i < 6; i++) packet.push(0xff);
  for (let i = 0; i < 16; i++) packet.push(...bytes);
  return packet; // 6 + 16*6 = 102
}

// 바이트 배열 → 소문자 hex(zero-pad). net.udp.send 의 data 인자 형식.
export function bytesToHex(bytes) {
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join("");
}

// ── ssapPayload (api.go helloPayload/Register/Request 포팅) ───────────────────
// 페어링 manifest — 원본 helloPayload() 그대로. TV 가 client-key 를 발급하는 권한 선언.
const REGISTER_MANIFEST = {
  manifestVersion: 1,
  appVersion: "1.1",
  signed: {
    created: "20140509",
    appId: "com.lge.test",
    vendorId: "com.lge",
    localizedAppNames: { "": "LG Remote App", "ko-KR": "리모컨 앱", "zxx-XX": "ЛГ Rэмotэ AПП" },
    localizedVendorNames: { "": "LG Electronics" },
    permissions: [
      "TEST_SECURE",
      "CONTROL_INPUT_TEXT",
      "CONTROL_MOUSE_AND_KEYBOARD",
      "READ_INSTALLED_APPS",
      "READ_LGE_SDX",
      "READ_NOTIFICATIONS",
      "SEARCH",
      "WRITE_SETTINGS",
      "WRITE_NOTIFICATION_ALERT",
      "CONTROL_POWER",
      "CONTROL_TV_SCREEN",
      "CONTROL_TV_POWER",
      "READ_CURRENT_CHANNEL",
      "READ_RUNNING_APPS",
      "READ_UPDATE_INFO",
      "UPDATE_FROM_REMOTE_APP",
      "READ_LGE_TV_INPUT_EVENTS",
      "READ_TV_CURRENT_TIME",
    ],
    serial: "2f930e2d2cfe083771f68e4fe7bb07",
  },
  permissions: [
    "LAUNCH",
    "LAUNCH_WEBAPP",
    "APP_TO_APP",
    "CLOSE",
    "TEST_OPEN",
    "TEST_PROTECTED",
    "CONTROL_AUDIO",
    "CONTROL_DISPLAY",
    "CONTROL_INPUT_JOYSTICK",
    "CONTROL_INPUT_MEDIA_RECORDING",
    "CONTROL_INPUT_MEDIA_PLAYBACK",
    "CONTROL_INPUT_TV",
    "CONTROL_POWER",
    "CONTROL_TV_SCREEN",
    "CONTROL_TV_POWER",
    "CONTROL_INPUT_TEXT",
    "CONTROL_MOUSE_AND_KEYBOARD",
    "READ_APP_STATUS",
    "READ_CURRENT_CHANNEL",
    "READ_INPUT_DEVICE_LIST",
    "READ_NETWORK_STATE",
    "READ_RUNNING_APPS",
    "READ_TV_CHANNEL_LIST",
    "READ_INSTALLED_APPS",
    "READ_SETTINGS",
    "READ_STORAGE_DEVICE_LIST",
    "WRITE_NOTIFICATION_TOAST",
    "READ_POWER_STATE",
    "READ_COUNTRY_INFO",
  ],
  signatures: [
    {
      signatureVersion: 1,
      signature:
        "eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw==",
    },
  ],
};

export function buildRegisterPayload(clientKey, id) {
  const payload = { forcePairing: false, pairingType: "PROMPT", manifest: REGISTER_MANIFEST };
  if (clientKey) payload["client-key"] = clientKey;
  return { type: "register", id, payload };
}

export function buildRequest(uri, payload, id) {
  const msg = { type: "request", id, uri };
  if (payload !== undefined) msg.payload = payload;
  return msg;
}

// registered 응답에서 client-key 추출(객체 또는 JSON 문자열). 아니면 null.
export function parseRegistered(msg) {
  let m;
  try {
    m = typeof msg === "string" ? JSON.parse(msg) : msg;
  } catch {
    return null;
  }
  if (m && m.type === "registered" && m.payload && typeof m.payload["client-key"] === "string") {
    return m.payload["client-key"];
  }
  return null;
}

// 8자 랜덤 메시지 id(api.go makeId 포팅). 순수 함수는 id 를 인자로 받아 테스트 가능, 실행 시 이걸 주입.
const ID_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export function makeId(n = 8) {
  let s = "";
  for (let i = 0; i < n; i++) s += ID_LETTERS[Math.floor(Math.random() * ID_LETTERS.length)];
  return s;
}

// ── stateMachine (tvservice.go 상태) ─────────────────────────────────────────
const TRANSITIONS = {
  disconnected: { connect: "connecting" },
  connecting: { registered: "connected", close: "disconnected" },
  connected: { close: "disconnected", screenOff: "screenOff" },
  screenOff: { connect: "connecting", close: "disconnected" },
};

export function nextState(state, event) {
  return TRANSITIONS[state]?.[event] ?? state; // 정의 안 된 전이는 현상 유지
}

// 자동 재연결 여부 — ScreenOff(사용자가 의도적으로 끔)에서는 재연결하지 않는다(tvservice.go reconnectLoop).
export function shouldReconnect(state) {
  return state === "disconnected";
}

// 버튼 조작 직전 재연결 필요 여부 — disconnected 만. connected/screenOff 는 control 소켓이 살아있고,
// connecting 은 진행 중이라 중복 connect 를 피한다.
export function shouldConnectOnDemand(state) {
  return state === "disconnected";
}

// 모달이 열려 있는 동안 주기 틱(keepalive)의 행동 결정.
// connected → 가벼운 read 핑으로 idle 끊김 예방. disconnected+ip → 재연결. 그 외(screenOff 의도적
// 꺼짐·connecting 진행 중·ip 미설정) → 건드리지 않음.
export function keepalivePlan(state, hasIp) {
  if (state === "connected") return "ping";
  if (state === "disconnected" && hasIp) return "reconnect";
  return "idle";
}

// ── powerSequence (개선 ON/OFF — 레거시 보완) ────────────────────────────────
const SSAP = {
  turnOnScreen: "ssap://com.webos.service.tvpower/power/turnOnScreen",
  turnOffScreen: "ssap://com.webos.service.tvpower/power/turnOffScreen",
  setMute: "ssap://audio/setMute",
  systemTurnOff: "ssap://system/turnOff",
};

// 전원 ON: 연결/화면오프면 화면만 켜고, 미연결이면 WoL 송신 + 자동 재연결(원본은 WoL 만 보내고 끝 — 보강).
export function powerOnActions(state, hasMac) {
  if (state === "connected" || state === "screenOff") {
    return [{ kind: "ssap", uri: SSAP.turnOnScreen }];
  }
  if (!hasMac) return [{ kind: "error", message: "MAC 주소 없음 — set-mac 으로 설정 필요" }];
  return [{ kind: "wol" }, { kind: "connect" }];
}

// 전원 OFF: 화면만 끄던 원본을 보완해 소리(setMute)+전원(turnOff)까지 완전 종료.
export function powerOffActions() {
  return [
    { kind: "ssap", uri: SSAP.setMute, payload: { mute: true } },
    { kind: "ssap", uri: SSAP.systemTurnOff },
  ];
}

// 화면만 끄기(원본 turnOffScreen 동작 보존 — screen-off 명령용).
export function screenOffActions() {
  return [{ kind: "ssap", uri: SSAP.turnOffScreen, payload: { standbyMode: "active" } }];
}

// ── SSDP discovery (TV 자동 발견) ────────────────────────────────────────────
// 실TV 검증으로 확정: webOS TV 는 webOSSecondScreen ST 에 응답 안 하고 ssdp:all 에 응답한다.
// 식별 = SERVER 헤더의 "WebOS" 또는 ST/USN 의 "lge". (원본 discoverTV 의 ssdp:all 폴백 + LG 필터)
export const SSDP_ST_ALL = "ssdp:all";
export const SSDP_ST_WEBOS = "urn:lge-com:service:webOSSecondScreen:1";

export function buildMSearch(st, mxSeconds) {
  return (
    "M-SEARCH * HTTP/1.1\r\n" +
    "HOST: 239.255.255.250:1900\r\n" +
    'MAN: "ssdp:discover"\r\n' +
    "MX: " + mxSeconds + "\r\n" +
    "ST: " + st + "\r\n" +
    "\r\n"
  );
}

// 문자열 → UTF-8 hex(net.udp.request 의 data 인자 형식).
export function strToHex(s) {
  return bytesToHex(Array.from(new TextEncoder().encode(s)));
}

// SSDP 응답 패킷들에서 LG webOS TV 의 IP 추출(중복 제거). packet = {address, text}.
export function parseLgTvAddresses(packets) {
  const seen = new Set();
  const out = [];
  for (const p of packets || []) {
    const t = p && p.text ? p.text : "";
    if (p && p.address && /webos|urn:lge|lge:/i.test(t) && !seen.has(p.address)) {
      seen.add(p.address);
      out.push(p.address);
    }
  }
  return out;
}

// ── Transport / TvClient ─────────────────────────────────────────────────────
// Transport 계약(TvClient 가 의존하는 단 하나의 경계 — 실/Mock 교체점):
//   connect(url): Promise<void> · send(text): void · onMessage(cb) · onClose(cb) · close()
// CoreWsTransport: 코어 app.ws(Origin 미전송) 래퍼. MockTransport(테스트)는 테스트 파일에.
//
// [중요] 브라우저/webview 의 WebSocket 은 Origin 헤더를 강제로 붙이고 변경할 수 없어, Origin 을
// 검사하는 webOS TV 가 close 1008 "invalid origin" 으로 거부한다(실TV 검증). 그래서 코어가 Origin
// 을 보내지 않는 WebSocket(tokio-tungstenite)을 대행한다 — app.ws 경유(WoL=net.udp.send 와 동일 원리).

export class CoreWsTransport {
  constructor(ws) {
    this.ws = ws; // ctx.app.ws (코어 capability)
    this.id = null;
    this._msg = () => {};
    this._close = () => {};
    this._subs = [];
  }
  async connect(url) {
    this.id = await this.ws.connect(url); // 연결 수립 후 resolve
    this._subs.push(this.ws.onMessage(this.id, (t) => this._msg(t)));
    this._subs.push(this.ws.onClose(this.id, () => this._close()));
  }
  send(text) {
    if (this.id != null) this.ws.send(this.id, text);
  }
  onMessage(cb) {
    this._msg = cb;
  }
  onClose(cb) {
    this._close = cb;
  }
  close() {
    for (const d of this._subs.splice(0)) {
      try {
        d && d.dispose ? d.dispose() : typeof d === "function" && d();
      } catch {
        /* noop */
      }
    }
    if (this.id != null) {
      try {
        this.ws.close(this.id);
      } catch {
        /* noop */
      }
    }
    this.id = null;
  }
}

const POINTER_URI = "ssap://com.webos.service.networkinput/getPointerInputSocket";

// TvClient — transport·상태머신·페이로드빌더 조립. 페어링·요청응답 상관·이벤트 기반 재연결·포인터.
// 의존 주입(테스트는 MockTransport): { control, pointer, storage:{read,write}, log?, onState?, timeoutMs?, registerTimeoutMs?, makeId? }.
export class TvClient {
  constructor(opts) {
    this.control = opts.control;
    this.pointer = opts.pointer;
    this.storage = opts.storage;
    this.log = opts.log || (() => {});
    this.onState = opts.onState || (() => {});
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.registerTimeoutMs = opts.registerTimeoutMs ?? 30000;
    this.makeId = opts.makeId || makeId;
    this.state = "disconnected";
    this.pending = new Map(); // id → { handle(msg) }
    this.ip = null;
    this.useTls = false;
    this.clientKey = null;
    this.pointerReady = false;
    this.control.onMessage((t) => this._onMessage(t));
    this.control.onClose(() => this._onClose());
  }

  _setState(s) {
    this.state = s;
    try {
      this.onState(s);
    } catch {
      /* noop */
    }
  }

  _onMessage(text) {
    this.log("recv " + String(text).slice(0, 120));
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    this.pending.get(m.id)?.handle(m);
  }

  _onClose() {
    this.pointerReady = false;
    if (this.state === "connecting") return; // 연결 진행 중 끊김은 재연결 폭주 방지
    if (this.state !== "screenOff") this._setState("disconnected");
    // 이벤트 기반 재연결(폴링 아님). ScreenOff(의도적 꺼짐)에서는 안 함.
    if (shouldReconnect(this.state) && this.ip) {
      this.connect(this.ip, this.useTls).catch((e) => this.log("재연결 실패: " + e));
    }
  }

  // pending 에 핸들러 등록 + 타임아웃. handle(msg, done) 에서 done() 호출 시 정리.
  _track(id, onMsg, timeoutMs, reject) {
    const done = () => {
      clearTimeout(timer);
      this.pending.delete(id);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("timeout"));
    }, timeoutMs);
    this.pending.set(id, { handle: (m) => onMsg(m, done) });
  }

  request(uri, payload) {
    const id = this.makeId();
    return new Promise((resolve, reject) => {
      this._track(
        id,
        (m, done) => {
          done();
          if (m.type === "error") reject(new Error(m.error || "ssap error"));
          else resolve(m.payload);
        },
        this.timeoutMs,
        reject,
      );
      this.control.send(JSON.stringify(buildRequest(uri, payload, id)));
    });
  }

  // register 는 response(페어링 프롬프트) 후 registered 가 올 수 있다 — registered 까지 대기(api.go).
  _registerOnce() {
    const id = this.makeId();
    return new Promise((resolve, reject) => {
      this._track(
        id,
        (m, done) => {
          if (m.type === "registered") {
            done();
            resolve(m);
          } else if (m.type === "error") {
            done();
            reject(new Error(m.error || "register error"));
          }
          // response(프롬프트) → done 미호출, 계속 대기
        },
        this.registerTimeoutMs,
        reject,
      );
      this.log("register sent" + (this.clientKey ? " (key)" : " (pairing)"));
      this.control.send(JSON.stringify(buildRegisterPayload(this.clientKey || undefined, id)));
    });
  }

  async connect(ip, useTls) {
    this.ip = ip;
    this.useTls = !!useTls;
    this._setState("connecting");
    const url = useTls ? `wss://${ip}:3001` : `ws://${ip}:3000`;
    this.log("ws connect " + url);
    await this.control.connect(url);
    this.log("ws open");
    if (!this.clientKey) this.clientKey = await this.storage.read("client-key");
    const resp = await this._registerOnce();
    const key = parseRegistered(resp);
    if (key && key !== this.clientKey) {
      this.clientKey = key;
      await this.storage.write("client-key", key);
    }
    this._setState("connected");
    return this.state;
  }

  async _ensurePointer() {
    if (this.pointerReady) return;
    const payload = await this.request(POINTER_URI);
    const socketPath = payload && payload.socketPath;
    if (!socketPath) throw new Error("pointer socketPath 없음");
    await this.pointer.connect(socketPath);
    this.pointerReady = true;
  }

  // 방향키/버튼(포인터 채널): "type:button\nname:NAME\n\n"(pointersocket.go).
  async button(name) {
    await this._ensurePointer();
    this.pointer.send(`type:button\nname:${name}\n\n`);
  }

  close() {
    this.control.close?.();
    this.pointer.close?.();
  }
}

// ── action 실행기 ────────────────────────────────────────────────────────────
// powerOnActions/powerOffActions 등이 낸 추상 액션을 실제 호출로 매핑한다.
// deps: { request(uri,payload), wol(), connect() }. ssap→request, wol→WoL(net.udp.send), error→throw.
export async function executeActions(actions, deps) {
  const results = [];
  for (const a of actions) {
    if (a.kind === "ssap") results.push(await deps.request(a.uri, a.payload));
    else if (a.kind === "wol") results.push(await deps.wol());
    else if (a.kind === "connect") results.push(await deps.connect());
    else if (a.kind === "error") throw new Error(a.message);
  }
  return results;
}

// ── 디버그 로그(링버퍼) ──────────────────────────────────────────────────────
// 통신 실측 불가 → 명령/SSAP/상태전이를 기록해 나중에 dump-log 로 디버그.
function makeDebugLog(cap = 200) {
  const buf = [];
  return {
    push(kind, detail) {
      buf.push({ kind, detail: String(detail ?? "") });
      if (buf.length > cap) buf.shift();
    },
    tail(n) {
      return buf.slice(-(n || 50));
    },
  };
}

const DPAD = { up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT", enter: "ENTER" };
const PLUGIN_ID = "soksak-plugin-lgtv-remote";

// ── 네비 단축키 매핑(키보드 영역과 단위테스트의 단일 진실) ───────────────────
// 텍스트 입력은 별도 검색칸이 담당하므로 이 영역은 순수 네비/제어 단축키만 — [ ] · space 등
// 인쇄문자도 검색 입력과 충돌 없이 단축키로 쓸 수 있다. 미매핑 키는 null(기본 동작 유지).
const KEY_VOL_DOWN = new Set(["[", "-", "_"]);
const KEY_VOL_UP = new Set(["]", "+", "="]);
export function mapRemoteKey(key) {
  switch (key) {
    case "ArrowUp": return { type: "dpad", dir: "up" };
    case "ArrowDown": return { type: "dpad", dir: "down" };
    case "ArrowLeft": return { type: "dpad", dir: "left" };
    case "ArrowRight": return { type: "dpad", dir: "right" };
    case "Enter": return { type: "ok" };
    case "Backspace":
    case "Escape": return { type: "back" };
    case "PageUp": return { type: "channel", dir: "up" };
    case "PageDown": return { type: "channel", dir: "down" };
    case " ": return { type: "playpause" };
    case "m":
    case "M": return { type: "mute" };
    case "h":
    case "H": return { type: "home" };
  }
  if (KEY_VOL_DOWN.has(key)) return { type: "volume", dir: "down" };
  if (KEY_VOL_UP.has(key)) return { type: "volume", dir: "up" };
  return null;
}

// ── 플러그인 entry ───────────────────────────────────────────────────────────
let _ui = null; // deactivate 정리용(modal/fab/style)

export default {
  activate(ctx) {
    const app = ctx.app;
    const log = makeDebugLog(200);

    // 설정·client-key 는 plugin storage 단일(프로젝트 무관). settings.set 불확실성 회피.
    const storage = {
      read: async (k) => (app.storage ? await app.storage.read(k) : null),
      write: async (k, v) => {
        if (app.storage) await app.storage.write(k, v);
      },
    };
    const getCfg = async () => ({
      ip: ((await storage.read("tvIp")) || "").trim(),
      mac: ((await storage.read("tvMac")) || "").trim(),
      useTls: (await storage.read("useTls")) === "1",
    });

    let client = null;
    function ensureClient() {
      if (client) return client;
      if (!app.ws) throw new Error('WebSocket capability 없음("network" 권한 필요)');
      client = new TvClient({
        control: new CoreWsTransport(app.ws),
        pointer: new CoreWsTransport(app.ws),
        storage,
        log: (m) => log.push("client", m),
        onState: (s) => {
          log.push("state", s);
          updateDot();
        },
      });
      return client;
    }

    async function sendWol() {
      const { mac } = await getCfg();
      if (!mac) throw new Error("MAC 없음 — set-mac/scan-mac 필요");
      const hex = bytesToHex(buildMagicPacket(mac));
      log.push("wol", mac);
      return app.commands.execute("net.udp.send", {
        host: "255.255.255.255",
        port: 9,
        data: hex,
        broadcast: true,
      });
    }

    const actionDeps = () => ({
      request: (uri, payload) => {
        log.push("ssap", uri);
        return ensureClient().request(uri, payload);
      },
      wol: sendWol,
      connect: async () => {
        const { ip, useTls } = await getCfg();
        if (!ip) throw new Error("tvIp 설정 필요 — set-ip");
        return ensureClient().connect(ip, useTls);
      },
    });

    // 조작 직전 연결 보장 — 끊겨 있고 IP 가 설정돼 있으면 마지막 IP 로 재연결(다시 열·버튼 누를 때 복구).
    // 이미 살아있으면(connected/screenOff/connecting) no-op. 실패는 조용히 로깅(동작 자체는 진행 시도).
    async function ensureConnected() {
      const state = client ? client.state : "disconnected";
      if (!shouldConnectOnDemand(state)) return;
      const { ip } = await getCfg();
      if (!ip) return; // 아직 IP 미설정 — 설정 UI 가 안내, 강제 에러 안 냄
      try {
        await actionDeps().connect();
      } catch (e) {
        log.push("reconnect", "on-demand 실패: " + (e && e.message ? e.message : e));
      }
    }

    // keepalive — 모달이 열려 있는 동안만 주기 틱. connected 면 가벼운 read 핑으로 idle 끊김 예방,
    // disconnected+ip 면 재연결, 그 외(screenOff/connecting/ip 미설정)는 가만(keepalivePlan).
    let kaTimer = null;
    const KEEPALIVE_MS = 30000;
    async function keepaliveTick() {
      const { ip } = await getCfg();
      const plan = keepalivePlan(client ? client.state : "disconnected", !!ip);
      if (plan === "ping") {
        try {
          await actionDeps().request("ssap://com.webos.service.tvpower/power/getPowerState");
        } catch (e) {
          log.push("keepalive", "ping 실패: " + (e && e.message ? e.message : e));
        }
      } else if (plan === "reconnect") {
        try {
          await actionDeps().connect();
        } catch (e) {
          log.push("keepalive", "재연결 실패: " + (e && e.message ? e.message : e));
        }
      }
    }
    function startKeepalive() {
      if (kaTimer) return;
      kaTimer = setInterval(() => {
        keepaliveTick().catch((e) => log.push("keepalive", "tick 오류: " + (e && e.message ? e.message : e)));
      }, KEEPALIVE_MS);
    }
    function stopKeepalive() {
      if (kaTimer) {
        clearInterval(kaTimer);
        kaTimer = null;
      }
    }

    // 모든 동작의 단일 진실 — command 핸들러와 UI 버튼이 공유. SSAP 동작은 연결 보장 후 전송.
    const req = async (uri, payload) => {
      await ensureConnected();
      return actionDeps().request(uri, payload);
    };
    const actions = {
      connect: async () => {
        await actionDeps().connect();
        return client.state;
      },
      disconnect: () => {
        client?.close();
        client = null;
        return "disconnected";
      },
      powerOn: async () => {
        const { mac } = await getCfg();
        const st = client ? client.state : "disconnected";
        return executeActions(powerOnActions(st, !!mac), actionDeps());
      },
      powerOff: async () => {
        const r = await executeActions(powerOffActions(), actionDeps());
        // 완전 종료 = TV 가 standby 로 전환되며 연결이 끊긴다. 연결을 정리해야 다음 power-on 이
        // turnOnScreen(연결 가정)이 아니라 WoL 분기로 간다(실TV 검증: standby 에서 turnOnScreen 은 500).
        if (client) {
          try {
            client.close();
          } catch {
            /* noop */
          }
          client = null;
        }
        return r;
      },
      screenOff: () => executeActions(screenOffActions(), actionDeps()),
      screenOn: () => req("ssap://com.webos.service.tvpower/power/turnOnScreen"),
      volumeUp: () => req("ssap://audio/volumeUp"),
      volumeDown: () => req("ssap://audio/volumeDown"),
      setVolume: (v) => req("ssap://audio/setVolume", { volume: v }),
      mute: (on) => req("ssap://audio/setMute", { mute: on }),
      channelUp: () => req("ssap://tv/channelUp"),
      channelDown: () => req("ssap://tv/channelDown"),
      openChannel: (n) => req("ssap://tv/openChannel", { channelId: n }),
      inputs: () => req("ssap://tv/getExternalInputList"),
      switchInput: (id) => req("ssap://tv/switchInput", { inputId: id }),
      dpad: async (dir) => {
        await ensureConnected();
        return ensureClient().button(DPAD[dir] || "ENTER");
      },
      button: async (name) => {
        await ensureConnected();
        return ensureClient().button(name);
      },
      media: (a) => req(`ssap://media.controls/${a}`),
      textInput: (text, replace) =>
        req("ssap://com.webos.service.ime/insertText", { text, replace: !!replace }),
      textDelete: (count) =>
        req("ssap://com.webos.service.ime/deleteCharacters", { count }),
      textEnter: () => req("ssap://com.webos.service.ime/sendEnterKey"),
      toast: (message) => req("ssap://system.notifications/createToast", { message }),
      apps: () => req("ssap://com.webos.applicationManager/listApps"),
      launch: (id) => req("ssap://com.webos.applicationManager/launch", { id }),
      foregroundApp: () =>
        req("ssap://com.webos.applicationManager/getForegroundAppInfo"),
    };

    // ARP/ping 으로 MAC 자동 획득(getMACFromARP 포팅 — process capability).
    function runProc(cmd, args) {
      return new Promise((resolve, reject) => {
        let out = "";
        const timer = setTimeout(() => reject(new Error("proc timeout")), 5000);
        Promise.resolve(app.process.spawn(cmd, args, {}))
          .then((h) => {
            app.process.onData(h, (d) => (out += new TextDecoder().decode(d)));
            app.process.onExit(h, () => {
              clearTimeout(timer);
              resolve(out);
            });
          })
          .catch((e) => {
            clearTimeout(timer);
            reject(e);
          });
      });
    }
    async function scanMac() {
      const { ip } = await getCfg();
      if (!ip) throw new Error("tvIp 설정 필요");
      if (!app.process) throw new Error("process 권한 없음");
      await runProc("ping", ["-c", "1", "-W", "1000", ip]).catch(() => {});
      const out = await runProc("arp", ["-n", ip]);
      for (const line of out.split("\n")) {
        for (const f of line.trim().split(/\s+/)) {
          if (f.split(":").length >= 5) {
            const mac = f.toUpperCase();
            await storage.write("tvMac", mac);
            return mac;
          }
        }
      }
      throw new Error("MAC 못 찾음(같은 서브넷·TV 켜짐 확인)");
    }

    // SSDP 로 LG TV 자동 발견(코어 net.udp.request 경유). webOS ST 우선, 없으면 ssdp:all 폴백
    // (실TV 검증: webOS TV 는 webOSSecondScreen ST 에 응답 안 하고 ssdp:all 에 응답).
    async function discoverTvs(timeoutMs) {
      // ssdp:all 단일 — 실TV 검증: webOS TV 는 webOSSecondScreen ST 엔 응답 안 하고 ssdp:all 에 응답.
      // 모든 UPnP 기기가 ssdp:all 에 응답하므로 LG 필터(SERVER:WebOS / urn:lge)로 선별. 1회로 빠르다.
      const t = timeoutMs || 3000;
      const r = await app.commands.execute("net.udp.request", {
        host: "239.255.255.250",
        port: 1900,
        data: strToHex(buildMSearch(SSDP_ST_ALL, Math.max(1, Math.floor(t / 1000)))),
        timeoutMs: t,
        maxPackets: 128,
      });
      const packets = r && r.ok ? r.packets : (r && r.packets) || [];
      const tvs = parseLgTvAddresses(packets);
      log.push("discover", tvs.join(",") || "(없음)");
      return tvs;
    }

    // TV 찾기 전체 흐름: 발견 → 첫 TV 를 tvIp 저장 → 그 IP 로 MAC 획득(arp).
    async function autoFind() {
      const tvs = await discoverTvs(4000);
      if (!tvs.length) throw new Error("LG TV 못 찾음(같은 네트워크·TV 켜짐 확인)");
      await storage.write("tvIp", tvs[0]);
      let mac = "";
      try {
        mac = await scanMac();
      } catch (e) {
        log.push("scan-mac", String((e && e.message) || e));
      }
      return { ip: tvs[0], mac };
    }

    // ── command 등록(전부 CLI/MCP 노출) ──────────────────────────────────────
    const reg = (name, spec) => ctx.subscriptions.push(app.commands.register(name, spec));
    // 핸들러의 일반 객체 반환은 {ok:true, ...객체}로 편다(registry 가 또 래핑해도 idempotent). 에러는 INTERNAL.
    const wrap = (fn) => async (p) => {
      try {
        const r = await fn(p);
        if (r && typeof r === "object" && "ok" in r) return r;
        if (r && typeof r === "object") return { ok: true, ...r };
        return { ok: true, result: r };
      } catch (e) {
        return { ok: false, code: "INTERNAL", message: String(e && e.message ? e.message : e) };
      }
    };

    reg("connect", {
      description: "Connect to LG webOS TV via WebSocket and complete pairing (SSAP register). Use when user asks to connect or pair with the TV.",
      triggers: { ko: "TV 연결 페어링 접속" },
      params: {},
      returns: "{ state }",
      handler: wrap(async () => ({ state: await actions.connect() })),
    });
    reg("disconnect", {
      description: "Disconnect from the TV and release the WebSocket connection. Use when user asks to disconnect or close the TV connection.",
      triggers: { ko: "TV 연결 해제 끊기 접속 종료" },
      params: {},
      returns: "{ state }",
      handler: wrap(() => ({ state: actions.disconnect() })),
    });
    reg("status", {
      description: "Read current TV connection state — connection status, IP address, MAC address, and pairing key presence. Use when user asks about TV connection state.",
      triggers: { ko: "TV 연결 상태 IP MAC 페어링 확인" },
      params: {},
      returns: "{ state, ip, mac, paired }",
      handler: wrap(async () => {
        const { ip, mac } = await getCfg();
        return { state: client ? client.state : "disconnected", ip, mac, paired: !!(client && client.clientKey) };
      }),
    });
    reg("set-ip", {
      description: "Set the TV IP address used for WebSocket connection. Use when user provides a TV IP or wants to change the target TV.",
      triggers: { ko: "TV IP 설정 주소 변경 입력" },
      params: { ip: { type: "string", description: "TV IP 주소", required: true } },
      returns: "{ ip }",
      handler: wrap(async (p) => {
        await storage.write("tvIp", String(p.ip).trim());
        syncInputs();
        return { ip: String(p.ip).trim() };
      }),
    });
    reg("set-mac", {
      description: "Set the TV MAC address for Wake-on-LAN. Use when user provides a MAC address or wants to enable WoL power-on.",
      triggers: { ko: "TV MAC 주소 설정 WoL 매직패킷" },
      params: { mac: { type: "string", description: "TV MAC 주소", required: true } },
      returns: "{ mac }",
      handler: wrap(async (p) => {
        await storage.write("tvMac", String(p.mac).trim());
        syncInputs();
        return { mac: String(p.mac).trim() };
      }),
    });
    reg("scan-mac", {
      description: "Auto-detect TV MAC address via ping+arp (same subnet required). Use when user asks to find or auto-detect the TV MAC address.",
      triggers: { ko: "MAC 자동 감지 arp ping 스캔" },
      params: {},
      returns: "{ mac }",
      handler: wrap(async () => ({ mac: await scanMac() })),
    });
    reg("discover", {
      description: "Scan the network for LG webOS TVs using SSDP. Returns a list of found TV IP addresses. Use when user asks to search or discover TVs on the network.",
      triggers: { ko: "LG TV 네트워크 탐색 발견 검색 SSDP" },
      params: { timeoutMs: { type: "number", description: "탐색 시간(ms, 기본 4000)" } },
      returns: "{ tvs }",
      handler: wrap(async (p) => ({ tvs: await discoverTvs(p.timeoutMs) })),
    });
    reg("find", {
      description: "Auto-discover LG TV on the network and save its IP and MAC address (SSDP then arp). Use when user asks to find and configure the TV automatically.",
      triggers: { ko: "TV 자동 찾기 발견 IP MAC 자동 설정" },
      params: {},
      returns: "{ ip, mac }",
      handler: wrap(async () => await autoFind()),
    });

    reg("power-on", {
      description: "Power on the LG TV — sends Wake-on-LAN if disconnected, then connects. Use when user asks to turn the TV on.",
      triggers: { ko: "TV 전원 켜기 켜 파워 온 WoL" },
      params: {},
      returns: "{ state }",
      handler: wrap(async () => {
        await actions.powerOn();
        return { state: client ? client.state : "disconnected" };
      }),
    });
    reg("power-off", {
      description: "Power off the LG TV completely — mutes audio then sends system turn-off (full shutdown, not sleep). Use when user asks to turn the TV off.",
      triggers: { ko: "TV 전원 끄기 꺼 파워 오프 종료" },
      params: {},
      returns: "{ ok }",
      danger: "destructive",
      handler: wrap(() => actions.powerOff()),
    });
    reg("screen-off", {
      description: "Turn off only the TV screen (standby mode — connection stays alive). Use when user asks to blank the screen or put it on standby without full shutdown.",
      triggers: { ko: "TV 화면 끄기 스탠바이 화면만 꺼" },
      params: {},
      returns: "{ ok }",
      danger: "destructive",
      handler: wrap(() => actions.screenOff()),
    });
    reg("screen-on", {
      description: "Turn on the TV screen (wake from standby). Use when user asks to turn the screen back on without full power cycle.",
      triggers: { ko: "TV 화면 켜기 스탠바이 해제" },
      params: {}, returns: "{ ok }", handler: wrap(() => actions.screenOn()),
    });

    reg("volume-up", {
      description: "Increase TV volume by one step. Use when user asks to turn volume up or raise the sound.",
      triggers: { ko: "볼륨 올리기 소리 크게 음량 증가" },
      params: {}, returns: "{ ok }", handler: wrap(() => actions.volumeUp()),
    });
    reg("volume-down", {
      description: "Decrease TV volume by one step. Use when user asks to turn volume down or lower the sound.",
      triggers: { ko: "볼륨 줄이기 소리 작게 음량 감소" },
      params: {}, returns: "{ ok }", handler: wrap(() => actions.volumeDown()),
    });
    reg("set-volume", {
      description: "Set TV volume to a specific level (0–100). Use when user gives an explicit volume number.",
      triggers: { ko: "볼륨 설정 음량 지정 몇으로" },
      params: { level: { type: "number", description: "0-100", required: true } },
      returns: "{ ok }",
      handler: wrap((p) => actions.setVolume(p.level)),
    });
    reg("mute", {
      description: "Mute or unmute the TV audio. Use when user asks to mute, silence, or unmute the TV sound.",
      triggers: { ko: "음소거 뮤트 소리 끄기 켜기" },
      params: { on: { type: "boolean", description: "true=음소거", required: true } },
      returns: "{ ok }",
      handler: wrap((p) => actions.mute(p.on)),
    });
    reg("channel-up", {
      description: "Switch to the next TV channel. Use when user asks to go to the next channel or channel up.",
      triggers: { ko: "채널 올리기 다음 채널 증가" },
      params: {}, returns: "{ ok }", handler: wrap(() => actions.channelUp()),
    });
    reg("channel-down", {
      description: "Switch to the previous TV channel. Use when user asks to go to the previous channel or channel down.",
      triggers: { ko: "채널 내리기 이전 채널 감소" },
      params: {}, returns: "{ ok }", handler: wrap(() => actions.channelDown()),
    });
    reg("open-channel", {
      description: "Open a specific TV channel by channel ID or number. Use when user asks to go to a particular channel.",
      triggers: { ko: "채널 번호 이동 채널 선택 열기" },
      params: { number: { type: "string", description: "채널 id/번호", required: true } },
      returns: "{ ok }",
      handler: wrap((p) => actions.openChannel(p.number)),
    });
    reg("inputs", {
      description: "List available external inputs on the TV (HDMI, AV, etc.). Use when user asks which inputs the TV has.",
      triggers: { ko: "TV 외부 입력 목록 HDMI 소스 리스트" },
      params: {}, returns: "{ ok, ... }", handler: wrap(() => actions.inputs()),
    });
    reg("switch-input", {
      description: "Switch the TV input source (e.g., to HDMI 1, HDMI 2). Use when user asks to change the TV input.",
      triggers: { ko: "입력 소스 전환 HDMI 변경 선택" },
      params: { id: { type: "string", description: "inputId", required: true } },
      returns: "{ ok }",
      handler: wrap((p) => actions.switchInput(p.id)),
    });

    reg("dpad", {
      description: "Press a directional pad key or OK on the TV remote. Use when user asks to navigate the TV UI (up/down/left/right/enter).",
      triggers: { ko: "방향키 위 아래 왼쪽 오른쪽 확인 OK 네비게이션" },
      params: { dir: { type: "string", description: "방향", enum: ["up", "down", "left", "right", "enter"], required: true } },
      returns: "{ ok }",
      handler: wrap((p) => actions.dpad(p.dir)),
    });
    reg("button", {
      description: "Press a named remote control button on the TV (e.g., HOME, BACK, MENU, GUIDE). Use when user asks to press a specific TV remote button.",
      triggers: { ko: "리모컨 버튼 HOME 홈 BACK 뒤로 MENU 메뉴" },
      params: { name: { type: "string", description: "버튼 이름", required: true } },
      returns: "{ ok }",
      handler: wrap((p) => actions.button(p.name)),
    });
    reg("media", {
      description: "Control TV media playback — play, pause, stop, fast-forward, or rewind. Use when user asks to play, pause, or control media on the TV.",
      triggers: { ko: "미디어 재생 일시정지 멈춤 빨리감기 되감기" },
      params: { action: { type: "string", description: "재생 제어", enum: ["play", "pause", "stop", "fastForward", "rewind"], required: true } },
      returns: "{ ok }",
      handler: wrap((p) => actions.media(p.action)),
    });
    reg("text-input", {
      description: "Type text into the TV's active input field (inserts or replaces). Use when user asks to type, search, or enter text on the TV.",
      triggers: { ko: "TV 텍스트 입력 타이핑 검색어 입력창" },
      params: { text: { type: "string", description: "입력 텍스트", required: true }, replace: { type: "boolean", description: "기존 대체" } },
      returns: "{ ok }",
      danger: "inject",
      handler: wrap((p) => actions.textInput(p.text, p.replace)),
    });
    reg("text-delete", {
      description: "Delete characters from the TV's active input field. Use when user asks to delete or backspace text on the TV.",
      triggers: { ko: "TV 텍스트 삭제 지우기 백스페이스" },
      params: { count: { type: "number", description: "삭제 개수", required: true } },
      returns: "{ ok }",
      danger: "inject",
      handler: wrap((p) => actions.textDelete(p.count)),
    });
    reg("text-enter", {
      description: "Send Enter key to the TV input field (confirm search or form). Use when user asks to press Enter or submit text on the TV.",
      triggers: { ko: "TV 엔터 입력 확인 검색 실행" },
      params: {}, returns: "{ ok }", danger: "inject", handler: wrap(() => actions.textEnter()),
    });
    reg("toast", {
      description: "Show a toast notification on the TV screen. Use when user asks to display a message or notification on the TV.",
      triggers: { ko: "TV 토스트 알림 메시지 표시" },
      params: { message: { type: "string", description: "메시지", required: true } },
      returns: "{ ok }",
      handler: wrap((p) => actions.toast(p.message)),
    });
    reg("apps", {
      description: "List installed apps on the LG TV. Use when user asks what apps are on the TV or wants to see the app list.",
      triggers: { ko: "TV 앱 목록 설치된 앱 리스트" },
      params: {}, returns: "{ ok, ... }", handler: wrap(() => actions.apps()),
    });
    reg("launch", {
      description: "Launch an app on the LG TV by app ID. Use when user asks to open or start a specific app on the TV.",
      triggers: { ko: "TV 앱 실행 열기 시작 앱 실행" },
      params: { id: { type: "string", description: "appId", required: true } },
      returns: "{ ok }",
      handler: wrap((p) => actions.launch(p.id)),
    });
    reg("foreground-app", {
      description: "Get the currently active (foreground) app on the LG TV. Use when user asks which app is currently open on the TV.",
      triggers: { ko: "TV 현재 앱 포그라운드 활성 앱 확인" },
      params: {}, returns: "{ ok, ... }", handler: wrap(() => actions.foregroundApp()),
    });

    reg("ws-probe", {
      description: "(Diagnostic) Test WebSocket register response from webview — verifies raw TV WebSocket connectivity without the core transport. Use for debugging connection issues.",
      params: { url: { type: "string", description: "ws://ip:3000 또는 wss://ip:3001", required: true } },
      returns: "{ opened, recv, sample, note }",
      handler: wrap(
        (p) =>
          new Promise((res) => {
            let opened = false;
            let recv = 0;
            let sample = "";
            let ws;
            try {
              ws = new WebSocket(p.url);
            } catch (e) {
              return res({ opened, recv, ctorError: String((e && e.message) || e) });
            }
            const t = setTimeout(() => {
              try {
                ws.close();
              } catch {
                /* noop */
              }
              res({ opened, recv, sample, note: "6s timeout" });
            }, 6000);
            ws.onopen = () => {
              opened = true;
              ws.send(JSON.stringify(buildRegisterPayload(undefined, makeId())));
            };
            ws.onmessage = (e) => {
              recv++;
              if (!sample) sample = String(e.data).slice(0, 120);
              clearTimeout(t);
              try {
                ws.close();
              } catch {
                /* noop */
              }
              res({ opened, recv, sample });
            };
            ws.onerror = (e) => {
              if (!opened) {
                clearTimeout(t);
                res({ opened, recv, error: String((e && e.message) || "error event") });
              }
            };
            ws.onclose = (e) => {
              if (!recv) {
                clearTimeout(t);
                res({ opened, recv, closeCode: e && e.code, closeReason: e && e.reason });
              }
            };
          }),
      ),
    });
    reg("ssap", {
      description: "(Diagnostic) Send an arbitrary SSAP URI request to the TV — for live testing and debugging. Ensures connection before sending.",
      triggers: { ko: "SSAP 직접 요청 진단 디버그" },
      params: {
        uri: { type: "string", description: "ssap:// URI", required: true },
        payload: { type: "object", description: "요청 payload(선택)" },
      },
      returns: "{ ok, result }",
      danger: "inject",
      handler: wrap(async (p) => ({ result: await req(p.uri, p.payload) })),
    });
    reg("dump-log", {
      description: "(Diagnostic) Dump the internal debug log — commands, SSAP calls, and state transitions. Use when debugging TV communication issues.",
      triggers: { ko: "디버그 로그 덤프 통신 기록 확인" },
      params: { lines: { type: "number", description: "끝에서 N 줄(기본 50)" } },
      returns: "{ entries }",
      handler: wrap((p) => ({ entries: log.tail(p.lines) })),
    });
    reg("show", {
      description: "Open the LG TV remote control panel UI. Use when user asks to show or open the TV remote.",
      triggers: { ko: "리모컨 열기 보이기 TV 패널" },
      params: {}, returns: "{ visible }", handler: wrap(() => ({ visible: setVisible(true) })),
    });
    reg("hide", {
      description: "Close the LG TV remote control panel UI. Use when user asks to hide or close the TV remote.",
      triggers: { ko: "리모컨 닫기 숨기기 TV 패널 닫기" },
      params: {}, returns: "{ visible }", handler: wrap(() => ({ visible: setVisible(false) })),
    });
    reg("minimize", {
      description: "Minimize the LG TV remote panel to the header icon. Use when user asks to minimize the remote.",
      triggers: { ko: "리모컨 최소화 아이콘 축소" },
      params: {}, returns: "{ minimized }", handler: wrap(() => ({ minimized: !setVisible(false) })),
    });
    reg("toggle", {
      description: "Toggle the LG TV remote panel open or closed. Use when user asks to toggle or switch the remote visibility.",
      triggers: { ko: "리모컨 토글 열기 닫기 전환" },
      params: {}, returns: "{ visible }", handler: wrap(() => ({ visible: setVisible(!isVisible()) })),
    });

    // ── 모달 UI(overlay:screen) ───────────────────────────────────────────────
    const el = (tag, cls, txt) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (txt != null) e.textContent = txt;
      return e;
    };
    const safe = (fn) => () => {
      Promise.resolve()
        .then(fn)
        .catch((e) => log.push("ui-err", e && e.message ? e.message : e));
    };
    // Material 아이콘 inline SVG(외부 폰트 0 — 원본 Material Symbols 충실 이식). 24dp path.
    const ICON = {
      home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
      power:
        "M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z",
      back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
      up: "M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z",
      down: "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z",
      left: "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z",
      right: "M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
      add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
      remove: "M19 13H5v-2h14v2z",
      mute: "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z",
      menu: "M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z",
      input:
        "M21 3.01H3c-1.1 0-2 .9-2 2V9h2V4.99h18v14.03H3V15H1v4.01c0 1.1.9 1.99 2 1.99h18c1.1 0 2-.9 2-1.99v-14c0-1.11-.9-2-2-2zM11 16l4-4-4-4v3H1v2h10v3z",
      play: "M8 5v14l11-7z",
      tv: "M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z",
    };
    const ico = (name, size = 22) =>
      `<svg class="lgtv-svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${ICON[name] || ""}"/></svg>`;
    // 노드 버튼 — data-node 부여(claude-gui 패턴). html=SVG/텍스트. ui.tree/ui.input.click 타깃.
    const node = (nodeId, html, onClick, cls) => {
      const b = el("button", "lgtv-btn" + (cls ? " " + cls : ""));
      b.innerHTML = html;
      b.dataset.node = nodeId;
      b.onclick = safe(onClick);
      return b;
    };

    function injectStyle() {
      const ID = "soksak-lgtv-style";
      if (document.getElementById(ID)) return;
      const s = el("style");
      s.id = ID;
      // 자체 .lgtv-* 클래스/변수만(호스트 크롬 토큰 미침범). 색은 테마 토큰 var() 상속(라이트/다크 자동).
      s.textContent = `
.lgtv-backdrop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;
  justify-content:center;background:rgba(0,0,0,.5);padding:14px;box-sizing:border-box;
  font:13px -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR",system-ui,sans-serif}
.lgtv-backdrop.lgtv-hidden{display:none}
.lgtv-modal{
  --surf:color-mix(in srgb, var(--fg,#e6e6e6) 6%, var(--bg,#0d1117));
  --surfhi:color-mix(in srgb, var(--fg,#e6e6e6) 12%, var(--bg,#0d1117));
  --neo:0 3px 5px -1px rgba(0,0,0,.35), 0 1px 3px -1px rgba(0,0,0,.25), inset 0 1px 0 0 rgba(255,255,255,.10);
  --neoa:inset 0 2px 4px 0 rgba(0,0,0,.5);
  --neoin:inset 0 2px 8px 0 rgba(0,0,0,.45);
  display:flex;flex-direction:column;align-items:center;gap:20px;box-sizing:border-box;
  width:300px;padding:18px 18px 22px;transform-origin:center center;
  transition:transform .14s cubic-bezier(.2,.8,.2,1);
  background:var(--bg,#0d1117);color:var(--fg,#e6e6e6);
  border:1px solid var(--bd,#3a3f4b);border-radius:24px}
.lgtv-head{display:flex;align-items:center;gap:7px;width:100%;flex:0 0 auto}
.lgtv-htitle{flex:1;display:flex;align-items:center;gap:5px;font-weight:700;font-size:11px;
  letter-spacing:.08em;text-transform:uppercase;color:var(--acc,#4a8fe8)}
.lgtv-dot{width:7px;height:7px;border-radius:50%;background:var(--bd,#666);flex:0 0 auto}
.lgtv-dot.on{background:#3fb950;box-shadow:0 0 5px rgba(63,185,80,.6)}
.lgtv-min{width:22px;height:22px;border:none;border-radius:50%;cursor:pointer;font-size:13px;
  line-height:1;background:var(--surfhi);color:var(--fg);box-shadow:var(--neo)}
.lgtv-min:active{box-shadow:var(--neoa);transform:scale(.95)}
.lgtv-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:100%;flex:0 0 auto}
.lgtv-cell{display:flex;flex-direction:column;align-items:center;gap:6px}
.lgtv-cap{font-size:8px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.55}
.lgtv-btn{border:none;cursor:pointer;padding:0;color:var(--fg,#e6e6e6);background:var(--surfhi);
  box-shadow:var(--neo);display:flex;align-items:center;justify-content:center;transition:transform .08s}
.lgtv-btn:active{box-shadow:var(--neoa);transform:scale(.95)}
.lgtv-circle{width:44px;height:44px;border-radius:50%}
.lgtv-sq{width:42px;height:42px;border-radius:13px}
.lgtv-on{color:#3fb950;background:color-mix(in srgb,#3fb950 22%,var(--surfhi))}
.lgtv-off{color:#ff6b6b;background:color-mix(in srgb,#ff6b6b 22%,var(--surfhi))}
.lgtv-dpad{position:relative;width:188px;height:188px;flex:0 0 auto}
.lgtv-dpad-ring{position:absolute;inset:0;border-radius:50%;background:var(--surf);box-shadow:var(--neoin)}
.lgtv-dpad .lgtv-btn{position:absolute;box-shadow:var(--neo)}
.lgtv-dpad .lgtv-btn:active{box-shadow:var(--neoa)}
.lgtv-du{left:50%;transform:translateX(-50%);top:6px;width:58px;height:52px;border-radius:9999px 9999px 14px 14px}
.lgtv-dd{left:50%;transform:translateX(-50%);bottom:6px;width:58px;height:52px;border-radius:14px 14px 9999px 9999px}
.lgtv-dl{top:50%;transform:translateY(-50%);left:6px;width:52px;height:58px;border-radius:9999px 14px 14px 9999px}
.lgtv-dr{top:50%;transform:translateY(-50%);right:6px;width:52px;height:58px;border-radius:14px 9999px 9999px 14px}
.lgtv-ok{top:50%;left:50%;transform:translate(-50%,-50%);width:66px;height:66px;border-radius:50%;
  font-weight:800;font-size:15px;background:var(--acc,#4a8fe8);color:var(--bg,#0d1117)}
.lgtv-ok:active{transform:translate(-50%,-50%) scale(.95)}
.lgtv-vc{display:grid;grid-template-columns:1fr 1fr;gap:14px;width:100%;flex:0 0 auto}
.lgtv-pad{display:flex;flex-direction:column;align-items:center;gap:11px;padding:12px 4px;
  border-radius:24px;background:var(--surf);box-shadow:var(--neoin)}
.lgtv-pad .lgtv-btn{width:46px;height:46px;border-radius:50%}
.lgtv-pad-lbl{font-size:9px;font-weight:800;letter-spacing:.2em;opacity:.55}
.lgtv-svg{display:block}
.lgtv-set{width:100%;display:flex;flex-direction:column;gap:8px;flex:0 0 auto}
.lgtv-in{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:11px;font:inherit;font-size:12px;
  border:1px solid var(--bd,#3a3f4b);background:var(--surf);color:var(--fg,#e6e6e6);box-shadow:var(--neoin)}
.lgtv-setrow{display:flex;gap:8px}
.lgtv-tbtn{flex:1;min-height:36px;border:none;border-radius:11px;cursor:pointer;font-size:11px;font-weight:700;
  background:var(--surfhi);color:var(--fg);box-shadow:var(--neo)}
.lgtv-tbtn:active{box-shadow:var(--neoa);transform:scale(.97)}
.lgtv-tbtn.acc{background:var(--acc,#4a8fe8);color:var(--bg,#0d1117)}
.lgtv-kb{width:100%;min-height:78px;border-radius:18px;flex:0 0 auto;cursor:text;outline:none;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;
  color:var(--fg,#e6e6e6);background:var(--surf);box-shadow:var(--neoin);border:1px solid var(--bd,#3a3f4b);
  opacity:.5;transition:opacity .2s,box-shadow .2s}
.lgtv-kb:focus{opacity:1;box-shadow:var(--neoin),inset 0 0 0 2px var(--acc,#4a8fe8)}
.lgtv-kb-t{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.8}`;
      document.head.appendChild(s);
      return s;
    }

    let backdrop = null;
    let modal = null;
    let dot = null;
    let ipIn = null;
    let macIn = null;

    function updateDot() {
      if (dot) dot.classList.toggle("on", !!client && client.state === "connected");
    }
    async function syncInputs() {
      if (!ipIn || !macIn) return;
      const { ip, mac } = await getCfg();
      if (document.activeElement !== ipIn) ipIn.value = ip;
      if (document.activeElement !== macIn) macIn.value = mac;
    }
    const isVisible = () => !!backdrop && !backdrop.classList.contains("lgtv-hidden");
    // 고정 디자인 크기(300px 폭)를 가용 공간(96vw/96vh)에 맞춰 비율 유지 축소. offsetW/H 는
    // transform 무관(레이아웃 크기)이라 scale 누적 없이 매번 정확. 작은 창에서도 종횡비 보존.
    // rAF 로 프레임당 1회만 계산(라이브 리사이즈 과호출 방지) + CSS transition 이 점프를 보간 → 부드러움.
    let fitRaf = 0;
    function fitModal() {
      if (fitRaf) return;
      fitRaf = requestAnimationFrame(() => {
        fitRaf = 0;
        if (!modal || !isVisible()) return;
        const natW = modal.offsetWidth;
        const natH = modal.offsetHeight;
        if (!natW || !natH) return;
        const s = Math.min(1, (window.innerWidth * 0.96) / natW, (window.innerHeight * 0.96) / natH);
        modal.style.transform = "scale(" + s + ")";
      });
    }
    // 뷰포트(documentElement) + 모달 내용 변화를 함께 감지(window resize 리스너보다 정석).
    // fitModal 은 transform 만 바꾸므로 content-box 불변 → 재트리거 루프 없음.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fitModal()) : null;
    // 오버레이 입력 게이트(멱등) — 표시 동안 콘텐츠 네이티브 webview(브라우저) 영역 위 클릭이 성립한다.
    let overlayGated = false;
    function setOverlayGate(on) {
      if (on === overlayGated) return;
      overlayGated = on;
      app.ui.setOverlayActive?.(on);
    }
    function setVisible(v) {
      if (!backdrop) return false;
      backdrop.classList.toggle("lgtv-hidden", !v);
      setOverlayGate(v);
      if (v) {
        syncInputs();
        fitModal();
        ensureConnected(); // 다시 열 때 끊겨 있으면 마지막 IP 로 재연결(fire-and-forget)
        startKeepalive(); // 열려 있는 동안 idle 끊김 예방
      } else {
        stopKeepalive(); // 닫으면 핑 멈춤
      }
      registerHeader(); // active 갱신
      return v;
    }
    // 타이틀바 우측 컨트롤 그룹 좌측에 리모컨 토글 아이콘(absolute FAB 대신 헤더에 순차 배치).
    // 같은 id 재등록 = active 갱신. 첫 dispose 만 subscriptions 에(deactivate 정리).
    let headerTracked = false;
    function registerHeader() {
      const d = app.ui.registerHeaderAction({
        id: "remote",
        label: "📺",
        title: "LG TV 리모컨",
        active: isVisible(),
        onClick: () => setVisible(!isVisible()),
      });
      if (!headerTracked) {
        ctx.subscriptions.push(d);
        headerTracked = true;
      }
    }

    // 아이콘 버튼 + 하단 라벨(원본 cell). shape = lgtv-circle | lgtv-sq.
    const cell = (nodeId, iconName, label, onClick, shape, extra) => {
      const c = el("div", "lgtv-cell");
      c.append(
        node(nodeId, ico(iconName), onClick, shape + (extra ? " " + extra : "")),
        el("span", "lgtv-cap", label),
      );
      return c;
    };

    function buildUi() {
      injectStyle();
      backdrop = el("div", "lgtv-backdrop lgtv-hidden");
      modal = el("div", "lgtv-modal");

      // 헤더: TV 아이콘 + 제목 + 상태 dot + 최소화
      const head = el("div", "lgtv-head");
      const htitle = el("span", "lgtv-htitle");
      htitle.innerHTML = ico("tv", 15) + "<span>LG TV</span>";
      dot = el("span", "lgtv-dot");
      const minBtn = el("button", "lgtv-min", "—");
      minBtn.dataset.node = "minimize";
      minBtn.title = "최소화";
      minBtn.onclick = safe(async () => setVisible(false));
      head.append(htitle, dot, minBtn);

      // 상단행: HOME / 전원 ON(초록) / OFF(빨강) / BACK
      const top = el("div", "lgtv-grid4");
      top.append(
        cell("btn/home", "home", "HOME", () => actions.button("HOME"), "lgtv-circle"),
        cell("power-on", "power", "ON", () => actions.powerOn(), "lgtv-circle", "lgtv-on"),
        cell("power-off", "power", "OFF", () => actions.powerOff(), "lgtv-circle", "lgtv-off"),
        cell("btn/back", "back", "BACK", () => actions.button("BACK"), "lgtv-circle"),
      );

      // D-pad: 원형 recessed 링 + 곡선 방향키 + 중앙 OK
      const dpad = el("div", "lgtv-dpad");
      dpad.append(
        el("div", "lgtv-dpad-ring"),
        node("dpad/up", ico("up"), () => actions.dpad("up"), "lgtv-du"),
        node("dpad/down", ico("down"), () => actions.dpad("down"), "lgtv-dd"),
        node("dpad/left", ico("left"), () => actions.dpad("left"), "lgtv-dl"),
        node("dpad/right", ico("right"), () => actions.dpad("right"), "lgtv-dr"),
        node("dpad/enter", "OK", () => actions.dpad("enter"), "lgtv-ok"),
      );

      // VOL / CH 패널(둘레진 recessed)
      const vc = el("div", "lgtv-vc");
      const volPad = el("div", "lgtv-pad");
      volPad.append(
        node("vol-up", ico("add"), () => actions.volumeUp()),
        el("span", "lgtv-pad-lbl", "VOL"),
        node("vol-down", ico("remove"), () => actions.volumeDown()),
      );
      const chPad = el("div", "lgtv-pad");
      chPad.append(
        node("ch-up", ico("up"), () => actions.channelUp()),
        el("span", "lgtv-pad-lbl", "CH"),
        node("ch-down", ico("down"), () => actions.channelDown()),
      );
      vc.append(volPad, chPad);

      // 보조행: MUTE / MENU / INPUT / PLAY
      const aux = el("div", "lgtv-grid4");
      aux.append(
        cell("mute", "mute", "MUTE", () => actions.mute(true), "lgtv-sq"),
        cell("btn/menu", "menu", "MENU", () => actions.button("MENU"), "lgtv-sq"),
        cell("input", "input", "INPUT", () => actions.inputs(), "lgtv-sq"),
        cell("media/play", "play", "PLAY", () => actions.media("play"), "lgtv-sq"),
      );

      // 설정: IP / MAC 입력 + 자동탐색/연결
      ipIn = el("input", "lgtv-in");
      ipIn.placeholder = "TV IP (예: 192.168.0.10)";
      ipIn.dataset.node = "settings-ip";
      ipIn.oninput = safe(() => storage.write("tvIp", ipIn.value.trim()));
      macIn = el("input", "lgtv-in");
      macIn.placeholder = "TV MAC (예: aa:bb:cc:dd:ee:ff)";
      macIn.dataset.node = "settings-mac";
      macIn.oninput = safe(() => storage.write("tvMac", macIn.value.trim()));
      const set = el("div", "lgtv-set");
      const setRow = el("div", "lgtv-setrow");
      const scanBtn = el("button", "lgtv-tbtn", "TV 찾기");
      scanBtn.dataset.node = "scan";
      scanBtn.onclick = safe(() => autoFind().then(syncInputs));
      const connBtn = el("button", "lgtv-tbtn acc", "연결");
      connBtn.dataset.node = "connect";
      connBtn.onclick = safe(() => actions.connect());
      setRow.append(scanBtn, connBtn);
      set.append(ipIn, macIn, setRow);

      // 네비 단축키 영역 — 포커스 후 물리키를 리모컨 동작으로(방향/볼륨/채널/재생/음소거/뒤로/HOME).
      // 매핑은 mapRemoteKey(단일 진실 — 단위테스트와 공유). 텍스트 입력은 아래 검색칸이 담당.
      // [주의] 매핑된 물리키는 임의 선택일 뿐 — TV 가 실제 반응하는지는 SSAP 동작 자체에 달림(실측 대상).
      const kb = el("div", "lgtv-kb");
      kb.tabIndex = 0;
      kb.dataset.node = "keyboard";
      kb.innerHTML =
        ico("input", 22) +
        '<span class="lgtv-kb-t">리모컨 키 (클릭 후 ←↑↓→ · Enter · [ ] 볼륨 · PgUp/Dn 채널)</span>';
      const kbSend = (p) => Promise.resolve(p).catch((e) => log.push("kb-err", e && e.message ? e.message : e));
      let muted = false; // m 토글(로컬) — TV 상태 쿼리 없이 번갈아 on/off
      let playing = true; // space 토글(로컬) — play ↔ pause
      function dispatchRemoteKey(a) {
        switch (a.type) {
          case "dpad": return kbSend(actions.dpad(a.dir));
          case "ok": return kbSend(actions.dpad("enter"));
          case "back": return kbSend(actions.button("BACK"));
          case "home": return kbSend(actions.button("HOME"));
          case "volume": return kbSend(a.dir === "up" ? actions.volumeUp() : actions.volumeDown());
          case "channel": return kbSend(a.dir === "up" ? actions.channelUp() : actions.channelDown());
          case "playpause":
            playing = !playing;
            return kbSend(actions.media(playing ? "play" : "pause"));
          case "mute":
            muted = !muted;
            return kbSend(actions.mute(muted));
        }
      }
      kb.onkeydown = (e) => {
        const a = mapRemoteKey(e.key);
        if (!a) return; // 미매핑(문자·Tab 등)은 기본 동작 유지
        e.preventDefault();
        dispatchRemoteKey(a);
      };

      // 검색/텍스트 입력칸 — 타이핑하면 TV 입력창 전체를 현재 값으로 미러(insertText replace).
      // 한글 조합은 compositionend 에 완성 문자열 반영. 삭제도 값 변화로 함께 반영. Enter=검색 실행.
      const search = el("input", "lgtv-in");
      search.placeholder = "TV 검색/텍스트 (여기 타이핑 → TV 입력창)";
      search.dataset.node = "search";
      search.autocomplete = "off";
      search.autocapitalize = "off";
      search.spellcheck = false;
      const pushText = () => kbSend(actions.textInput(search.value, true));
      search.oninput = (e) => {
        if (!e.isComposing) pushText(); // 조합 중(한글)엔 보류 → compositionend 에서 한 번
      };
      search.addEventListener("compositionend", () => pushText());
      search.onkeydown = (e) => {
        e.stopPropagation(); // 네비 단축키 영역과 분리 — 여기선 글자가 그대로 입력돼야 함
        if (e.key === "Enter") {
          e.preventDefault();
          kbSend(actions.textEnter());
          search.value = "";
        }
      };

      modal.append(head, top, dpad, vc, aux, kb, search, set);
      backdrop.append(modal);
      // backdrop 빈 영역 클릭 = 최소화.
      backdrop.onclick = (e) => {
        if (e.target === backdrop) setVisible(false);
      };

      document.body.append(backdrop);
      ro?.observe(document.documentElement); // 뷰포트 변화
      ro?.observe(modal); // 모달 내용 변화(키보드/설정 등) — 둘 다 비율 재맞춤
      registerHeader(); // 타이틀바 아이콘 등록(헤더 컨트롤 그룹 좌측)
      syncInputs();
      updateDot();
    }

    buildUi();
    _ui = {
      destroy() {
        ro?.disconnect();
        if (fitRaf) cancelAnimationFrame(fitRaf);
        stopKeepalive();
        setOverlayGate(false);
        backdrop?.remove();
        document.getElementById("soksak-lgtv-style")?.remove();
        client?.close();
        client = null;
      },
    };
  },

  deactivate() {
    try {
      _ui?.destroy();
    } catch {
      /* noop */
    }
    _ui = null;
  },
};
