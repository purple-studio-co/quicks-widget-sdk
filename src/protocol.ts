/** Quicks RemoteWidget postMessage protocol */

export type WidgetMessage = { type: string; data?: Record<string, unknown> }

export type InitData = {
  cardId: string
  pagePath: string
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

/** @internal Called by useEmbed when widget:init is received. */
export function _setInitContext(init: InitData & { apiBase?: string }, token: string) {
  _apiBase = (init as any).apiBase ?? ""
  _token = token
  _cardId = init.cardId
  _pagePath = init.pagePath
}

// --- Origin management ---

const ALLOWED_ORIGINS = new Set([
  "https://3.quicks.ai",
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
  if (hostOrigin) addAllowedOrigin(hostOrigin)
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
