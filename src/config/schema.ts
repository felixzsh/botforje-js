export type HttpHeaders = Record<string, string>

export interface BotSettingsConfig {
  simulate_typing?: boolean
  typing_delay?: number
  queue_delay?: number
  read_receipts?: boolean
  ignore_groups?: boolean
  allowed_senders?: string[]
  ignored_senders?: string[]
}

export interface WebhookConfig {
  url?: string
  headers?: HttpHeaders
}

export interface BotConfig {
  graph?: string
  settings?: BotSettingsConfig
  webhooks?: WebhookConfig
}

export interface RequestStepConfig {
  name?: string
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  headers?: HttpHeaders
  timeout?: number
  retry?: number
}

export interface LocationActionConfig {
  latitude: number
  longitude: number
  name?: string
  address?: string
  url?: string
  description?: string
}

export interface ActionMessageConfig {
  body: string
  to?: string
}

export interface ActionStepConfig {
  message?: ActionMessageConfig
  request?: RequestStepConfig
  location?: LocationActionConfig
}

export interface ActionCooldownGuardConfig {
  duration: number
  on_blocked?: ActionStepConfig[]
}

export interface ActionGuardsConfig {
  cooldown?: ActionCooldownGuardConfig
}

export interface ActionConfig {
  guards?: ActionGuardsConfig
  steps?: ActionStepConfig[]
}

export interface EdgeConfig {
  match?: string | string[]
  fuzzy_threshold?: number
  goto: string
}

export interface NodeConfig {
  action: string
  edges?: EdgeConfig[]
}

export interface GraphConfig {
  root: string
  timeout?: number
  fallback?: string
  nodes: Record<string, NodeConfig>
}

export interface ConfigFile {
  chromium_path?: string
  log_level?: 'info' | 'debug' | 'warn' | 'error'
  port?: number
  trusted_issuers?: string[]
  address?: string
  default_timeout?: number
  actions?: Record<string, ActionConfig>
  graphs?: Record<string, GraphConfig>
  bots: Record<string, BotConfig>
}
