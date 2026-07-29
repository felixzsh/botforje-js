import { Client, LocalAuth, Location } from 'whatsapp-web.js'
import * as path from 'path'
import * as os from 'os'
import { IncomingMessage, OutgoingMessage, MessageChannel, AuthRequiredInfo } from '../messages/contracts'
import { Bot } from '../bot'
import { ConfigFile } from '../config/schema'
import { toDomainMessage, toWhatsAppFormat, WhatsAppConnectionState, widToPhoneNumber, normalizePhoneNumber, generateMessageId } from './whatsapp'
import { getLogger } from '../helpers/logger'

export function getWwebCacheDir(): string {
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
  return path.join(cacheHome, 'botforje-js')
}

let globalConfig: ConfigFile | undefined

export function setGlobalConfig(config: ConfigFile): void {
  globalConfig = config
}

export function getPuppeteerOptions(): any {
  const chromiumPath = globalConfig?.chromium_path || '/usr/bin/chromium'
  return {
    executablePath: chromiumPath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--mute-audio',
    ],
  }
}

export function getClientOptions(clientId: string) {
  return {
    authStrategy: new LocalAuth({
      clientId: clientId,
      dataPath: path.join(getWwebCacheDir(), '.wwebjs_auth'),
    }),
    puppeteer: getPuppeteerOptions(),
    webVersionCache: {
      type: 'local' as const,
      path: path.join(getWwebCacheDir(), '.wwebjs_cache'),
    },
  }
}

type MessageHandler = (message: IncomingMessage) => void | Promise<void>
type ReadyHandler = () => void | Promise<void>
type DisconnectedHandler = (reason: string) => void | Promise<void>
type AuthFailureHandler = (error: Error) => void | Promise<void>
type ConnectionErrorHandler = (error: Error) => void | Promise<void>
type StateChangeHandler = (newState: string) => void | Promise<void>
type AuthRequiredHandler = (info: AuthRequiredInfo) => void | Promise<void>

export class WhatsAppChannel implements MessageChannel {
  private client: Client
  private channelId: string
  private messageHandlers: MessageHandler[] = []
  private readyHandlers: ReadyHandler[] = []
  private disconnectedHandlers: DisconnectedHandler[] = []
  private authFailureHandlers: AuthFailureHandler[] = []
  private connectionErrorHandlers: ConnectionErrorHandler[] = []
  private stateChangeHandlers: StateChangeHandler[] = []
  private authRequiredHandlers: AuthRequiredHandler[] = []
  private isConnected: boolean = false
  private phoneNumber?: string
  private dedupCache = new Set<string>()
  private dedupInterval?: ReturnType<typeof setInterval>

  constructor(clientId: string) {
    this.channelId = clientId
    this.client = new Client(getClientOptions(clientId))
    this.setupEventListeners()

    this.dedupInterval = setInterval(() => {
      this.dedupCache.clear()
    }, 30_000)
  }

  private get logger() {
    return getLogger()
  }

  private setupEventListeners(): void {
    this.client.on('ready', () => {
      this.isConnected = true
      if (this.client.info?.wid) {
        this.phoneNumber = widToPhoneNumber(this.client.info.wid._serialized)
      }
      this.readyHandlers.forEach(handler => handler())
    })

    this.client.on('message', async msg => {
      const rawId = msg.id?._serialized
      this.logger.debug(`Raw message: id=${rawId} from="${msg.from}" to="${msg.to}" type="${msg.type}" body="${msg.body}" hasMedia=${msg.hasMedia} fromMe=${msg.fromMe}`)
      if (rawId) {
        if (this.dedupCache.has(rawId)) {
          this.logger.debug(`Skipping duplicate message ${rawId}`)
          return
        }
        this.dedupCache.add(rawId)
      }

      const domainMessage = toDomainMessage(msg)

      if (msg.from.includes('@lid')) {
        try {
          const contact = await msg.getContact()
          const result = await this.client.getContactLidAndPhone([contact.id._serialized])
          if (result && result[0]?.pn) {
            domainMessage.from = normalizePhoneNumber(result[0].pn)
          }
          domainMessage.senderName = contact.pushname || contact.name || contact.shortName
        } catch (err: any) {
          this.logger.debug(`LID resolution failed: ${err.message}`)
        }
      } else {
        try {
          const contact = await msg.getContact()
          domainMessage.senderName = contact.pushname || contact.name || contact.shortName
        } catch (err: any) {
          this.logger.debug(`Contact resolution failed: ${err.message}`)
        }
      }

      this.messageHandlers.forEach(handler => handler(domainMessage))
    })

    this.client.on('disconnected', reason => {
      this.isConnected = false
      this.disconnectedHandlers.forEach(handler => handler(reason))
    })

    this.client.on('qr', (qr: string) => {
      this.logger.info(`qr auth required for channel ${this.channelId}`)
      const info: AuthRequiredInfo = {
        channelId: this.channelId,
        method: 'qr',
        data: qr,
      }
      this.authRequiredHandlers.forEach(handler => handler(info))
    })

    this.client.on('auth_failure', (msg: any) => {
      const error = new Error(typeof msg === 'string' ? msg : 'Authentication failed')
      this.authFailureHandlers.forEach(handler => handler(error))
    })

    this.client.on('connection_error', (error: Error) => {
      this.connectionErrorHandlers.forEach(handler => handler(error))
    })

    this.client.on('change_state', state => {
      const domainState = this.mapWhatsAppState(state)
      this.stateChangeHandlers.forEach(handler => handler(domainState))
    })
  }

  private mapWhatsAppState(state: any): string {
    switch (state) {
      case WhatsAppConnectionState.CONNECTED:
        return 'connected'
      case WhatsAppConnectionState.CONNECTING:
        return 'connecting'
      case WhatsAppConnectionState.DISCONNECTED:
        return 'disconnected'
      case WhatsAppConnectionState.AUTHENTICATING:
        return 'authenticating'
      default:
        return 'unknown'
    }
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      throw new Error('Channel is already connected')
    }
    await this.client.initialize()
  }

  async disconnect(): Promise<void> {
    if (this.dedupInterval) {
      clearInterval(this.dedupInterval)
    }
    if (this.client) {
      await this.client.destroy()
      this.isConnected = false
    }
  }

  async send(message: OutgoingMessage): Promise<string> {
    if (!this.isConnected) {
      throw new Error('Channel is not connected')
    }

    const whatsappMsg = toWhatsAppFormat(message)
    this.logger.debug(`WhatsApp send options: ${JSON.stringify(whatsappMsg.options, null, 2)}`)

    try {
      if (whatsappMsg.options?.type === 'location') {
        const { latitude, longitude, name, address, url, description } = whatsappMsg.options as Record<string, any>
        const locationInstance = new Location(latitude, longitude, { name, address, url, description } as any)
        const { type: _t, latitude: _la, longitude: _lo, name: _n, address: _a, url: _u, description: _d, ...rest } = whatsappMsg.options as Record<string, any>
        const result = await this.client.sendMessage(whatsappMsg.to, locationInstance, rest)
        return result?.id?._serialized ?? generateMessageId()
      }

      const result = await this.client.sendMessage(
        whatsappMsg.to,
        whatsappMsg.content,
        whatsappMsg.options
      )

      return result?.id?._serialized ?? generateMessageId()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('detached Frame')) {
        this.isConnected = false
        this.disconnectedHandlers.forEach(h => h('Frame detached'))
      }
      throw error
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler)
  }

  onReady(handler: ReadyHandler): void {
    if (this.isConnected) {
      handler()
    } else {
      this.readyHandlers.push(handler)
    }
  }

  onDisconnected(handler: DisconnectedHandler): void {
    this.disconnectedHandlers.push(handler)
  }

  onAuthFailure(handler: AuthFailureHandler): void {
    this.authFailureHandlers.push(handler)
  }

  onConnectionError(handler: ConnectionErrorHandler): void {
    this.connectionErrorHandlers.push(handler)
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateChangeHandlers.push(handler)
  }

  onAuthRequired(handler: AuthRequiredHandler): void {
    this.authRequiredHandlers.push(handler)
  }

  getPhone(): string | undefined {
    return this.phoneNumber
  }
}

export class WhatsAppInitializer {
  private client: Client
  private qrHandler?: (qr: string) => void
  private successHandler?: (phoneNumber: string) => void
  private failureHandler?: (error: Error) => void
  private authSuccessFired: boolean = false

  constructor(clientId: string) {
    this.client = new Client(getClientOptions(clientId))
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    this.client.on('qr', (qr: string) => {
      if (this.qrHandler) {
        this.qrHandler(qr)
      }
    })

    this.client.on('ready', async () => {
      if (this.authSuccessFired) return
      this.authSuccessFired = true
      try {
        const info = this.client.info
        const phoneNumber = widToPhoneNumber(info.wid._serialized)

        if (this.successHandler) {
          this.successHandler(phoneNumber)
        }
      } catch (error) {
        if (this.failureHandler) {
          this.failureHandler(new Error('Failed to get phone number after authentication'))
        }
      }
    })

    this.client.on('auth_failure', (error: any) => {
      if (this.failureHandler) {
        const errorObj = error instanceof Error ? error : new Error(String(error))
        this.failureHandler(errorObj)
      }
    })
  }

  async initialize(): Promise<void> {
    await this.client.initialize()
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.destroy()
    }
  }

  onQRCode(handler: (qr: string) => void): void {
    this.qrHandler = handler
  }

  onAuthSuccess(handler: (phoneNumber: string) => void): void {
    this.successHandler = handler
  }

  onAuthFailure(handler: (error: Error) => void): void {
    this.failureHandler = handler
  }
}
