/** React hooks for Quicks RemoteWidget embed lifecycle */

import { useEffect, useRef, useState } from "react"
import {
  getEmbedParams,
  signalReady,
  onHostMessage,
  _setInitContext,
  type InitData,
  type WidgetMessage,
} from "./protocol"

export type { InitData, WidgetMessage }
export { saveState, signalError, runHook, requestState, requestToken, parseCollabUrl, setHeaderStatus, fetchApi, getFileUrl } from "./protocol"

type UseEmbedOptions = {
  /** Called on widget:init and widget:state-updated */
  onStateUpdate?: (msg: WidgetMessage) => void
}

type UseEmbedResult = {
  /** Card init data (null until widget:init received) */
  initData: InitData | null
  /** Current theme */
  theme: "light" | "dark"
  /** JWT token from URL params */
  token: string
  /** Whether the card is currently in fullscreen mode */
  isFullscreen: boolean
}

/**
 * Main embed lifecycle hook.
 * Handles: getEmbedParams → signalReady → widget:init → theme changes.
 */
export function useEmbed(options?: UseEmbedOptions): UseEmbedResult {
  const paramsRef = useRef(getEmbedParams())
  const [initData, setInitData] = useState<InitData | null>(null)
  const [theme, setTheme] = useState<"light" | "dark">(paramsRef.current.theme)
  const [isFullscreen, setFullscreen] = useState(false)
  const onStateUpdateRef = useRef(options?.onStateUpdate)
  onStateUpdateRef.current = options?.onStateUpdate

  // Apply initial theme
  useEffect(() => {
    document.documentElement.classList.toggle("dark", paramsRef.current.theme === "dark")
  }, [])

  // Lifecycle: ready → listen for host messages
  useEffect(() => {
    signalReady()

    return onHostMessage((msg) => {
      switch (msg.type) {
        case "widget:init": {
          const raw = msg.data as unknown as InitData & { apiBase?: string }
          _setInitContext(raw, paramsRef.current.token)
          setInitData(raw)
          break
        }
        case "widget:state-updated":
          setInitData((prev) => prev ? { ...prev, ...(msg.data as Record<string, unknown>) } as InitData : prev)
          onStateUpdateRef.current?.(msg)
          break
        case "widget:theme": {
          const t = (msg.data as { theme: string }).theme as "light" | "dark"
          setTheme(t)
          document.documentElement.classList.toggle("dark", t === "dark")
          break
        }
        case "widget:fullscreen":
          setFullscreen(!!(msg.data as { active: boolean }).active)
          break
      }
    })
  }, [])

  return { initData, theme, token: paramsRef.current.token, isFullscreen }
}
