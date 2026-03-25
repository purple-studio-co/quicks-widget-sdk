/** React hooks for Quicks RemoteWidget embed lifecycle */

import { useEffect, useRef, useState } from "react"
import {
  getEmbedParams,
  signalReady,
  onHostMessage,
  type InitData,
  type WidgetMessage,
} from "./protocol"

export type { InitData, WidgetMessage }
export { saveState, signalError, runHook, requestState, requestToken, parseCollabUrl } from "./protocol"

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
}

/**
 * Main embed lifecycle hook.
 * Handles: getEmbedParams → signalReady → widget:init → theme changes.
 */
export function useEmbed(options?: UseEmbedOptions): UseEmbedResult {
  const paramsRef = useRef(getEmbedParams())
  const [initData, setInitData] = useState<InitData | null>(null)
  const [theme, setTheme] = useState<"light" | "dark">(paramsRef.current.theme)
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
        case "widget:init":
          setInitData(msg.data as unknown as InitData)
          break
        case "widget:state-updated":
          onStateUpdateRef.current?.(msg)
          break
        case "widget:theme": {
          const t = (msg.data as { theme: string }).theme as "light" | "dark"
          setTheme(t)
          document.documentElement.classList.toggle("dark", t === "dark")
          break
        }
      }
    })
  }, [])

  return { initData, theme, token: paramsRef.current.token }
}
