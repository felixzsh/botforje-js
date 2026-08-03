import { Bot, BotSettings, createBot, createDefaultSettings } from '../bot'
import { validateId, validateTypingDelay, validateQueueDelay } from './validation'
import { BotConfig, BotSettingsConfig, ActionConfig, ActionStepConfig, ActionMessageConfig, ActionGuardsConfig, RequestStepConfig, LocationActionConfig, GraphConfig, NodeConfig, EdgeConfig } from './schema'
import { ActionDef, ActionCatalog, LocationAction, ActionStep, MessageStep, CooldownGuard } from '../actions/action'
import { GraphCatalog, GraphDef, Node, Edge } from '../graph/graph'

export function mapActionCatalog(config: Record<string, ActionConfig>): ActionCatalog {
  const catalog: ActionCatalog = new Map()

  for (const [id, actionConfig] of Object.entries(config)) {
    catalog.set(id, mapAction(id, actionConfig))
  }

  return catalog
}

function mapAction(id: string, config: ActionConfig): ActionDef {
  const hasSteps = (config.steps?.length ?? 0) > 0
  const hasOnBlocked = (config.guards?.cooldown?.on_blocked?.length ?? 0) > 0

  if (!hasSteps && !hasOnBlocked) {
    throw new Error(`Action "${id}" must define steps or a cooldown guard with on_blocked`)
  }

  return {
    id,
    guards: config.guards ? mapGuards(config.guards) : undefined,
    steps: (config.steps ?? []).map(mapStep),
  }
}

function mapStep(config: ActionStepConfig): ActionStep {
  if (config.message) return { message: mapMessage(config.message) }
  if (config.request) return { request: mapRequestStep(config.request) }
  return { location: mapLocationAction(config.location!) }
}

function mapMessage(config: ActionMessageConfig): MessageStep {
  return {
    body: config.body,
    to: config.to,
  }
}

function mapGuards(config: ActionGuardsConfig): { cooldown?: CooldownGuard } {
  const result: { cooldown?: CooldownGuard } = {}
  if (config.cooldown) {
    result.cooldown = {
      duration: config.cooldown.duration,
      onBlocked: config.cooldown.on_blocked?.map(mapStep),
    }
  }
  return result
}

function mapRequestStep(config: RequestStepConfig): {
  name?: string
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH'
  headers: Record<string, string>
  timeout: number
  retries: number
} {
  return {
    name: config.name,
    url: config.url,
    method: config.method ?? 'POST',
    headers: config.headers ?? {},
    timeout: config.timeout ?? 5000,
    retries: config.retry ?? 3,
  }
}

function mapLocationAction(config: LocationActionConfig): LocationAction {
  return {
    latitude: config.latitude,
    longitude: config.longitude,
    name: config.name,
    address: config.address,
    url: config.url,
    description: config.description,
  }
}

export function mapGraphCatalog(config: Record<string, GraphConfig>): GraphCatalog {
  const catalog: GraphCatalog = new Map()

  for (const [id, graphConfig] of Object.entries(config)) {
    catalog.set(id, mapGraph(id, graphConfig))
  }

  return catalog
}

function mapGraph(id: string, config: GraphConfig): GraphDef {
  if (!config.nodes[config.root]) {
    throw new Error(`Graph "${id}" root node "${config.root}" not found`)
  }

  const nodes: Record<string, Node> = {}
  for (const [nodeId, nodeConfig] of Object.entries(config.nodes)) {
    nodes[nodeId] = mapNode(nodeConfig)
  }

  if (config.fallback && !nodes[config.fallback]) {
    throw new Error(`Graph "${id}" fallback node "${config.fallback}" not found`)
  }

  return {
    id,
    root: config.root,
    timeout: config.timeout,
    fallbackNode: config.fallback,
    nodes,
  }
}

function mapNode(config: NodeConfig): Node {
  return {
    action: config.action,
    edges: (config.edges || []).map(mapEdge),
  }
}

function mapEdge(config: EdgeConfig): Edge {
  return {
    match: config.match ? mapMatch(config.match) : undefined,
    fuzzyThreshold: config.fuzzy_threshold,
    goto: config.goto,
  }
}

function mapMatch(match: string | string[]): string[] {
  if (typeof match === 'string') {
    return splitPhrases(match)
  }
  return match.flatMap(splitPhrases)
}

function splitPhrases(value: string): string[] {
  return value
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

export function mapBotsFromConfig(configs: Record<string, BotConfig>): Bot[] {
  return Object.entries(configs).map(([id, config]) => mapConfigToBot(id, config))
}

export function mapConfigToBot(id: string, config: BotConfig): Bot {
  validateId(id, 'Bot')

  const settings = config.settings ? mapSettings(config.settings) : createDefaultSettings()
  const graph = config.graph ?? ''

  return createBot({
    id,
    settings,
    graph,
    webhookBaseUrl: config.webhook_base_url,
    webhookHeaders: config.webhook_headers,
  })
}

export function mapSettings(config: BotSettingsConfig): BotSettings {
  if (config.typing_delay !== undefined) {
    validateTypingDelay(config.typing_delay)
  }
  if (config.queue_delay !== undefined) {
    validateQueueDelay(config.queue_delay)
  }

  return {
    simulateTyping: config.simulate_typing ?? true,
    typingDelay: config.typing_delay ?? 1000,
    queueDelay: config.queue_delay ?? 1000,
    readReceipts: config.read_receipts ?? true,
    ignoreGroups: config.ignore_groups ?? true,
    allowedSenders: (config.allowed_senders || []).map(String),
    ignoredSenders: (config.ignored_senders || []).map(String),
  }
}
