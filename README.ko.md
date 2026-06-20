# soksak-plugin-lgtv-remote

LG webOS TV 리모컨. 전원/볼륨/채널/방향키/입력/미디어/키보드를 모달 오버레이와 CLI/MCP 명령으로 조작한다.

- 제어 채널·방향키 입력: SSAP WebSocket(`ws://<ip>:3000`) 직결
- Wake-on-LAN: 코어 범용 `net.udp.send` 명령(UDP 매직패킷)
- 설정·client-key: 플러그인 storage

원본 포팅 출처: [cmer/lg-tv-control-macos](https://github.com/cmer/lg-tv-control-macos) (Wails+Go).

## 사용

1. 설정 — TV IP/MAC을 넣는다.
   - `sok plugin.soksak-plugin-lgtv-remote.set-ip '{"ip":"192.168.0.10"}'`
   - `sok plugin.soksak-plugin-lgtv-remote.set-mac '{"mac":"aa:bb:cc:dd:ee:ff"}'` 또는
   - `sok plugin.soksak-plugin-lgtv-remote.scan-mac` (같은 서브넷에서 ping+arp로 자동 획득)
2. 연결 — `...connect` (첫 연결 시 TV 화면의 페어링 프롬프트 수락. client-key는 저장되어 재사용)
3. 조작 — 모달(우측 상단 📺 아이콘 토글) 또는 명령으로.

## 동작 메모

- 전원 ON(`power-on`): 연결돼 있으면 화면만 켜고, 미연결이면 WoL 송신 후 자동 재연결.
- 전원 OFF(`power-off`): 소리(setMute)와 전원(turnOff)까지 완전 종료. 화면만 끄려면 `screen-off`.
- 재연결: 연결 종료(onclose) 이벤트 기반 + 조작 직전 보장(`ensureConnected`) + 모달을 다시 열 때 재연결. 화면만 끈 상태(ScreenOff)에서는 자동 재연결하지 않는다.
- keepalive: 모달이 열려 있는 동안 30초마다 가벼운 read(`getPowerState`)로 idle 끊김을 예방하고, 끊겨 있으면 재연결한다. 닫으면 멈춘다.

## 키보드 입력

키보드는 두 영역으로 나뉜다.

- 네비 단축키 영역(클릭 후 물리키): `←↑↓→`=방향, `Enter`=OK, `Backspace`·`Escape`=뒤로(BACK), `[`·`-`·`_`=볼륨-, `]`·`+`·`=`=볼륨+, `PageUp`/`PageDown`=채널, `Space`=재생/일시정지, `m`=음소거, `h`=HOME. 매핑은 `mapRemoteKey`(단일 진실). 매핑된 동작은 명세 SSAP 호출이라 물리키 선택과 무관하게 동작한다.
- 검색/텍스트 입력칸: 타이핑하면 `insertText`(replace)로 TV 입력창 전체를 미러한다(한글 조합은 compositionend 반영). `registerRemoteKeyboard` 구독으로 TV 입력 포커스(`currentWidget.focus`)를 추적해, 입력 가능할 때만 초록으로 활성화한다.

[제약] webOS `insertText`는 시스템 IME를 쓰는 입력창(통합 검색·설정 검색·브라우저 주소창 등, 입력 포커스 활성 시)에서만 동작한다. 유튜브·넷플릭스 등 자체 OSK를 그리는 앱은 직접 텍스트 입력이 불가하며(물리 무선 키보드도 동일), dpad로 화면 키보드를 선택해야 한다. 검색칸은 focus 미감지 시 이 한계를 안내한다.

## 마우스 포인터(매직 리모컨)

D-pad 헤더의 포인터 토글을 켜면 D-pad 영역이 트랙패드가 된다(높이는 원과 같고 좌우는 모달 폭 full 사각형, 내부 방향키는 중앙 고정·비활성). 마우스의 네모 내 위치(0~1)를 TV 화면 절대 위치(×1920x1080)로 매핑해 SSAP pointer socket(`type:move`)으로 보낸다 — 네모 구석 = TV 구석. move 는 상대뿐이라 추정 커서와의 차이를 보낸다. 클릭=선택(`type:click`). CLI/MCP 로는 `pointer-move {dx,dy}` · `pointer-click`.

[실측] webOS 는 큰 `dx` 점프를 무시하고 작은 스텝 연속만 커서를 움직인다. 그래서 목표 위치까지의 차이를 작은 스텝(≤12px)으로 쪼개 16ms 간격으로 흘려보낸다(부드러움). 포인터 커서는 텍스트 입력과 같은 앱 의존 — 홈·LG채널·브라우저 등에서는 동작하나 유튜브 leanback 등 자체 네비 앱은 커서를 띄우지 않는다.

## UI

모달 오버레이(`ui:overlay:screen`). 최소화하면 우측 상단 아이콘으로 접히고 아이콘 토글로 다시 연다. 모달 폭은 종횡비를 유지하며 뷰포트에 맞춰 스케일된다. 색은 테마 토큰을 상속해 라이트/다크 모두 적응한다. 모든 버튼은 `data-node`로 노출되어 `ui.tree`/`ui.input.click`으로 조작·검증할 수 있다.

## 명령

연결: `connect` `disconnect` `status` `set-ip` `set-mac` `scan-mac`
전원: `power-on` `power-off` `screen-off` `screen-on`
볼륨/채널/입력: `volume-up` `volume-down` `set-volume` `mute` `channel-up` `channel-down` `open-channel` `inputs` `switch-input`
입력/미디어: `dpad` `button` `pointer-move` `pointer-click` `media` `text-input` `text-delete` `text-enter`
앱/알림: `apps` `launch` `foreground-app` `toast`
UI/디버그: `show` `hide` `toggle` `minimize` `dump-log` `ws-probe` `ssap`

전체 스키마는 `sok commands` 또는 `sok plugin.soksak-plugin-lgtv-remote.<name>` 참고.

## 테스트

- 단위(순수 로직·transport 계약·키 매핑·구독, 네트워크 0): `node --test`
- E2E(실 앱 + DOM 노출/명령 무크래시/WoL 송신): `SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/lgtv.mjs` (`make dev` 실행 중)
- 실 TV 실측(수동): `node e2e/probe-livetv.mjs`(SSAP 동작을 read 전후 비교로 자동 판정), `node e2e/probe-text.mjs`(`registerRemoteKeyboard` 구독으로 입력 포커스 감지 + `insertText` 검증). 둘 다 `SOKSAK_SOCKET` 지정, TV 켜짐·IP 설정 전제.
- 통신(SSAP) 실측은 `dump-log`로 명령/SSAP/상태전이/IME focus 를 확인한다.
