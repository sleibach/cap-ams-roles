import cds = require('@sap/cds')
import { PRINCIPALS, UNDEFINED_TENANT } from './constants'

const seen = new Map<string, number>()

export interface PrincipalUser {
  id?: string
  authInfo?: {
    token?: {
      scimId?: unknown
      appTid?: unknown
      payload?: { scim_id?: unknown; app_tid?: unknown }
    }
  }
}

function asId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  return id || undefined
}

/**
 * Remember sub <-> scim_id. Writes only when the pair is new to this process,
 * or the last write is older than `intervalMs`. Failures are the caller's to log.
 */
export async function rememberPrincipal(user: PrincipalUser | undefined, intervalMs: number): Promise<boolean> {
  const token = user?.authInfo?.token
  const scimId = asId(token?.scimId) ?? asId(token?.payload?.scim_id)
  const userId = asId(user?.id)
  if (!scimId || !userId || userId === 'anonymous' || userId === 'system') return false

  const rawTid = token?.appTid ?? token?.payload?.app_tid
  const tenant = asId(rawTid) ?? UNDEFINED_TENANT
  const key = tenant + '|' + scimId + '|' + userId
  const now = Date.now()
  const prev = seen.get(key)
  if (prev != null && now - prev < intervalMs) return false
  seen.set(key, now)

  try {
    const { UPSERT } = cds.ql
    await cds.tx(async () => {
      await UPSERT.into(PRINCIPALS).entries({
        tenant,
        scimId,
        userId,
        lastSeen: new Date(now),
      })
    })
    return true
  } catch (err) {
    seen.delete(key)
    throw err
  }
}

/** Test hook. */
export function resetPrincipalCache(): void {
  seen.clear()
}
