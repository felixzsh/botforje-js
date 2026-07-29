import { InboxService } from '../../../src/messages/inbox'
import { GraphExecutor } from '../../../src/graph/executor'
import { Bot, createBot, createDefaultSettings } from '../../../src/bot'
import { SenderService } from '../../../src/senders/service'
import { MockChannel } from '../helpers/mock-channel'

function createMockSenderService(): jest.Mocked<SenderService> {
  return {
    recordMessage: jest.fn(),
    getSenders: jest.fn(),
    getSender: jest.fn(),
    close: jest.fn(),
  } as unknown as jest.Mocked<SenderService>
}

describe('InboxService', () => {
  let inbox: InboxService
  let graphExecutor: jest.Mocked<GraphExecutor>
  let senderService: jest.Mocked<SenderService>
  let mockChannel: MockChannel
  let bot: Bot

  beforeEach(() => {
    graphExecutor = {
      handleMessage: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<GraphExecutor>

    senderService = createMockSenderService()
    senderService.recordMessage.mockReturnValue({ isNew: false })

    inbox = new InboxService(graphExecutor, senderService)
    mockChannel = new MockChannel()
    bot = createBot({ id: 'test-bot', settings: createDefaultSettings() })
    bot.channel = mockChannel
  })

  describe('registerBot', () => {
    it('should register message and ready handlers on channel', () => {
      inbox.registerBot(bot)

      expect(mockChannel['messageHandlers']).toHaveLength(1)
      expect(mockChannel['readyHandlers']).toHaveLength(1)
    })

    it('should throw if bot has no channel', () => {
      const bareBot = createBot({ id: 'no-channel', settings: createDefaultSettings() })

      expect(() => inbox.registerBot(bareBot)).toThrow(
        'Bot "no-channel" does not have a registered channel'
      )
    })
  })

  describe('message handling', () => {
    beforeEach(() => {
      inbox.registerBot(bot)
    })

    it('should record sender on every message', async () => {
      await mockChannel.simulateMessage({
        id: 'msg-sender',
        from: '5551112222',
        to: 'test-bot',
        content: 'hello',
        timestamp: new Date(),
        senderName: 'Test User',
      })

      expect(senderService.recordMessage).toHaveBeenCalledWith('test-bot', '5551112222', 'Test User')
    })

    it('should ignore messages from self', async () => {
      await mockChannel.simulateMessage({
        id: 'msg-1',
        from: '521234567890',
        to: 'test-bot',
        content: 'hello',
        timestamp: new Date(),
        metadata: { fromMe: true },
      })

      expect(graphExecutor.handleMessage).not.toHaveBeenCalled()
    })

    it('should ignore messages from ignored senders', async () => {
      bot.settings.ignoredSenders = ['5550001111']

      await mockChannel.simulateMessage({
        id: 'msg-2',
        from: '5550001111',
        to: 'test-bot',
        content: 'spam',
        timestamp: new Date(),
      })

      expect(graphExecutor.handleMessage).not.toHaveBeenCalled()
    })

    it('should ignore group messages when ignoreGroups is true', async () => {
      bot.settings.ignoreGroups = true

      await mockChannel.simulateMessage({
        id: 'msg-3',
        from: '1234567890@g.us',
        to: 'test-bot',
        content: 'group msg',
        timestamp: new Date(),
      })

      expect(graphExecutor.handleMessage).not.toHaveBeenCalled()
    })

    it('should process messages from allowed senders', async () => {
      await mockChannel.simulateMessage({
        id: 'msg-4',
        from: '5551112222',
        to: 'test-bot',
        content: 'help',
        timestamp: new Date(),
      })

      expect(graphExecutor.handleMessage).toHaveBeenCalledTimes(1)
      expect(graphExecutor.handleMessage).toHaveBeenCalledWith(
        bot,
        expect.objectContaining({ content: 'help' })
      )
    })

    it('should process group messages when ignoreGroups is false', async () => {
      bot.settings.ignoreGroups = false

      await mockChannel.simulateMessage({
        id: 'msg-5',
        from: '1234567890@g.us',
        to: 'test-bot',
        content: 'group msg',
        timestamp: new Date(),
      })

      expect(graphExecutor.handleMessage).toHaveBeenCalledTimes(1)
    })

    it('should record sender even when sender is not allowed', async () => {
      bot.settings.allowedSenders = ['5550001111']
      senderService.recordMessage.mockReturnValue({ isNew: false })

      await mockChannel.simulateMessage({
        id: 'msg-6',
        from: '9998887777',
        to: 'test-bot',
        content: 'hello',
        timestamp: new Date(),
        senderName: 'Blocked User',
      })

      expect(senderService.recordMessage).toHaveBeenCalledWith('test-bot', '9998887777', 'Blocked User')
      expect(graphExecutor.handleMessage).not.toHaveBeenCalled()
    })

    it('should fire webhook when new sender and webhookBaseUrl is set', async () => {
      const origFetch = global.fetch
      global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response)

      bot.webhookBaseUrl = 'http://localhost:9999/api'
      senderService.recordMessage.mockReturnValue({ isNew: true })

      await mockChannel.simulateMessage({
        id: 'msg-7',
        from: '5551112222',
        to: 'test-bot',
        content: 'hello',
        timestamp: new Date(),
        senderName: 'New User',
      })

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:9999/api/new-sender',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
      expect(callBody.event).toBe('new-sender')
      expect(callBody.sender.phone).toBe('5551112222')
      expect(callBody.sender.name).toBe('New User')
      expect(callBody.bot.id).toBe('test-bot')

      global.fetch = origFetch
    })
  })
})
