/**
 * Per-user key/value storage for widgets.
 *
 * Calls go through `/api/widget-kv` (see apps/backend/src/routes/widgetKv.ts).
 * Author of a widget supplies only `(key, value)` — the SDK auto-fills
 * `card_id`, `page_path`, `widget_type` from the widget:init context, and the
 * backend stamps `user_id`, `user_ip`, timestamps.
 *
 * Storage is scoped per (user, card, key): the same user reopening the same
 * card sees the same value. Different cards of the same widget type get
 * independent storage.
 *
 * `value` must be JSON-encodable and not `null` — call `kvDelete` to remove
 * a key. `value` types are not validated in runtime; callers using `kvGet<T>`
 * are trusted to read with the same shape they wrote.
 */

import { fetchApi, _getInitContext, _readResponseError } from "./protocol"

export type KvItem = {
  key: string
  value: unknown
  /** ISO 8601 UTC timestamp from the backend. */
  updated_at: string
}

/** Assert that widget:init has populated the cardId; required for every kv call. */
function assertCardId(): { cardId: string; pagePath: string } {
  const ctx = _getInitContext()
  if (!ctx.cardId) {
    throw new Error("widget kv: not initialized (call after widget:init)")
  }
  return { cardId: ctx.cardId, pagePath: ctx.pagePath }
}

/** Additionally assert widget_type; only kvSet needs it (tagging on the backend). */
function assertWidgetType(): { cardId: string; pagePath: string; widgetType: string } {
  const base = assertCardId()
  const { widgetType } = _getInitContext()
  if (!widgetType) {
    throw new Error("widget kv: widgetType missing in init context (host must send widgetType)")
  }
  return { ...base, widgetType }
}

/**
 * Upsert a value for `key` under the current (user, card). Returns once the
 * write has been acknowledged. `value` is serialized as JSON; pass anything
 * JSON-encodable (object, array, string, number, boolean). `null` is
 * rejected — use `kvDelete` to remove a key.
 */
export async function kvSet(key: string, value: unknown, opts?: { signal?: AbortSignal }): Promise<void> {
  if (value === null) {
    throw new Error("kv.set: value cannot be null — call kvDelete to remove a key")
  }
  const ctx = assertWidgetType()
  const res = await fetchApi("/widget-kv", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      card_id: ctx.cardId,
      page_path: ctx.pagePath || undefined,
      widget_type: ctx.widgetType,
      key,
      value,
    }),
    signal: opts?.signal,
  })
  if (!res.ok) throw new Error(`kv.set ${res.status}: ${await _readResponseError(res)}`)
}

/**
 * Read a single key. Returns `null` if the key has never been set for the
 * current (user, card). Because `kvSet` rejects `null`, the response is
 * unambiguous: `null` always means "not present".
 */
export async function kvGet<T = unknown>(key: string, opts?: { signal?: AbortSignal }): Promise<T | null> {
  const ctx = assertCardId()
  const params = new URLSearchParams({ card_id: ctx.cardId, key })
  const res = await fetchApi(`/widget-kv?${params}`, { signal: opts?.signal })
  if (!res.ok) throw new Error(`kv.get ${res.status}: ${await _readResponseError(res)}`)
  const body = (await res.json()) as { value: T | null }
  return body.value
}

/**
 * Read every key for the current (user, card). Useful on widget mount to
 * rehydrate state in one round-trip.
 */
export async function kvGetAll(opts?: { signal?: AbortSignal }): Promise<KvItem[]> {
  const ctx = assertCardId()
  const params = new URLSearchParams({ card_id: ctx.cardId })
  const res = await fetchApi(`/widget-kv?${params}`, { signal: opts?.signal })
  if (!res.ok) throw new Error(`kv.getAll ${res.status}: ${await _readResponseError(res)}`)
  const body = (await res.json()) as { items: KvItem[] }
  return body.items
}

/** Delete a key. No-op if the key didn't exist. */
export async function kvDelete(key: string, opts?: { signal?: AbortSignal }): Promise<void> {
  const ctx = assertCardId()
  const params = new URLSearchParams({ card_id: ctx.cardId, key })
  const res = await fetchApi(`/widget-kv?${params}`, { method: "DELETE", signal: opts?.signal })
  if (!res.ok) throw new Error(`kv.delete ${res.status}: ${await _readResponseError(res)}`)
}
