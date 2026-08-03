import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { SenderService } from '../../../src/senders/service'
import { WebhookService } from '../../../src/webhooks/service'
import { Bot, BotWebhooks, createBot, createDefaultSettings } from '../../../src/bot'
import { IncomingMessage } from '../../../src/messages/contracts'

function msg(from: string, name?: string): IncomingMessage {
  return {
    id: `msg-${Date.now()}`,
    from,
    to: 'test-bot',
    content: 'hello',
    timestamp: new Date(),
    senderName: name,
  }
}

function bot(id: string, webhooks?: BotWebhooks): Bot {
  return createBot({ id, settings: createDefaultSettings(), webhooks })
}

describe('SenderService', () => {
  let dbPath: string
  let service: SenderService

  beforeEach(() => {
    dbPath = join(tmpdir(), `test-senders-${Date.now()}-${Math.random()}.db`)
    service = new SenderService(dbPath)
  })

  afterEach(() => {
    service.close()
    if (existsSync(dbPath)) unlinkSync(dbPath)
  })

  it('should create a new sender record', () => {
    service.recordMessage(bot('test-bot'), msg('5551112222', 'Test User'))
    const sender = service.getSender('5551112222', 'test-bot')

    expect(sender).toBeDefined()
    expect(sender!.messageCount).toBe(1)
    expect(sender!.name).toBe('Test User')
  })

  it('should increment message count on repeated messages', () => {
    service.recordMessage(bot('test-bot'), msg('5551112222', 'Test User'))
    service.recordMessage(bot('test-bot'), msg('5551112222', 'Test User'))
    service.recordMessage(bot('test-bot'), msg('5551112222', 'Test User'))

    const senders = service.getSenders()
    expect(senders).toHaveLength(1)
    expect(senders[0].messageCount).toBe(3)
  })

  it('should separate senders by bot', () => {
    service.recordMessage(bot('bot-a'), msg('5551112222', 'User'))
    service.recordMessage(bot('bot-b'), msg('5551112222', 'User'))

    const botASenders = service.getSenders('bot-a')
    const botBSenders = service.getSenders('bot-b')

    expect(botASenders).toHaveLength(1)
    expect(botBSenders).toHaveLength(1)
  })

  it('should update name on subsequent messages', () => {
    service.recordMessage(bot('test-bot'), msg('5551112222', 'Old Name'))
    service.recordMessage(bot('test-bot'), msg('5551112222', 'New Name'))

    const sender = service.getSender('5551112222', 'test-bot')
    expect(sender?.name).toBe('New Name')
  })

  it('should return undefined for non-existent sender', () => {
    const sender = service.getSender('nonexistent', 'test-bot')
    expect(sender).toBeUndefined()
  })

  it('should filter by since timestamp', () => {
    const now = Date.now()
    service.recordMessage(bot('test-bot'), msg('5551112222', 'Old'))
    const senders = service.getSenders(undefined, now + 1000)
    expect(senders).toHaveLength(0)
  })

  it('should store sender with null name when not provided', () => {
    service.recordMessage(bot('test-bot'), msg('5551112222'))
    const sender = service.getSender('5551112222', 'test-bot')
    expect(sender?.name).toBeNull()
  })

  it('should fire webhook for new sender when webhookService is provided', async () => {
    const origFetch = global.fetch
    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response)

    const ws = new WebhookService()
    const svc = new SenderService(dbPath.replace('.db', '-wh.db'), ws)
    svc.recordMessage(bot('test-bot', { url: 'http://example.com/api' }), msg('5551112222', 'Test User'))

    expect(global.fetch).toHaveBeenCalledWith(
      'http://example.com/api/new-sender',
      expect.any(Object)
    )

    const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(callBody.sender.phone).toBe('5551112222')
    expect(callBody.bot.id).toBe('test-bot')

    global.fetch = origFetch
    svc.close()
    if (existsSync(dbPath.replace('.db', '-wh.db'))) unlinkSync(dbPath.replace('.db', '-wh.db'))
  })

  it('should not fire webhook for existing sender', () => {
    const ws = new WebhookService()
    const wsSpy = jest.spyOn(ws, 'fireNewSender').mockResolvedValue(undefined)

    const svc = new SenderService(dbPath.replace('.db', '-existing.db'), ws)
    svc.recordMessage(bot('test-bot', { url: 'http://example.com/api' }), msg('5551112222', 'User'))
    expect(wsSpy).toHaveBeenCalledTimes(1)

    svc.recordMessage(bot('test-bot', { url: 'http://example.com/api' }), msg('5551112222', 'User'))
    expect(wsSpy).toHaveBeenCalledTimes(1)

    wsSpy.mockRestore()
    svc.close()
    if (existsSync(dbPath.replace('.db', '-existing.db'))) unlinkSync(dbPath.replace('.db', '-existing.db'))
  })

  it('should not fire webhook when bot has no webhooks.url', () => {
    const ws = new WebhookService()
    const wsSpy = jest.spyOn(ws, 'fireNewSender').mockResolvedValue(undefined)

    const svc = new SenderService(dbPath.replace('.db', '-nourl.db'), ws)
    svc.recordMessage(bot('test-bot'), msg('5551112222', 'User'))

    expect(wsSpy).not.toHaveBeenCalled()

    wsSpy.mockRestore()
    svc.close()
    if (existsSync(dbPath.replace('.db', '-nourl.db'))) unlinkSync(dbPath.replace('.db', '-nourl.db'))
  })
})
