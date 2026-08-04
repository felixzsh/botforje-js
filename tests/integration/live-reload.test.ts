import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { BotFleet } from '../../src/fleet'
import { OutboxService } from '../../src/messages/outbox'
import { ConfigWatcher } from '../../src/config/watcher'
import { loadConfig } from '../../src/config/yaml'
import { IncomingMessage } from '../../src/messages/contracts'
import { SessionManager } from '../../src/whatsapp/session'
import { MockChannel } from '../unit/helpers/mock-channel'

jest.mock('../../src/whatsapp/client', () => ({
  WhatsAppChannel: jest.fn().mockImplementation((id: string) => new MockChannel()),
  setGlobalConfig: jest.fn(),
  getWwebCacheDir: jest.fn(() => mockCacheDir),
}))

jest.mock('../../src/helpers/data', () => ({
  getDataDir: jest.fn(() => mockCacheDir),
}))

let mockCacheDir = ''

function makeMessage(from: string, content: string): IncomingMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from,
    to: 'bot',
    content,
    timestamp: new Date(),
  }
}

describe('Live reload integration', () => {
  let tempDir: string
  let configPath: string
  let fleet: BotFleet
  let outbox: OutboxService
  let watcher: ConfigWatcher
  let sentMessages: Array<{ to: string; content: string }>

  function writeActions(actions: Record<string, string>) {
    const dir = path.join(tempDir, 'actions')
    fs.mkdirSync(dir, { recursive: true })
    for (const [id, reply] of Object.entries(actions)) {
      fs.writeFileSync(path.join(dir, `${id}.yml`), `steps:\n  - message:\n      body: "${reply}"`)
    }
  }

  function writeGraphs(graphs: Record<string, string>) {
    const dir = path.join(tempDir, 'graphs')
    fs.mkdirSync(dir, { recursive: true })
    for (const [id, yaml] of Object.entries(graphs)) {
      fs.writeFileSync(path.join(dir, `${id}.yml`), yaml)
    }
  }

  function writeBots(bots: Record<string, string>) {
    const dir = path.join(tempDir, 'bots')
    fs.mkdirSync(dir, { recursive: true })
    for (const [id, yaml] of Object.entries(bots)) {
      fs.writeFileSync(path.join(dir, `${id}.yml`), yaml)
    }
  }

  function writeMainConfig() {
    fs.writeFileSync(configPath, 'default_timeout: 300\n')
  }

  async function sendMessage(from: string, content: string): Promise<void> {
    const bot = fleet.getBots().values().next().value
    if (!bot) return
    const executor = fleet.getGraphExecutor()
    if (!executor) return
    await executor.handleMessage(bot, makeMessage(from, content))
  }

  function replyContains(text: string): boolean {
    return sentMessages.some(m => m.content.includes(text))
  }

  beforeAll(() => {
    SessionManager.getInstance().removeAllChannels()
  })

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botforje-js-reload-'))
    mockCacheDir = tempDir
    configPath = path.join(tempDir, 'config.yml')
    sentMessages = []

    outbox = {
      enqueue: jest.fn((_botId: string, to: string, content: string) => {
        sentMessages.push({ to, content })
        return `msg-${Date.now()}`
      }),
      setupBotQueue: jest.fn(),
      shutdown: jest.fn(),
      getBotQueueStatus: jest.fn(() => ({ queueSize: 0 })),
      clearBotQueue: jest.fn(),
      getAllQueuesStatus: jest.fn(() => ({ totalQueues: 0, queues: [] })),
      setBotDelay: jest.fn(),
      setBotSendCallback: jest.fn(),
    } as unknown as OutboxService

    fleet = new BotFleet(outbox)
  })

  afterEach(async () => {
    if (watcher) watcher.stop()
    if (fleet.isRunningStatus()) await fleet.stop()
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    SessionManager.getInstance().removeAllChannels()
  })

  it('replies with updated action text after reload', async () => {
    writeActions({ greet: 'Hello' })
    writeGraphs({
      faq: `root: greet\nnodes:\n  greet:\n    action: greet\n    edges:\n      - match: "again"\n        goto: greet\n      - match: "bye"\n        goto: greet`,
    })
    writeBots({ testbot: 'graph: faq' })
    writeMainConfig()

    const config = await loadConfig(configPath)
    await fleet.start(config)
    watcher = new ConfigWatcher(fleet, configPath)

    await sendMessage('user1', 'hello')
    expect(replyContains('Hello')).toBe(true)

    writeActions({ greet: 'Hi there', farewell: 'Bye' })
    await watcher.reload()

    sentMessages = []
    await sendMessage('user1', 'again')
    expect(replyContains('Hi there')).toBe(true)
  })

  it('matches new edges after reload', async () => {
    writeActions({ greet: 'Main Menu', hours: 'Open 9-18', prices: 'From $10', invalid: 'Invalid', farewell: 'Bye' })
    writeGraphs({
      faq: `root: menu\nnodes:\n  menu:\n    action: greet\n    edges:\n      - match: "1, hours"\n        goto: hours\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  hours:\n    action: hours\n    edges:\n      - match: "menu, back"\n        goto: menu\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  invalid:\n    action: invalid\n    edges:\n      - goto: menu\n  farewell:\n    action: farewell\n    edges: []`,
    })
    writeBots({ testbot: 'graph: faq' })
    writeMainConfig()

    const config = await loadConfig(configPath)
    await fleet.start(config)
    watcher = new ConfigWatcher(fleet, configPath)

    await sendMessage('user2', '1')
    expect(replyContains('Open 9-18')).toBe(true)

    writeGraphs({
      faq: `root: menu\nnodes:\n  menu:\n    action: greet\n    edges:\n      - match: "1, hours"\n        goto: hours\n      - match: "2, prices"\n        goto: prices\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  hours:\n    action: hours\n    edges:\n      - match: "menu, back"\n        goto: menu\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  prices:\n    action: prices\n    edges:\n      - match: "menu, back"\n        goto: menu\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  invalid:\n    action: invalid\n    edges:\n      - goto: menu\n  farewell:\n    action: farewell\n    edges: []`,
    })
    await watcher.reload()

    sentMessages = []
    await sendMessage('user2', '2')
    expect(replyContains('From $10')).toBe(true)
  })

  it('applies both new actions and new edges after reload', async () => {
    writeActions({ menu_action: 'Old Menu', farewell: 'Bye' })
    writeGraphs({
      faq: `root: menu\nnodes:\n  menu:\n    action: menu_action\n    edges:\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  invalid:\n    action: menu_action\n    edges:\n      - goto: menu\n  farewell:\n    action: farewell\n    edges: []`,
    })
    writeBots({ testbot: 'graph: faq' })
    writeMainConfig()

    const config = await loadConfig(configPath)
    await fleet.start(config)
    watcher = new ConfigWatcher(fleet, configPath)

    await sendMessage('user3', 'first')
    expect(replyContains('Old Menu')).toBe(true)

    sentMessages = []
    writeActions({ menu_action: 'New Menu', pricing_action: 'From $50', farewell: 'Bye' })
    writeGraphs({
      faq: `root: menu\nnodes:\n  menu:\n    action: menu_action\n    edges:\n      - match: "1, pricing"\n        goto: pricing\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  pricing:\n    action: pricing_action\n    edges:\n      - match: "menu, back"\n        goto: menu\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  invalid:\n    action: menu_action\n    edges:\n      - goto: menu\n  farewell:\n    action: farewell\n    edges: []`,
    })
    await watcher.reload()

    sentMessages = []
    await sendMessage('user3', 'first')
    expect(replyContains('New Menu')).toBe(true)

    await sendMessage('user3', '1')
    expect(replyContains('From $50')).toBe(true)
  })

  it('active session handles new edges added via reload', async () => {
    writeActions({ greet: 'Menu', hours: 'Open 9-18', prices: 'From $10', invalid: 'Invalid', farewell: 'Bye' })
    writeGraphs({
      faq: `root: menu\nnodes:\n  menu:\n    action: greet\n    edges:\n      - match: "1, hours"\n        goto: hours\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  hours:\n    action: hours\n    edges:\n      - match: "menu, back"\n        goto: menu\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  invalid:\n    action: invalid\n    edges:\n      - goto: menu\n  farewell:\n    action: farewell\n    edges: []`,
    })
    writeBots({ testbot: 'graph: faq' })
    writeMainConfig()

    const config = await loadConfig(configPath)
    await fleet.start(config)
    watcher = new ConfigWatcher(fleet, configPath)

    await sendMessage('user4', '1')
    expect(replyContains('Open 9-18')).toBe(true)

    sentMessages = []
    writeGraphs({
      faq: `root: menu\nnodes:\n  menu:\n    action: greet\n    edges:\n      - match: "1, hours"\n        goto: hours\n      - match: "2, prices"\n        goto: prices\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  hours:\n    action: hours\n    edges:\n      - match: "menu, back"\n        goto: menu\n      - match: "2, prices"\n        goto: prices\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  prices:\n    action: prices\n    edges:\n      - match: "menu, back"\n        goto: menu\n      - match: "0, exit"\n        goto: farewell\n      - goto: invalid\n  invalid:\n    action: invalid\n    edges:\n      - goto: menu\n  farewell:\n    action: farewell\n    edges: []`,
    })
    await watcher.reload()

    sentMessages = []
    await sendMessage('user4', '2')
    expect(replyContains('From $10')).toBe(true)
  })

  it('removes bot from fleet when bot config is deleted', async () => {
    writeActions({ greet: 'Hello', farewell: 'Bye' })
    writeGraphs({
      faq: `root: greet\nnodes:\n  greet:\n    action: greet\n    edges:\n      - goto: farewell\n  farewell:\n    action: farewell\n    edges: []`,
    })
    writeBots({ testbot: 'graph: faq', keeper: 'graph: faq' })
    writeMainConfig()

    const config = await loadConfig(configPath)
    await fleet.start(config)
    watcher = new ConfigWatcher(fleet, configPath)

    expect(fleet.getBots().has('testbot')).toBe(true)
    expect(fleet.getBots().has('keeper')).toBe(true)

    const botsDir = path.join(tempDir, 'bots')
    fs.rmSync(path.join(botsDir, 'testbot.yml'))
    await watcher.reload()

    expect(fleet.getBots().has('testbot')).toBe(false)
    expect(fleet.getBots().has('keeper')).toBe(true)
  })

  it('adds new bot to fleet via reload', async () => {
    writeActions({ greet: 'Hello' })
    writeGraphs({
      faq: `root: greet\nnodes:\n  greet:\n    action: greet\n    edges: []`,
    })
    writeBots({ dummy: 'graph: faq' })
    writeMainConfig()

    const config = await loadConfig(configPath)
    await fleet.start(config)
    watcher = new ConfigWatcher(fleet, configPath)

    expect(fleet.getBots().has('dummy')).toBe(true)

    writeBots({ dummy: 'graph: faq', newbot: 'graph: faq' })
    await watcher.reload()

    expect(fleet.getBots().has('newbot')).toBe(true)
    expect(fleet.getBots().has('dummy')).toBe(true)
  })

  it('re-applies outbox queue delay when bot settings change via reload', async () => {
    writeActions({ greet: 'Hello' })
    writeGraphs({
      faq: `root: greet\nnodes:\n  greet:\n    action: greet\n    edges: []`,
    })
    writeBots({ testbot: 'graph: faq\nsettings:\n  queue_delay: 1000' })
    writeMainConfig()

    const config = await loadConfig(configPath)
    await fleet.start(config)
    watcher = new ConfigWatcher(fleet, configPath)

    writeBots({ testbot: 'graph: faq\nsettings:\n  queue_delay: 5000' })
    await watcher.reload()

    const bot = fleet.getBots().get('testbot')
    expect(bot?.settings.queueDelay).toBe(5000)
    const setupBotQueueMock = outbox.setupBotQueue as jest.Mock
    expect(setupBotQueueMock).toHaveBeenCalled()
    const lastCall = setupBotQueueMock.mock.calls[setupBotQueueMock.mock.calls.length - 1][0] as { settings: { queueDelay: number } }
    expect(lastCall.settings.queueDelay).toBe(5000)
  })
})
