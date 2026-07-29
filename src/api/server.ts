import express, { Router } from 'express'
import { OutboxService } from '../messages/outbox'
import { Bot } from '../bot'
import { BotFleet } from '../fleet'
import { ConfigWatcher } from '../config/watcher'
import { AuthService } from '../auth/service'
import { createHealthRouter } from './routes/health'
import { createBotsRouter } from './routes/bots'
import { createMessagesRouter } from './routes/messages'
import { createSessionsRouter } from './routes/sessions'
import { createStatusRouter } from './routes/status'
import { createConfigRouter } from './routes/config'
import { createAuthRouter, findSessionToken } from './routes/auth'
import { createSendersRouter } from './routes/senders'
import { SenderService } from '../senders/service'
import { getLogger } from '../helpers/logger'

export class ApiServer {
  private app: express.Application
  private port: number
  private address: string
  private authService: AuthService
  private outboxService: OutboxService
  private bots: Map<string, Bot>
  private fleet?: BotFleet
  private configWatcher?: ConfigWatcher
  private senderService?: SenderService
  private server: any

  constructor(
    outboxService: OutboxService,
    bots: Map<string, Bot>,
    authService: AuthService,
    port: number = 3000,
    fleet?: BotFleet,
    configWatcher?: ConfigWatcher,
    address: string = '127.0.0.1',
    senderService?: SenderService
  ) {
    this.app = express()
    this.port = port
    this.address = address
    this.authService = authService
    this.outboxService = outboxService
    this.bots = bots
    this.fleet = fleet
    this.configWatcher = configWatcher
    this.senderService = senderService

    this.setupMiddleware()
    this.setupAuth()
    this.setupRoutes()
  }

  private get logger() {
    return getLogger()
  }

  private setupMiddleware(): void {
    this.app.use(express.json())

    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')

      if (req.method === 'OPTIONS') {
        res.sendStatus(200)
      } else {
        next()
      }
    })
  }

  private setupAuth(): void {
    this.app.use('/api', (req, res, next) => {
      if (req.path === '/health') return next()

      if (!this.authService.isLocked()) return next()

      const sessionToken = findSessionToken(this.authService, req.headers.cookie)
      if (sessionToken) return next()

      const auth = req.headers.authorization
      if (auth && auth.startsWith('Bearer ')) {
        const key = auth.slice(7)
        if (this.authService.verifyKey(key)) return next()
      }

      res.status(401).json({ error: 'Unauthorized' })
    })
  }

  private setupRoutes(): void {
    const api = Router()
    api.use('/health', createHealthRouter())
    api.use('/auth', createAuthRouter(this.authService))
    api.use('/bots', createBotsRouter(this.bots))
    api.use('/messages', createMessagesRouter(this.outboxService, this.bots))
    api.use('/sessions', createSessionsRouter())
    api.use('/status', createStatusRouter(this.bots))
    if (this.senderService) {
      api.use('/senders', createSendersRouter(this.senderService))
    }
    if (this.fleet && this.configWatcher) {
      api.use('/config', createConfigRouter(this.fleet, this.configWatcher))
    }
    this.app.use('/api', api)

    this.app.get('/', (req, res) => {
      const endpoints: any = {
        health: '/api/health',
        auth: '/api/auth',
        messages: '/api/messages',
        bots: '/api/bots',
        sessions: '/api/sessions',
        status: '/api/status',
        senders: '/api/senders',
      }
      if (this.fleet && this.configWatcher) {
        endpoints.config = '/api/config'
      }
      res.json({
        service: 'Botforje-js API',
        endpoints,
      })
    })

    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
      })
    })
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, this.address, () => {
        this.logger.info(`API Server started on ${this.address}:${this.port}`)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('API Server stopped')
          resolve()
        })
      } else {
        this.logger.info('API Server stopped')
        resolve()
      }
    })
  }
}
