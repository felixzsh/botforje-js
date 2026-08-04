import * as fs from 'fs'
import * as path from 'path'
import { loadConfig, getConfigPath } from './yaml'
import { BotFleet } from '../fleet'
import { mapActionCatalog, mapGraphCatalog, mapBotsFromConfig } from './mapper'
import { getLogger } from '../helpers/logger'

export class ConfigWatcher {
  private watcher: fs.FSWatcher | null = null
  private fleet: BotFleet
  private configDir: string
  private configPath: string
  private debounceTimer: NodeJS.Timeout | null = null
  private watching: boolean = false

  constructor(fleet: BotFleet, configPath?: string) {
    this.fleet = fleet
    this.configPath = configPath || getConfigPath()
    this.configDir = path.dirname(this.configPath)
  }

  private get logger() {
    return getLogger()
  }

  start(): void {
    if (this.watching) return

    try {
      this.watcher = fs.watch(this.configDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return
        const ext = path.extname(filename)
        if (ext !== '.yml' && ext !== '.yaml') return

        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        this.debounceTimer = setTimeout(() => {
          this.reload().catch(err => {
            const msg = err instanceof Error ? err.message : String(err)
            this.logger.error(`Config reload error: ${msg}`)
          })
        }, 500)
      })

      this.watching = true
      this.logger.info(`Config watcher started on ${this.configDir}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Failed to start config watcher: ${msg}`)
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.watching = false
  }

  isWatching(): boolean {
    return this.watching
  }

  async reload(): Promise<void> {
    try {
      this.logger.info('Reloading configuration...')

      const configFile = await loadConfig(this.configPath)
      const newActionCatalog = mapActionCatalog(configFile.actions || {})
      const newGraphCatalog = mapGraphCatalog(configFile.graphs || {})
      const loadedBots = mapBotsFromConfig(configFile.bots)

      this.fleet.reloadCatalogs(newActionCatalog, newGraphCatalog)

      const existingBots = this.fleet.getBots()
      const existingIds = new Set(existingBots.keys())
      const newIds = new Set(loadedBots.map(b => b.id))

      for (const bot of loadedBots) {
        if (!existingIds.has(bot.id)) {
          existingBots.set(bot.id, bot)
          this.fleet.getOutboxService().setupBotQueue(bot)
          this.logger.info(`New bot added via reload: ${bot.id}`)
          this.logger.debug(`  allowed_senders=[${bot.settings.allowedSenders.join(', ')}]`)
        } else {
          const existing = existingBots.get(bot.id)
          if (existing) {
            const graphChanged = existing.graph !== bot.graph
            existing.settings = bot.settings
            existing.graph = bot.graph
            this.fleet.getOutboxService().setupBotQueue(existing)
            if (graphChanged) {
              this.fleet.getGraphExecutor()?.clearBotSessions(bot.id)
              this.logger.info(`Graph changed for bot "${bot.id}" — active sessions cleared`)
            }
            this.logger.info(`Bot updated via reload: ${bot.id}`)
            this.logger.debug(`  allowed_senders=[${bot.settings.allowedSenders.join(', ')}]`)
          }
        }
      }

      for (const id of existingIds) {
        if (!newIds.has(id)) {
          const bot = existingBots.get(id)
          if (bot) {
            existingBots.delete(id)
            this.logger.info(`Bot removed via reload: ${id}`)
          }
        }
      }

      this.logger.info('Configuration reloaded successfully')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Failed to reload configuration: ${msg}`)
    }
  }
}
