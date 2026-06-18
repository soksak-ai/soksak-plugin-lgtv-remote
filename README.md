# soksak-plugin-lgtv-remote

LG webOS TV remote. Controls power, volume, channels, directional keys, input sources, media, and keyboard via a modal overlay and CLI/MCP commands.

- Control channel and directional input: SSAP WebSocket (`ws://<ip>:3000`) direct connection
- Wake-on-LAN: core generic `net.udp.send` command (UDP magic packet)
- Settings and client-key: plugin storage

Original port source: [cmer/lg-tv-control-macos](https://github.com/cmer/lg-tv-control-macos) (Wails+Go).

## Usage

1. Configure — enter the TV IP/MAC.
   - `sok plugin.soksak-plugin-lgtv-remote.set-ip '{"ip":"192.168.0.10"}'`
   - `sok plugin.soksak-plugin-lgtv-remote.set-mac '{"mac":"aa:bb:cc:dd:ee:ff"}'` or
   - `sok plugin.soksak-plugin-lgtv-remote.scan-mac` (auto-acquire via ping+arp on the same subnet)
2. Connect — `...connect` (accept the pairing prompt on the TV screen on first connection; client-key is saved for reuse)
3. Control — via the modal (toggle the 📺 icon in the top-right corner) or commands.

## Behavior Notes

- Power ON (`power-on`): if connected, turns the screen on; if not connected, sends WoL then auto-reconnects.
- Power OFF (`power-off`): full shutdown including audio (setMute) and power (turnOff). Use `screen-off` to turn off only the screen.
- Reconnect: event-based on connection close (onclose) + guaranteed before each operation (`ensureConnected`) + reconnects when the modal is reopened. Does not auto-reconnect when the screen is off (ScreenOff state).
- Keepalive: while the modal is open, sends a lightweight read (`getPowerState`) every 30 seconds to prevent idle disconnection; reconnects if disconnected. Stops when the modal is closed.

## Keyboard Input

The keyboard is split into two areas.

- Navigation shortcut area (physical keys after clicking): `←↑↓→` = directional, `Enter` = OK, `Backspace` / `Escape` = back (BACK), `[` / `-` / `_` = volume−, `]` / `+` / `=` = volume+, `PageUp`/`PageDown` = channel, `Space` = play/pause, `m` = mute, `h` = HOME. Mappings defined in `mapRemoteKey` (single source of truth). Mapped actions invoke the specified SSAP calls regardless of physical key choice.
- Search/text input field: typing sends the full TV input field content via `insertText` (replace) and mirrors it (Korean composition applied on `compositionend`). Subscribes to `registerRemoteKeyboard` to track TV input focus (`currentWidget.focus`), activating with a green indicator only when input is possible.

[Limitation] webOS `insertText` only works in input fields that use the system IME (integrated search, settings search, browser address bar, etc., when input focus is active). Apps with their own on-screen keyboard (YouTube, Netflix, etc.) do not support direct text input (same applies to physical wireless keyboards) — use the d-pad to select keys on the on-screen keyboard. The search field displays this limitation when focus is not detected.

## Mouse Pointer (Magic Remote)

Enabling the pointer toggle in the D-pad header turns the D-pad area into a trackpad (same height as the circle, full modal width as a rectangle; inner directional keys are centered and inactive). Maps the mouse position within the rectangle (0–1) to an absolute TV screen position (×1920×1080) and sends it via the SSAP pointer socket (`type:move`) — rectangle corner = TV corner. Since `move` is relative-only, it sends the delta from the estimated cursor position. Click = select (`type:click`). CLI/MCP: `pointer-move {dx,dy}` · `pointer-click`.

[Observed] webOS ignores large `dx` jumps and only moves the cursor with small consecutive steps. Therefore, the delta to the target is split into small steps (≤12px) sent at 16ms intervals (smooth movement). The pointer cursor is app-dependent — works in Home, LG Channels, and the browser, but apps with their own navigation (YouTube leanback, etc.) do not show a cursor.

## UI

Modal overlay (`ui:overlay:screen`). Minimizing collapses it to an icon in the top-right corner; toggling the icon reopens it. Modal width scales to the viewport while maintaining aspect ratio. Colors inherit theme tokens and adapt to both light and dark themes. All buttons are exposed via `data-node` and can be operated and verified via `ui.tree` / `ui.input.click`.

## Commands

Connection: `connect` `disconnect` `status` `set-ip` `set-mac` `scan-mac`
Power: `power-on` `power-off` `screen-off` `screen-on`
Volume/Channel/Input: `volume-up` `volume-down` `set-volume` `mute` `channel-up` `channel-down` `open-channel` `inputs` `switch-input`
Input/Media: `dpad` `button` `pointer-move` `pointer-click` `media` `text-input` `text-delete` `text-enter`
App/Notification: `apps` `launch` `foreground-app` `toast`
UI/Debug: `show` `hide` `toggle` `minimize` `dump-log` `ws-probe` `ssap`

For full schema, see `sok commands` or `sok plugin.soksak-plugin-lgtv-remote.<name>`.

## Tests

- Unit (pure logic · transport contract · key mapping · subscriptions, zero network): `node --test`
- E2E (live app + DOM exposure/command no-crash/WoL send): `SOKSAK_SOCKET=~/.soksak/com.soksak.dev.sock node e2e/lgtv.mjs` (requires `make dev` running)
- Live TV probing (manual): `node e2e/probe-livetv.mjs` (auto-asserts SSAP operations via before/after read comparison), `node e2e/probe-text.mjs` (detects input focus via `registerRemoteKeyboard` subscription + verifies `insertText`). Both require `SOKSAK_SOCKET`, TV powered on, and IP configured.
- Communication (SSAP) live probing: use `dump-log` to inspect commands / SSAP / state transitions / IME focus.
