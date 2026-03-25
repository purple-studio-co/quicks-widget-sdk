# @quicks/widget-sdk

SDK for building remote widgets (plugins) for quicks3 workspace.

A remote widget is an external web app embedded into a quicks3 card via iframe. The protocol is inspired by Telegram Mini Apps.

## Architecture

```
quicks3 frontend (3.quicks.ai)
  |-- RemoteWidgetCard
  |     \-- <iframe src="{remote_url}/embed">         # main widget UI
  |
  \-- WidgetControlsPanel (bottom bar, on card focus)
        \-- <iframe src="{remote_url}/embed/controls"> # compact toolbar (optional)
```

## Install

```bash
bun add @quicks/widget-sdk
```

## Quick Start (React)

```tsx
import { useEmbed, saveState } from "@quicks/widget-sdk/react";

function MyWidget() {
  const { initData, theme, token } = useEmbed({
    onStateUpdate: (msg) => {
      // agent or another user updated the card content
    },
  });

  if (!initData) return <div>Loading...</div>;

  return <div>Card: {initData.cardId}</div>;
}
```

`useEmbed` handles the full lifecycle:
1. Reads URL params (`token`, `theme`)
2. Sends `widget:ready` to the host
3. Waits for `widget:init` with card data
4. Handles `widget:theme` changes (toggles `.dark` class on `<html>`)
5. Cleans up on unmount

## Quick Start (Vanilla)

```typescript
import {
  signalReady, onHostMessage, saveState,
  getEmbedParams, parseCollabUrl,
  type InitData,
} from "@quicks/widget-sdk";

const { token, theme } = getEmbedParams();

signalReady();

onHostMessage((msg) => {
  if (msg.type === "widget:init") {
    const data = msg.data as InitData;
    // render with data
  }
  if (msg.type === "widget:theme") {
    // switch theme
  }
});
```

## API Reference

### Types

```typescript
type WidgetMessage = { type: string; data?: Record<string, unknown> }

type InitData = {
  cardId: string
  pagePath: string
  status: string              // "empty" | "processing" | "done" | "error"
  data: Record<string, string>
  textData: Record<string, string>
  readOnly: boolean
  theme: "light" | "dark"
  collabUrl?: string          // Yjs WebSocket URL (for collaborative widgets)
}

type EmbedParams = {
  token: string
  theme: "light" | "dark"
  hostOrigin: string | null
}

type CollabConnection = {
  serverUrl: string
  roomName: string
  params: Record<string, string>
}
```

### Widget -> Host

| Function | Message type | Description |
|----------|-------------|-------------|
| `signalReady()` | `widget:ready` | Widget loaded and ready |
| `signalError(code, message)` | `widget:error` | Error (auth_failed, ws_error, init_error) |
| `saveState({ data?, textData? })` | `widget:save-state` | Save state (host debounces 300ms -> API) |
| `runHook(hookName, results?)` | `widget:run-hook` | Trigger a hook (onComplete, etc.) |
| `requestState()` | `widget:request-state` | Request host to re-send `widget:init` |
| `requestToken()` | `widget:request-token` | Request a fresh JWT token |
| `postToHost(msg)` | any | Send an arbitrary message to the host |

### Host -> Widget

Listen with `onHostMessage(handler)` (returns an unsubscribe function):

| Message type | Data | Description |
|-------------|------|-------------|
| `widget:init` | `InitData` | Full card state (sent after `widget:ready`) |
| `widget:state-updated` | `{ status, data, textData }` | External update (agent, another user) |
| `widget:theme` | `{ theme }` | Theme changed |
| `widget:fullscreen` | `{ active }` | Fullscreen enter/exit |
| `widget:token` | `{ token }` | Refreshed JWT |

### Helpers

| Function | Description |
|----------|-------------|
| `getEmbedParams()` | Parse URL params: `token`, `theme`, `hostOrigin` |
| `parseCollabUrl(url)` | Split `collabUrl` into `{ serverUrl, roomName, params }` for y-websocket |
| `addAllowedOrigin(origin)` | Add a custom allowed origin for postMessage |
| `setHostOrigin(origin)` | Lock host origin after receiving a valid message |

### React Hook

```typescript
import { useEmbed } from "@quicks/widget-sdk/react";

const { initData, theme, token } = useEmbed({
  onStateUpdate: (msg) => { /* widget:state-updated */ },
});
```

Re-exports from `@quicks/widget-sdk/react`: `saveState`, `signalError`, `runHook`, `requestState`, `requestToken`, `parseCollabUrl`.

## Endpoints

Your widget must serve these routes:

### `/embed` — Main widget

Full widget UI without standalone shell (no navigation, header, tabs).

### `/embed/controls` — Control panel (optional)

Compact horizontal strip, **200x40px** (pill shape). Appears in the bottom bar when the card is focused. Icons only, no text labels.

The iframe has `overflow: visible` — popup menus (color picker, shape selector, etc.) can extend above the 40px boundary.

### `/widget.json` — Widget schema

JSON describing the widget (name, icon, data fields, hooks, size, collab). The quicks3 backend fetches this file and merges it with the local toml config.

### URL params (both embed endpoints)

| Param | Description |
|-------|-------------|
| `token` | JWT access token (HS256, shared `JWT_SECRET`) |
| `theme` | `light` \| `dark` (default: `light`) |

Card data is **not** passed via URL params — it arrives through `widget:init` postMessage.

## Lifecycle

### `/embed`

```
1. Host creates <iframe src="{remote_url}/embed?token=...&theme=light">
2. Widget loads
3. Widget -> widget:ready
4. Host -> widget:init { cardId, pagePath, status, data, textData, collabUrl? }
5. Widget renders with full state
6. User interacts
7. Widget -> widget:save-state { data, textData }
8. Host debounces 300ms -> PUT /api/cards/update
9. On completion -> widget:run-hook { hookName: "onComplete", results }
```

Timeout: 15 seconds for `widget:ready`, then "Widget did not respond" error.

### `/embed/controls`

```
1. Host creates <iframe src="{remote_url}/embed/controls?token=...&theme=light">
2. Controls loads
3. Controls -> widget:ready
4. Controls renders toolbar immediately (does NOT wait for widget:init)
5. Syncs with embed iframe via BroadcastChannel
```

The host does **not** send `widget:init` to the controls iframe. Controls gets card data and tool state from the embed iframe via BroadcastChannel (same-origin).

## State Persistence

### Reading

State arrives via `widget:init`:
- `data` — string fields from card.toml `[data]`
- `textData` — contents of .md/.json files
- `status` — `"empty"` | `"processing"` | `"done"` | `"error"`

### Writing

```typescript
saveState({
  data: { sessions_completed: "5" },
  textData: { history: JSON.stringify(sessions) },
});
```

Host debounces (300ms) then calls the API. Only `editable: true` fields are persisted.

### Export (SVG, HTML, etc.)

Widgets with collab store state in binary Yjs format (`.yjs`). For preview, search, and sharing, export a human-readable format. Use `ext` in the field definition for a custom file extension:

```json
{ "svg": { "type": "text", "ext": ".svg", "editable": true } }
```

Export on Yjs doc changes with debounce:

```typescript
ydoc.on("update", () => {
  clearTimeout(exportTimer);
  exportTimer = setTimeout(async () => {
    const svg = await editor.getSvgString(editor.getCurrentPageShapeIds());
    if (svg) {
      saveState({ textData: { svg: svg.svg } });
    }
  }, 3000);
});
```

### Bidirectional State

An agent (or server code) can write new content to card textData fields. The widget **must** handle `widget:state-updated` and apply new data:

```typescript
const { initData } = useEmbed({
  onStateUpdate: (msg) => {
    const { textData } = msg.data as { textData: Record<string, string> };
    if (textData?.svg) {
      editor.selectAll().deleteShapes(editor.getSelectedShapeIds());
      editor.putExternalContent({ type: "svg-text", text: textData.svg });
    }
  },
});
```

Echo suppression: the host suppresses `widget:state-updated` for 1.5s after a `widget:save-state` from the same widget, so the widget won't get its own writes echoed back.

## Yjs Collab

quicks3 provides a universal Yjs WebSocket endpoint. The widget does **not** need its own Yjs server.

### Connecting

The `collabUrl` arrives in `widget:init`:

```
wss://api-3.quicks.ai/ws/collab/{pagePath}/{cardId}/{field}?token=JWT
```

Use `parseCollabUrl` to split it for y-websocket:

```typescript
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { parseCollabUrl } from "@quicks/widget-sdk";

const collab = parseCollabUrl(initData.collabUrl!);
if (!collab) throw new Error("Invalid collabUrl");

const ydoc = new Y.Doc();
const provider = new WebsocketProvider(collab.serverUrl, collab.roomName, ydoc, {
  params: collab.params,
});
```

### Persist formats

| Format | Server persist | File ext | Use case |
|--------|---------------|----------|----------|
| `markdown` | Y.XmlFragment -> markdown | `.md` | Text editors (Notes, Tiptap) |
| `yjs` | Binary snapshot | `.yjs` | Canvas, diagrams, arbitrary structures |

Format is specified in `widget.json` -> `collab.format`.

## Sync Between Embed and Controls

Two iframes of the same origin use `BroadcastChannel` for direct sync. Controls does not connect to Yjs — it's UI-only for tool state.

```typescript
const channel = new BroadcastChannel("my-widget");

channel.postMessage({ type: "sync", tool: "draw", color: "#000", strokeSize: "s" });

channel.onmessage = (e) => {
  if (e.data.type === "sync") applyToolState(e.data);
};
```

## widget.json Schema

Place at `public/widget.json`. Served by Vite from `public/`.

```json
{
  "name": "My Widget",
  "icon": "widget-icon.png",
  "prompt": "Description for AI agent context.",
  "controls_path": "/embed/controls",

  "data": {
    "room_id": { "name": "Room ID", "type": "string" },
    "score": { "name": "Score", "type": "string", "editable": true },
    "config": { "name": "Config", "type": "json", "editable": true }
  },

  "collab": {
    "enabled": true,
    "field": "content",
    "format": "yjs"
  },

  "hooks": {
    "onCreate": "Generate initial content...",
    "onComplete": { "mode": "client" }
  },

  "size": {
    "min_w": 1, "min_h": 1,
    "max_w": 2, "max_h": 3,
    "fill_height": true,
    "allow_fullscreen": true
  }
}
```

### Hook modes

| Mode | Description |
|------|-------------|
| `agent` | AI agent executes the prompt (default quicks3 mode) |
| `webhook` | HTTP POST to `{remote_url}{url}` — widget server handles |
| `client` | Widget handles in-browser, sends `widget:run-hook` + `widget:save-state` |

A string value is shorthand for `{ mode: "agent", prompt: "..." }`.

### Local override (quicks3)

Minimal toml in `workspace/content/widgets/{name}.toml`:

```toml
render = "remote"
remote_url = "https://my-widget.example.com"
```

All fields from `widget.json` are fetched automatically. Non-empty local fields override remote ones.

## Project Structure

```
my-widget/
├── public/
│   └── widget.json         # Schema — fetched by quicks3
├── embed.html              # Entry point for /embed
├── controls.html           # Entry point for /embed/controls (optional)
├── src/
│   ├── embed.tsx           # Main UI
│   ├── controls.tsx        # Control panel (optional)
│   └── bridge.ts           # Sync between iframes (BroadcastChannel)
├── vite.config.ts          # MPA build + URL routing
├── package.json
└── tsconfig.json
```

### Vite config

```typescript
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function embedRoutes(): Plugin {
  return {
    name: "embed-routes",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url?.split("?")[0];
        if (url === "/embed" || url === "/embed/") req.url = "/embed.html";
        else if (url === "/embed/controls" || url === "/embed/controls/")
          req.url = "/controls.html";
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), embedRoutes()],
  build: {
    rollupOptions: {
      input: {
        embed: "embed.html",
        controls: "controls.html",
      },
    },
  },
});
```

## Security

- Origin validation: never `*`, always a specific origin
- Only `editable: true` fields are persisted via `widget:save-state`
- Do not use localStorage / cookies in embed mode (Safari ITP)
- JWT token is short-lived, passed via URL param
- `sandbox="allow-scripts allow-same-origin"` on the iframe

## Performance

### Cache headers (required)

Vite adds content hashes to filenames (`index-YOgzbeKW.js`) — files are immutable.

| Path | Cache-Control | Why |
|------|---------------|-----|
| `/assets/*` | `public, max-age=31536000, immutable` | Hashed filename = cache forever |
| `/embed`, `/embed/controls` | `no-cache` | HTML may reference new asset hashes |
| `/widget.json` | `public, max-age=3600` | Changes rarely |

## New Widget Checklist

- [ ] `bun add @quicks/widget-sdk`
- [ ] `public/widget.json` with full schema
- [ ] `/embed` endpoint — main UI (use `useEmbed` from SDK)
- [ ] `/embed/controls` endpoint (optional, 200x40, popup overflow up)
- [ ] `saveState()` on changes (if there are editable fields)
- [ ] Handle `widget:fullscreen` (theme is handled by `useEmbed`)
- [ ] No localStorage / cookies
- [ ] Local toml: `render = "remote"` + `remote_url`
- [ ] Build: `bun run build` -> static dist

### For collaborative widgets (additional)

- [ ] `collab` section in widget.json
- [ ] `parseCollabUrl(initData.collabUrl)` -> connect via y-websocket
- [ ] Correct Yjs type (XmlFragment for markdown, binary for yjs, Map for json)

### Deploy

- Static hosting (Cloudflare Pages, GitHub Pages, Vercel) — the widget doesn't need its own server
- If using webhook hooks — a server is needed for handling them
