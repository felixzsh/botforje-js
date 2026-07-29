import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { SenderService } from '../../../src/senders/service'

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

  it('should record a new sender', () => {
    const result = service.recordMessage('test-bot', '5551112222', 'Test User')

    expect(result.isNew).toBe(true)
  })

  it('should return isNew=false for existing sender', () => {
    service.recordMessage('test-bot', '5551112222', 'Test User')
    const result = service.recordMessage('test-bot', '5551112222', 'Test User')

    expect(result.isNew).toBe(false)
  })

  it('should increment message count on repeated messages', () => {
    service.recordMessage('test-bot', '5551112222', 'Test User')
    service.recordMessage('test-bot', '5551112222', 'Test User')
    service.recordMessage('test-bot', '5551112222', 'Test User')

    const senders = service.getSenders()
    expect(senders).toHaveLength(1)
    expect(senders[0].messageCount).toBe(3)
  })

  it('should separate senders by bot', () => {
    service.recordMessage('bot-a', '5551112222', 'User')
    service.recordMessage('bot-b', '5551112222', 'User')

    const botASenders = service.getSenders('bot-a')
    const botBSenders = service.getSenders('bot-b')

    expect(botASenders).toHaveLength(1)
    expect(botBSenders).toHaveLength(1)
  })

  it('should update name on subsequent messages', () => {
    service.recordMessage('test-bot', '5551112222', 'Old Name')
    service.recordMessage('test-bot', '5551112222', 'New Name')

    const sender = service.getSender('5551112222', 'test-bot')
    expect(sender?.name).toBe('New Name')
  })

  it('should return undefined for non-existent sender', () => {
    const sender = service.getSender('nonexistent', 'test-bot')

    expect(sender).toBeUndefined()
  })

  it('should filter by since timestamp', () => {
    const now = Date.now()
    service.recordMessage('test-bot', '5551112222', 'Old')
    const senders = service.getSenders(undefined, now + 1000)

    expect(senders).toHaveLength(0)
  })

  it('should store sender with null name when not provided', () => {
    service.recordMessage('test-bot', '5551112222')

    const sender = service.getSender('5551112222', 'test-bot')
    expect(sender?.name).toBeNull()
  })
})
