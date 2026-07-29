import { Bot } from '../bot'
import { OutgoingMessage } from './contracts'
import { getLogger } from '../helpers/logger'

export interface QueuedMessage {
  id: string
  botId: string
  message: OutgoingMessage
  timestamp: number
}

export type SendMessageCallback = (botId: string, message: OutgoingMessage) => Promise<void>

export class OutboxService {
  private queues: Map<string, QueuedMessage[]> = new Map()
  private processing: Map<string, boolean> = new Map()
  private delays: Map<string, number> = new Map()
  private sendCallbacks: Map<string, SendMessageCallback> = new Map()

  private get logger() {
    return getLogger()
  }

  setBotDelay(botId: string, delayMs: number): void {
    this.delays.set(botId, delayMs)
    this.logger.info(`Queue delay for bot "${botId}" set to ${delayMs}ms`)
  }

  setBotSendCallback(botId: string, callback: SendMessageCallback): void {
    this.sendCallbacks.set(botId, callback)
  }

  setupBotQueue(bot: Bot): void {
    const botId = bot.id

    this.setBotDelay(botId, bot.settings.queueDelay)

    this.setBotSendCallback(botId, async (botId: string, message: OutgoingMessage) => {
      await bot.channel!.send(message)
    })

    this.logger.info(`Configured message queue for bot "${bot.id}": delay=${bot.settings.queueDelay}ms`)
  }

  enqueue(
    botId: string,
    to: string,
    content: string,
    metadata?: Record<string, any>
  ): string {
    const messageId = `${botId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    this.logger.debug(`Queueing message for bot "${botId}" with metadata: ${JSON.stringify(metadata)}`)

    const outgoingMessage: OutgoingMessage = {
      to,
      content,
      metadata,
    }

    const queuedMessage: QueuedMessage = {
      id: messageId,
      botId,
      message: outgoingMessage,
      timestamp: Date.now(),
    }

    if (!this.queues.has(botId)) {
      this.queues.set(botId, [])
    }

    const botQueue = this.queues.get(botId)!

    botQueue.push(queuedMessage)

    this.logger.info(`Message queued for bot "${botId}": ${messageId} (queue size: ${botQueue.length})`)

    if (!this.processing.get(botId)) {
      this.startProcessing(botId)
    }

    return messageId
  }

  private async startProcessing(botId: string): Promise<void> {
    if (this.processing.get(botId)) {
      return
    }

    this.processing.set(botId, true)
    this.logger.info(`Started processing queue for bot "${botId}"`)

    const botQueue = this.queues.get(botId)
    if (!botQueue) {
      this.processing.set(botId, false)
      return
    }

    while (botQueue.length > 0) {
      const messageData = botQueue[0]
      const delay = this.delays.get(botId) || 2000

      try {
        this.logger.debug(`Waiting ${delay}ms before sending message ${messageData.id} from bot "${botId}"...`)
        await this.delay(delay)

        this.logger.info(`Processing queued message: ${messageData.id} from bot "${botId}"`)

        const callback = this.sendCallbacks.get(botId)
        if (callback) {
          await callback(botId, messageData.message)
          botQueue.shift()
          this.logger.info(`Queued message sent successfully: ${messageData.id}`)
        } else {
          this.logger.error(`No send callback configured for bot "${botId}"`)
        }

      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        this.logger.error(`Error sending queued message ${messageData.id} from bot "${botId}": ${msg}`)

        if (msg.includes('detached Frame') || msg.includes('Channel is not connected')) {
          this.logger.warn(`Connection lost for bot "${botId}", queue paused. Message ${messageData.id} kept for retry.`)
          break
        }

        botQueue.shift()
      }
    }

    this.processing.set(botId, false)
    this.logger.info(`Queue processing completed for bot "${botId}"`)
  }

  resumeProcessing(botId: string): void {
    const queue = this.queues.get(botId)
    if (queue && queue.length > 0 && !this.processing.get(botId)) {
      this.startProcessing(botId)
    }
  }

  getBotQueueStatus(botId: string): any {
    const queue = this.queues.get(botId) || []
    const isProcessing = this.processing.get(botId) || false
    const delay = this.delays.get(botId) || 2000

    return {
      botId,
      queueSize: queue.length,
      isProcessing,
      delayMs: delay,
      hasCallback: this.sendCallbacks.has(botId),
      nextMessage: queue.length > 0 ? {
        id: queue[0].id,
        to: queue[0].message.to,
        age: Date.now() - queue[0].timestamp,
      } : null,
    }
  }

  clearBotQueue(botId: string): void {
    this.queues.delete(botId)
    this.logger.info(`Queue cleared for bot "${botId}"`)
  }

  getAllQueuesStatus(): any {
    const allStatuses: any[] = []

    for (const [botId] of this.queues.entries()) {
      const status = this.getBotQueueStatus(botId)
      allStatuses.push(status)
    }

    return {
      totalQueues: allStatuses.length,
      queues: allStatuses,
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down outbox service...')

    for (const [botId] of this.processing.entries()) {
      this.processing.set(botId, false)
    }

    this.queues.clear()
    this.delays.clear()
    this.sendCallbacks.clear()

    this.logger.info('Outbox service shut down')
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
