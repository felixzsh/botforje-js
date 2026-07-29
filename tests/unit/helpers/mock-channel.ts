import { MessageChannel, IncomingMessage, OutgoingMessage, AuthRequiredInfo } from '../../../src/messages/contracts'

type MessageHandler = (message: IncomingMessage) => void | Promise<void>
type ReadyHandler = () => void | Promise<void>
type DisconnectedHandler = (reason: string) => void | Promise<void>
type AuthFailureHandler = (error: Error) => void | Promise<void>
type ConnectionErrorHandler = (error: Error) => void | Promise<void>
type StateChangeHandler = (newState: string) => void | Promise<void>
type AuthRequiredHandler = (info: AuthRequiredInfo) => void | Promise<void>

export class MockChannel implements MessageChannel {
  sentMessages: OutgoingMessage[] = []
  private messageHandlers: MessageHandler[] = []
  private readyHandlers: ReadyHandler[] = []
  private disconnectedHandlers: DisconnectedHandler[] = []
  private authFailureHandlers: AuthFailureHandler[] = []
  private connectionErrorHandlers: ConnectionErrorHandler[] = []
  private stateChangeHandlers: StateChangeHandler[] = []
  private authRequiredHandlers: AuthRequiredHandler[] = []
  connected: boolean = false
  phoneNumber: string = '521234567890'

  async send(message: OutgoingMessage): Promise<string> {
    this.sentMessages.push(message)
    return `mock-msg-${Date.now()}`
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler)
  }

  onReady(handler: ReadyHandler): void {
    this.readyHandlers.push(handler)
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

  async connect(): Promise<void> {
    this.connected = true
    this.readyHandlers.forEach(h => h())
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  getPhone(): string | undefined {
    return this.phoneNumber
  }

  async simulateMessage(message: IncomingMessage): Promise<void> {
    for (const h of this.messageHandlers) {
      await h(message)
    }
  }

  simulateReady(): void {
    this.readyHandlers.forEach(h => h())
  }

  simulateDisconnected(reason: string): void {
    this.disconnectedHandlers.forEach(h => h(reason))
  }

  simulateAuthFailure(error: Error): void {
    this.authFailureHandlers.forEach(h => h(error))
  }

  simulateConnectionError(error: Error): void {
    this.connectionErrorHandlers.forEach(h => h(error))
  }

  simulateStateChange(state: string): void {
    this.stateChangeHandlers.forEach(h => h(state))
  }

  simulateAuthRequired(info: AuthRequiredInfo): void {
    this.authRequiredHandlers.forEach(h => h(info))
  }

  getSentMessages(): OutgoingMessage[] {
    return this.sentMessages
  }

  clearSentMessages(): void {
    this.sentMessages = []
  }
}
