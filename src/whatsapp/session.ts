import { MessageChannel, SessionState, SessionEvent, SessionInfo } from '../messages/contracts'
import { WhatsAppChannel } from './client'
import { getLogger } from '../helpers/logger'

type SessionEventHandler = (event: SessionEvent) => void
type ReadyCallback = (channel: MessageChannel) => void

export class SessionManager {
  private static instance: SessionManager
  private channels: Map<string, WhatsAppChannel>
  private states: Map<string, SessionState>
  private qrData: Map<string, string>
  private phoneNumbers: Map<string, string>
  private errors: Map<string, string>
  private eventListeners: Map<string, Set<SessionEventHandler>>
  private readyCallbacks: Map<string, Set<ReadyCallback>>

  private constructor() {
    this.channels = new Map()
    this.states = new Map()
    this.qrData = new Map()
    this.phoneNumbers = new Map()
    this.errors = new Map()
    this.eventListeners = new Map()
    this.readyCallbacks = new Map()
  }

  private get logger() {
    return getLogger()
  }

  static getInstance(): SessionManager {
    if (!this.instance) {
      this.instance = new SessionManager()
    }
    return this.instance
  }

  createChannel(id: string): MessageChannel {
    if (this.channels.has(id)) {
      throw new Error(`Channel already exists for ID ${id}`)
    }

    const channel = new WhatsAppChannel(id)
    this.channels.set(id, channel)
    this.states.set(id, 'pending')
    return channel
  }

  getChannel(id: string): MessageChannel | undefined {
    return this.channels.get(id)
  }

  getAllChannels(): Map<string, MessageChannel> {
    return new Map(this.channels)
  }

  async removeChannel(id: string): Promise<void> {
    const channel = this.channels.get(id)
    if (channel) {
      await channel.disconnect()
      this.channels.delete(id)
      this.states.delete(id)
      this.qrData.delete(id)
      this.phoneNumbers.delete(id)
      this.errors.delete(id)
      this.eventListeners.delete(id)
      this.readyCallbacks.delete(id)
    }
  }

  async removeAllChannels(): Promise<void> {
    const ids = Array.from(this.channels.keys())
    await Promise.all(ids.map(id => this.removeChannel(id)))
  }

  getChannelCount(): number {
    return this.channels.size
  }

  hasChannel(id: string): boolean {
    return this.channels.has(id)
  }

  getSessionInfo(id: string): SessionInfo | undefined {
    if (!this.channels.has(id)) return undefined
    return {
      state: this.states.get(id) || 'pending',
      phone: this.phoneNumbers.get(id),
      lastQR: this.qrData.get(id),
      error: this.errors.get(id),
    }
  }

  getAllSessions(): Map<string, SessionInfo> {
    const result = new Map<string, SessionInfo>()
    for (const id of this.channels.keys()) {
      const info = this.getSessionInfo(id)
      if (info) result.set(id, info)
    }
    return result
  }

  async registerSession(id: string, force = false): Promise<void> {
    if (this.channels.has(id)) {
      if (!force && this.states.get(id) === 'connected') {
        throw new Error(`Session "${id}" is already authenticated`)
      }
      await this.removeChannel(id)
    }

    this.logger.info(`Registering session: ${id}`)

    const channel = new WhatsAppChannel(id)
    this.channels.set(id, channel)
    this.states.set(id, 'pending')

    channel.onAuthRequired((info) => {
      this.states.set(id, 'qr_received')
      if (info.data) this.qrData.set(id, info.data)
      this.logger.info(`qr auth required for session ${id}`)
      this.emitEvent(id, { type: 'qr', data: info.data })
    })

    channel.onReady(() => {
      this.states.set(id, 'connected')
      const phone = channel.getPhone()
      if (phone) this.phoneNumbers.set(id, phone)
      this.logger.info(`Session "${id}" connected`)
      this.emitEvent(id, { type: 'ready' })
      this.readyCallbacks.get(id)?.forEach(cb => cb(channel))
    })

    channel.onDisconnected((reason) => {
      this.states.set(id, 'disconnected')
      this.errors.set(id, reason)
      this.emitEvent(id, { type: 'disconnected', data: reason })
    })

    channel.onAuthFailure((error) => {
      this.states.set(id, 'auth_failure')
      this.errors.set(id, error.message)
      this.emitEvent(id, { type: 'auth_failure', data: error.message })
    })

    await channel.connect()
  }

  onSessionEvent(id: string, handler: SessionEventHandler): void {
    if (!this.eventListeners.has(id)) {
      this.eventListeners.set(id, new Set())
    }
    this.eventListeners.get(id)!.add(handler)
  }

  removeSessionEventListener(id: string, handler: SessionEventHandler): void {
    this.eventListeners.get(id)?.delete(handler)
  }

  onSessionReady(id: string, callback: ReadyCallback): void {
    if (!this.readyCallbacks.has(id)) {
      this.readyCallbacks.set(id, new Set())
    }
    this.readyCallbacks.get(id)!.add(callback)

    const state = this.states.get(id)
    if (state === 'connected') {
      const channel = this.channels.get(id)
      if (channel) callback(channel)
    }
  }

  removeSessionReadyCallback(id: string, callback: ReadyCallback): void {
    this.readyCallbacks.get(id)?.delete(callback)
  }

  private emitEvent(id: string, event: SessionEvent): void {
    this.eventListeners.get(id)?.forEach(handler => {
      try {
        handler(event)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.logger.error(`Session event handler error for ${id}: ${msg}`)
      }
    })
  }
}
