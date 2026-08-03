import { getLogger } from '../helpers/logger'

export interface NewSenderPayload {
  sender: { phone: string; name: string | null }
  bot: { id: string; phone: string | null }
  firstSeen: number
}

// CONSIDERATION: this shouldnt be that specific for a generic fetch
export class WebhookService {
  async fireNewSender(baseUrl: string, payload: NewSenderPayload, headers?: Record<string, string>): Promise<void> {
    const url = `${baseUrl}/new-sender`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(headers || {}),
        },
        body: JSON.stringify({
          event: 'new-sender',
          sender: payload.sender,
          bot: payload.bot,
          firstSeen: payload.firstSeen,
        }),
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        getLogger().warn(`Webhook new-sender returned HTTP ${response.status}`)
        return
      }

      getLogger().debug(`Webhook new-sender sent to ${url}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      getLogger().warn(`Webhook new-sender failed for url="${url}": ${msg}`)
    }
  }
}
