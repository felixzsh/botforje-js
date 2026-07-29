import * as fs from 'fs'
import * as path from 'path'
import { Bot } from './bot'
import { ConfigFile } from './config/schema'
import { mapBotsFromConfig, mapActionCatalog, mapGraphCatalog } from './config/mapper'
import { ActionCatalog } from './actions/action'
import { GraphCatalog } from './graph/graph'
import { CooldownService } from './actions/cooldown'
import { OutboxService } from './messages/outbox'
import { InboxService } from './messages/inbox'
import { GraphStateService } from './graph/state'
import { GraphExecutor } from './graph/executor'
import { SessionManager } from './whatsapp/session'
import { AuthService } from './auth/service'
import { SenderService } from './senders/service'
import { WebhookService } from './webhooks/service'
import { setGlobalConfig } from './whatsapp/client'
import { MessageChannel } from './messages/contracts'
import { getLogger } from './helpers/logger'
import { getDataDir } from './helpers/data'

export class BotFleet {
  private bots: Map<string, Bot> = new Map()
  private cooldownService: CooldownService
  private outboxService: OutboxService
  private inboxService?: InboxService
  private sessionManager: SessionManager
  private actionCatalog: ActionCatalog = new Map()
  private graphCatalog: GraphCatalog = new Map()
  private graphStateService?: GraphStateService
  private graphExecutor?: GraphExecutor
  private authService?: AuthService
  private senderService?: SenderService
  private isRunning: boolean = false

  constructor(outboxService: OutboxService) {
    this.sessionManager = SessionManager.getInstance()
    this.outboxService = outboxService
    this.cooldownService = new CooldownService()
  }

  private get logger() {
    return getLogger()
  }

  async start(configFile: ConfigFile): Promise<Map<string, Bot>> {
    if (this.isRunning) {
      this.logger.info('Bot Fleet Launcher is already running')
      return this.bots
    }

    try {
      this.actionCatalog = mapActionCatalog(configFile.actions || {})
      this.graphCatalog = mapGraphCatalog(configFile.graphs || {})

      const dataDir = getDataDir()
      fs.mkdirSync(dataDir, { recursive: true })
      const dbPath = path.join(dataDir, 'botforje-js.db')
      this.graphStateService = new GraphStateService(dbPath)
      this.authService = new AuthService(dbPath)
      this.senderService = new SenderService(dbPath, new WebhookService())

      const graphStateTimeout = configFile.default_timeout ?? 300
      this.graphExecutor = new GraphExecutor(
        this.actionCatalog,
        this.graphCatalog,
        this.graphStateService,
        this.outboxService,
        graphStateTimeout,
        this.cooldownService
      )

      this.inboxService = new InboxService(this.graphExecutor, this.senderService)

      if (Object.keys(configFile.bots).length === 0) {
        this.logger.warn('No bots configured.')
        return this.bots
      }

      const loadedBots = mapBotsFromConfig(configFile.bots)

      this.logger.debug(`Initializing ${loadedBots.length} bot(s)...`)

      for (const bot of loadedBots) {
        this.logger.debug(`Bot "${bot.id}" settings: allowed_senders=[${bot.settings.allowedSenders.join(', ')}]`)
        this.registerBot(bot)
      }

      this.isRunning = true
      this.logger.info('Waiting for bot connections...')

      this.setupGracefulShutdown()

      return this.bots

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Failed to start Bot Fleet Launcher: ${msg}`)
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return
    }

    this.logger.info('Stopping Botforje-js...')

    try {
      await this.outboxService.shutdown()
      await this.sessionManager.removeAllChannels()
      this.graphStateService?.close()
      this.senderService?.close()
      this.authService?.close()
      this.bots.clear()

      this.isRunning = false
      this.logger.info('Botforje-js stopped successfully')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Error stopping Bot Fleet: ${msg}`)
      throw error
    }
  }

  private registerBot(bot: Bot): void {
    this.logger.info(`Registering bot: ${bot.id}`)
    this.bots.set(bot.id, bot)
    this.outboxService.setupBotQueue(bot)

    this.sessionManager.onSessionReady(bot.id, (channel) => {
      this.linkSessionToBot(bot, channel)
    })

    this.sessionManager.registerSession(bot.id).catch((err) => {
      this.logger.warn(`Bot "${bot.id}" session registration failed: ${err.message}`)
    })
  }

  private linkSessionToBot(bot: Bot, channel: MessageChannel): void {
    bot.channel = channel
    this.inboxService!.registerBot(bot)
    this.setupBotEventHandlers(bot)

    const phone = channel.getPhone()
    if (phone) {
      bot.phone = phone
    }

    this.logger.info(`Bot "${bot.id}" linked to session`)
  }

  private setupBotEventHandlers(bot: Bot): void {
    if (!bot.channel) return

    bot.channel.onReady(() => {
      this.logger.info(`Bot "${bot.id}" is ready!`)
      const phone = bot.channel!.getPhone()
      if (phone) {
        bot.phone = phone
      }
    })

    bot.channel.onDisconnected((reason: string) => {
      this.logger.warn(`Bot "${bot.id}" disconnected: ${reason}`)
    })

    bot.channel.onAuthFailure((error: Error) => {
      this.logger.error(`Bot "${bot.id}" authentication failed: ${error.message}`)
    })

    bot.channel.onConnectionError((error: Error) => {
      this.logger.error(`Bot "${bot.id}" connection error: ${error.message}`)
    })

    bot.channel.onStateChange((state: string) => {
      this.logger.info(`Bot "${bot.id}" state changed to: ${state}`)
    })

    bot.channel.onAuthRequired?.((info) => {
      this.logger.info(`QR auth required for bot "${bot.id}"`)
    })
  }

  linkExistingSession(botId: string): void {
    const bot = this.bots.get(botId)
    if (!bot) {
      this.logger.warn(`Cannot link session: bot "${botId}" not found`)
      return
    }
    const channel = this.sessionManager.getChannel(botId)
    if (!channel) {
      this.logger.warn(`Cannot link session: no session for "${botId}"`)
      return
    }
    this.linkSessionToBot(bot, channel)
  }

  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      this.logger.info('\nReceived shutdown signal...')
      await this.stop()
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    process.on('SIGUSR2', shutdown)

    process.on('uncaughtException', (error) => {
      const msg = error instanceof Error ? error.stack || error.message : String(error)
      this.logger.error(`Uncaught Exception: ${msg}`)
      this.stop().finally(() => process.exit(1))
    })

    process.on('unhandledRejection', (reason) => {
      const msg = reason instanceof Error ? reason.stack || reason.message : String(reason)
      this.logger.error(`Unhandled Rejection: ${msg}`)
      this.stop().finally(() => process.exit(1))
    })
  }

  getStatus(): any {
    const botStatuses = Array.from(this.bots.values()).map(bot => {
      const queueStatus = this.outboxService.getBotQueueStatus(bot.id)
      const sessionInfo = this.sessionManager.getSessionInfo(bot.id)

      return {
        id: bot.id,
        graph: bot.graph,
        session: sessionInfo ? {
          state: sessionInfo.state,
          phone: sessionInfo.phone,
        } : null,
        queue: {
          size: queueStatus.queueSize,
          delayMs: queueStatus.delayMs,
          isProcessing: queueStatus.isProcessing,
          hasCallback: queueStatus.hasCallback,
        },
      }
    })

    return {
      isRunning: this.isRunning,
      bots: botStatuses,
      totalBots: botStatuses.length,
    }
  }

  isRunningStatus(): boolean {
    return this.isRunning
  }

  getOutboxService(): OutboxService {
    return this.outboxService
  }

  getBots(): Map<string, Bot> {
    return this.bots
  }

  reloadCatalogs(actionCatalog: ActionCatalog, graphCatalog: GraphCatalog): void {
    this.actionCatalog = actionCatalog
    this.graphCatalog = graphCatalog
    this.graphExecutor?.updateCatalogs(actionCatalog, graphCatalog)
  }

  getGraphExecutor(): GraphExecutor | undefined {
    return this.graphExecutor
  }

  getAuthService(): AuthService {
    if (!this.authService) {
      throw new Error('AuthService not initialized. Call start() first.')
    }
    return this.authService
  }

  getSenderService(): SenderService {
    if (!this.senderService) {
      throw new Error('SenderService not initialized. Call start() first.')
    }
    return this.senderService
  }
}
