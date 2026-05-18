/** Quicks RemoteWidget postMessage protocol */

export type WidgetMessage = { type: string; data?: Record<string, unknown> }

export type InitData = {
  cardId: string
  pagePath: string
  /** Widget type id (e.g. "smart-homework") — used for KV/AI usage tagging. */
  widgetType: string
  status: string
  data: Record<string, string>
  textData: Record<string, string>
  readOnly: boolean
  theme: "light" | "dark"
  collabUrl?: string
  /** Current authenticated user info (for collab cursors, attribution) */
  user?: { name: string; email?: string }
}

// --- Internal state (populated from widget:init, used by fetchApi/getFileUrl) ---

let _apiBase = ""
let _token = ""
let _cardId = ""
let _pagePath = ""
let _widgetType = ""

/** @internal Called by useEmbed when widget:init is received. */
export function _setInitContext(init: InitData & { apiBase?: string }, token: string) {
  _apiBase = (init as any).apiBase ?? ""
  _token = token
  _cardId = init.cardId
  _pagePath = init.pagePath
  _widgetType = init.widgetType ?? ""
}

/** @internal Used by helpers (kv, ai) that need the active context. */
export function _getInitContext(): { cardId: string; pagePath: string; widgetType: string } {
  return { cardId: _cardId, pagePath: _pagePath, widgetType: _widgetType }
}

/**
 * @internal Read an error message from a non-ok Response body, preferring a
 * structured `{ error }` payload but falling back to raw text or status.
 * Shared by ai/kv clients so the formatter logic stays in one place.
 */
export async function _readResponseError(res: Response): Promise<string> {
  let text = ""
  try {
    text = await res.text()
  } catch {
    // Stream already consumed or network aborted — fall back to status code.
    return `HTTP ${res.status}`
  }
  try {
    const body = JSON.parse(text) as { error?: string }
    if (body?.error) return body.error
  } catch {
    // Body is not JSON — return the raw slice below.
  }
  return text.slice(0, 200) || `HTTP ${res.status}`
}

// --- Origin management ---

const ALLOWED_ORIGINS = new Set([
  "https://3.quicks.ai",
  "https://ru.quicks.ai",
  "http://localhost:5173",
  "http://localhost:3000",
])

// Add referrer origin (covers tailscale/custom dev hosts)
try {
  if (typeof document !== "undefined" && document.referrer) {
    ALLOWED_ORIGINS.add(new URL(document.referrer).origin)
  }
} catch {}

let _hostOrigin: string | null = null

function getHostOrigin(): string | null {
  if (_hostOrigin) return _hostOrigin
  try {
    if (document.referrer) {
      const origin = new URL(document.referrer).origin
      if (ALLOWED_ORIGINS.has(origin)) {
        _hostOrigin = origin
        return origin
      }
    }
  } catch {}
  return null
}

/** Lock host origin after receiving a valid message. */
export function setHostOrigin(origin: string) {
  if (ALLOWED_ORIGINS.has(origin)) _hostOrigin = origin
}

/** Add a custom allowed origin (e.g. from host_origin URL param). */
export function addAllowedOrigin(origin: string) {
  ALLOWED_ORIGINS.add(origin)
}

// --- Outbound (widget → host) ---

export function postToHost(msg: WidgetMessage) {
  if (!window.parent || window.parent === window) return
  const origin = getHostOrigin()
  if (origin) {
    window.parent.postMessage(JSON.stringify(msg), origin)
    return
  }
  // Referrer not available — broadcast to all allowed origins.
  // Only used for widget:ready; once host responds, we lock to its origin.
  for (const allowed of ALLOWED_ORIGINS) {
    window.parent.postMessage(JSON.stringify(msg), allowed)
  }
}

export function signalReady() {
  postToHost({ type: "widget:ready", data: {} })
}

export function signalError(code: string, message: string) {
  postToHost({ type: "widget:error", data: { code, message } })
}

export function saveState(updates: {
  data?: Record<string, string>
  textData?: Record<string, string>
}) {
  postToHost({ type: "widget:save-state", data: updates })
}

export function runHook(hookName: string, results?: Record<string, string>) {
  postToHost({ type: "widget:run-hook", data: { hookName, results } })
}

export function requestState() {
  postToHost({ type: "widget:request-state", data: {} })
}

export function requestToken() {
  postToHost({ type: "widget:request-token", data: {} })
}

/** Send header status indicator to host (rendered in CardHeader afterTitle). */
export function setHeaderStatus(status: { connected?: boolean; label?: string }) {
  postToHost({ type: "widget:header-status", data: status })
}

/** Register menu items in the host card's "..." dropdown menu. */
export function setMenuItems(items: Array<{ id: string; label: string }>) {
  postToHost({ type: "widget:set-menu-items", data: { items } })
}

// --- Inbound (host → widget) ---

export function onHostMessage(handler: (msg: WidgetMessage) => void): () => void {
  function listener(e: MessageEvent) {
    if (!ALLOWED_ORIGINS.has(e.origin)) return
    let msg: WidgetMessage
    try {
      msg = typeof e.data === "string" ? JSON.parse(e.data) : e.data
    } catch {
      return
    }
    if (!msg.type?.startsWith("widget:")) return
    setHostOrigin(e.origin)
    handler(msg)
  }
  window.addEventListener("message", listener)
  return () => window.removeEventListener("message", listener)
}

// --- URL params ---

export type EmbedParams = {
  token: string
  theme: "light" | "dark"
  hostOrigin: string | null
}

export function getEmbedParams(): EmbedParams {
  const params = new URLSearchParams(location.search)
  const hostOrigin = params.get("host_origin")
  if (hostOrigin) {
    addAllowedOrigin(hostOrigin)
    setHostOrigin(hostOrigin)
  }
  return {
    token: params.get("token") ?? "",
    theme: (params.get("theme") ?? "light") as "light" | "dark",
    hostOrigin,
  }
}

// --- API helpers ---

/**
 * Authenticated fetch to host API. Token and base URL are managed automatically.
 * @param path - API path, e.g. "/cards/upload"
 * @param init - fetch options (method, body, etc.)
 */
export async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  if (!_apiBase) throw new Error("fetchApi: widget not initialized (no apiBase)")
  const headers = new Headers(init?.headers)
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${_token}`)
  }
  return fetch(`${_apiBase}${path}`, { ...init, headers })
}

/**
 * Build URL to download a file from the current card.
 * @param filename - filename within the card directory
 */
export function getFileUrl(filename: string): string {
  if (!_apiBase) throw new Error("getFileUrl: widget not initialized (no apiBase)")
  const params = new URLSearchParams({
    pagePath: _pagePath,
    cardId: _cardId,
    filename,
    token: _token,
  })
  return `${_apiBase}/cards/file?${params}`
}

/**
 * Upload an arbitrary asset file to the current card's files/ directory.
 * Does NOT mutate card.toml — intended for inline assets like images in notes.
 * Returns the relative path (e.g. "files/x.png") to be stored in widget state
 * and resolved to an absolute URL via `resolveAssetSrc` at render time.
 */
export async function uploadAsset(file: File): Promise<string> {
  const formData = new FormData()
  formData.append("pagePath", _pagePath)
  formData.append("cardId", _cardId)
  formData.append("file", file)
  const res = await fetchApi("/cards/asset", { method: "PUT", body: formData })
  if (!res.ok) throw new Error(`uploadAsset failed: ${res.status}`)
  const { filename } = (await res.json()) as { filename: string }
  return filename
}

/**
 * Resolve a possibly-relative asset src to an absolute URL. Pass-through for
 * http(s)/data/blob URLs; relative paths are wrapped with `getFileUrl` so
 * they fetch with a live token.
 */
export function resolveAssetSrc(src: string): string {
  if (!src) return src
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  return getFileUrl(src)
}

// --- Collab URL parsing ---

export type CollabConnection = {
  serverUrl: string
  roomName: string
  params: Record<string, string>
}

/** Parse collabUrl from widget:init into y-websocket compatible parts. */
export function parseCollabUrl(collabUrl: string): CollabConnection | null {
  try {
    const parsed = new URL(collabUrl)
    const prefix = "/ws/collab/"
    const idx = parsed.pathname.indexOf(prefix)
    if (idx === -1) return null
    const serverUrl = `${parsed.protocol === "https:" ? "wss:" : parsed.protocol}//${parsed.host}${parsed.pathname.slice(0, idx + prefix.length - 1)}`
    const roomName = parsed.pathname.slice(idx + prefix.length)
    const params: Record<string, string> = {}
    parsed.searchParams.forEach((v, k) => { params[k] = v })
    return { serverUrl, roomName, params }
  } catch {
    return null
  }
}
