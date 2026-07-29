import { WebhookService, NewSenderPayload } from '../../../src/webhooks/service'

describe('WebhookService', () => {
  let service: WebhookService
  let origFetch: typeof global.fetch

  const basePayload: NewSenderPayload = {
    sender: { phone: '5551112222', name: 'Test User' },
    bot: { id: 'test-bot', phone: '521234567890' },
    firstSeen: 1700000000000,
  }

  beforeEach(() => {
    service = new WebhookService()
    origFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = origFetch
  })

  it('should POST to {baseUrl}/new-sender with correct payload', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response)

    await service.fireNewSender('http://example.com/api', basePayload)

    expect(global.fetch).toHaveBeenCalledWith(
      'http://example.com/api/new-sender',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: expect.any(AbortSignal),
      })
    )

    const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(callBody).toEqual({
      event: 'new-sender',
      sender: { phone: '5551112222', name: 'Test User' },
      bot: { id: 'test-bot', phone: '521234567890' },
      firstSeen: 1700000000000,
    })
  })

  it('should handle non-ok response gracefully', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 } as Response)

    await expect(service.fireNewSender('http://example.com/api', basePayload)).resolves.toBeUndefined()
  })

  it('should handle fetch error gracefully', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'))

    await expect(service.fireNewSender('http://example.com/api', basePayload)).resolves.toBeUndefined()
  })

  it('should handle null name and null bot phone', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response)

    const minimalPayload: NewSenderPayload = {
      sender: { phone: '5551112222', name: null },
      bot: { id: 'test-bot', phone: null },
      firstSeen: 1700000000000,
    }

    await service.fireNewSender('http://example.com/api', minimalPayload)

    const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(callBody.sender.name).toBeNull()
    expect(callBody.bot.phone).toBeNull()
  })
})
