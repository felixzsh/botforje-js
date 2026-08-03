import { MessageChannel } from './messages/contracts'
import { validateId } from './config/validation'

export interface Bot {
  id: string
  phone?: string
  settings: BotSettings
  graph: string
  webhookBaseUrl?: string
  webhookHeaders?: Record<string, string>
  channel?: MessageChannel
}

export interface BotSettings {
  simulateTyping: boolean
  typingDelay: number
  queueDelay: number
  readReceipts: boolean
  ignoreGroups: boolean
  allowedSenders: string[]
  ignoredSenders: string[]
}

export function createBot(props: {
  id: string
  phone?: string
  settings: BotSettings
  graph?: string
  webhookBaseUrl?: string
  webhookHeaders?: Record<string, string>
}): Bot {
  validateId(props.id, 'Bot')

  return {
    id: props.id,
    phone: props.phone,
    settings: props.settings,
    graph: props.graph || '',
    webhookBaseUrl: props.webhookBaseUrl,
    webhookHeaders: props.webhookHeaders,
  }
}

export function registerChannel(bot: Bot, channel: MessageChannel): Bot {
  bot.channel = channel
  return bot
}

export function createDefaultSettings(): BotSettings {
  // TODO: simulateTyping, typingDelay, readReceipts are reserved for future implementation
  return {
    simulateTyping: true,
    typingDelay: 1000,
    queueDelay: 1000,
    readReceipts: true,
    ignoreGroups: true,
    allowedSenders: [],
    ignoredSenders: [],
  }
}
