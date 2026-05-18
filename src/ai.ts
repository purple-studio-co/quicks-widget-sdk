/**
 * Widget AI gateway client.
 *
 * Thin typed wrapper over /api/ai/* (see apps/backend/src/routes/ai.ts).
 * Calls go through fetchApi (which adds the user's JWT and apiBase from
 * widget:init), so no extra auth setup is required from the widget.
 */

import { fetchApi, _readResponseError as readError } from "./protocol"

export type AiTier = "fast" | "smart" | "json" | "cheap"

export type AiMessage = {
  role: "user" | "assistant"
  content: string | Array<{ type: string; text?: string }>
}

export type AiCompleteParams = {
  tier?: AiTier
  system?: string
  messages: AiMessage[]
  max_tokens?: number
  temperature?: number
  /** Optional context for usage tagging — not required for auth. */
  widgetType?: string
  cardId?: string
  /** Short label shown on the Langfuse trace (e.g. "writing-grader"). */
  name?: string
  signal?: AbortSignal
}

export type AiCompleteResult = {
  content: string
  stop_reason: string | null
  usage: { input_tokens: number; output_tokens: number }
}

export type AiPronParams = {
  audio_base64: string
  audio_format: "webm" | "ogg" | "mp4" | "wav" | "mp3"
  expected_text: string
  accent?: "us" | "uk"
  widgetType?: string
  cardId?: string
  signal?: AbortSignal
}

/** Shape mirrors Language Confidence response (overall_score, words, ...). */
export type AiPronResult = Record<string, unknown> & {
  overall_score?: number
  words?: Array<{ word_text?: string; word_score?: number; phonemes?: unknown[] }>
}

export type AiRealtimeSession = {
  provider: "gemini-live"
  /** WebSocket URL with the auth key already embedded as a query parameter. */
  ws_url: string
  models: string[]
  expires_at: number
}

export async function aiComplete(params: AiCompleteParams): Promise<AiCompleteResult> {
  const { signal, widgetType, cardId, name, ...body } = params
  const res = await fetchApi("/ai/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...body,
      widget_type: widgetType,
      card_id: cardId,
      name,
    }),
    signal,
  })
  if (!res.ok) throw new Error(`ai.complete ${res.status}: ${await readError(res)}`)
  return (await res.json()) as AiCompleteResult
}

export async function aiPron(params: AiPronParams): Promise<AiPronResult> {
  const { signal, widgetType, cardId, ...body } = params
  const res = await fetchApi("/ai/pron", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, widget_type: widgetType, card_id: cardId }),
    signal,
  })
  if (!res.ok) throw new Error(`ai.pron ${res.status}: ${await readError(res)}`)
  return (await res.json()) as AiPronResult
}

export async function aiRealtimeToken(opts?: {
  widgetType?: string
  cardId?: string
  signal?: AbortSignal
}): Promise<AiRealtimeSession> {
  const params = new URLSearchParams()
  params.set("provider", "gemini-live")
  if (opts?.widgetType) params.set("widget_type", opts.widgetType)
  if (opts?.cardId) params.set("card_id", opts.cardId)
  const res = await fetchApi(`/ai/realtime/token?${params}`, { signal: opts?.signal })
  if (!res.ok) throw new Error(`ai.realtime.token ${res.status}: ${await readError(res)}`)
  return (await res.json()) as AiRealtimeSession
}
