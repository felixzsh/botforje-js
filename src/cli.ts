#!/usr/bin/env node

import { Command } from 'commander'
import * as path from 'path'
import * as fs from 'fs'
import { BotFleet } from './fleet'
import { OutboxService } from './messages/outbox'
import { ApiServer } from './api/server'
import { loadConfig, setConfigPath, getDefaultConfigPath } from './config/yaml'
import { ConfigWatcher } from './config/watcher'
import { setGlobalLogger, getLogger } from './helpers/logger'
import { setGlobalConfig } from './whatsapp/client'
import { runGuide } from './commands/guide'
import { runValidate } from './commands/validate'
import { runAuth } from './commands/auth'
import { runStatus } from './commands/status'
import { runLock } from './commands/lock'
import { runUnlock } from './commands/unlock'

const packageJsonPath = path.join(__dirname, '..', 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

const program = new Command()

program
  .name('botforje-js')
  .description('CLI tool for creating and managing WhatsApp bots')
  .version(packageJson.version)
  .option('-c, --config <path>', `Path to config file (default: ${getDefaultConfigPath()})`)

program
  .command('guide')
  .description('Show AI agent configuration guide')
  .action(() => runGuide())

program
  .command('validate')
  .description('Validate bot configuration')
  .action(() => runValidate(program.opts().config))

program
  .command('daemon')
  .alias('start')
  .description('Start the WhatsApp bot daemon')
  .action(async () => {
    await runDaemon(program.opts().config)
  })

program
  .command('auth')
  .description('Authenticate a bot session via QR code')
  .argument('<botId>', 'Bot ID to authenticate')
  .action(async (botId) => {
    await runAuth(botId, program.opts().config)
  })

program
  .command('lock')
  .description('Enable API auth protection and generate a key')
  .option('-k, --key <value>', 'Supply your own key (32+ characters)')
  .action(async (options) => {
    await runLock(options.key, program.opts().config)
  })

program
  .command('unlock')
  .description('Disable API auth protection')
  .option('-k, --key <value>', 'Current auth key (will prompt if omitted)')
  .action(async (options) => {
    await runUnlock(options.key, program.opts().config)
  })

program
  .command('status')
  .description('Show all bots and their session status')
  .action(async () => {
    await runStatus(program.opts().config)
  })

async function runDaemon(configPath?: string) {
  if (configPath) setConfigPath(configPath)
  const configFile = await loadConfig(configPath)

  if (configFile) {
    setGlobalLogger(configFile)
    setGlobalConfig(configFile)
  }

  const logger = getLogger()
  logger.info('Botforje-js - Starting bots...')

  const outboxService = new OutboxService()
  const fleet = new BotFleet(outboxService)

  const configWatcher = new ConfigWatcher(fleet)
  configWatcher.start()

  const bots = await fleet.start(configFile)

  const address = configFile?.address || '127.0.0.1'
  const authService = fleet.getAuthService()

  if (address !== '127.0.0.1' && !authService.isLocked()) {
    logger.warn('API is exposed on a non-local address. Run `botforje-js lock` to enable auth protection.')
  }

  if (configFile?.port) {
    const apiPort = configFile.port
    const senderService = fleet.getSenderService()
    const apiServer = new ApiServer(outboxService, bots, authService, apiPort, fleet, configWatcher, address, senderService)
    await apiServer.start()
  }

  logger.info('Botforje-js Daemon is running')
}

program.parse()
