import { mapActionCatalog, mapGraphCatalog, mapConfigToBot, mapSettings, mapBotsFromConfig } from '../../../src/config/mapper'
import { BotConfig, BotSettingsConfig, ActionConfig, GraphConfig } from '../../../src/config/schema'

describe('Mapper', () => {
  describe('mapActionCatalog', () => {
    it('should map simple message step', () => {
      const config: Record<string, ActionConfig> = {
        greet: { steps: [{ message: { body: 'Hello!' } }] },
      }

      const catalog = mapActionCatalog(config)

      expect(catalog.has('greet')).toBe(true)
      const action = catalog.get('greet')!
      expect(action.steps).toHaveLength(1)
      expect('message' in action.steps[0]).toBe(true)
      expect((action.steps[0] as any).message.body).toBe('Hello!')
    })

    it('should map request steps with defaults', () => {
      const config: Record<string, ActionConfig> = {
        notify: {
          steps: [{
            request: {
              url: 'https://example.com/notify',
            },
          }],
        },
      }

      const catalog = mapActionCatalog(config)

      const action = catalog.get('notify')!
      const step = action.steps[0] as any
      expect(step.request.url).toBe('https://example.com/notify')
      expect(step.request.method).toBe('POST')
      expect(step.request.timeout).toBe(5000)
      expect(step.request.retries).toBe(3)
      expect(step.request.headers).toEqual({})
    })

    it('should map composite pipeline (message + request)', () => {
      const config: Record<string, ActionConfig> = {
        escalate: {
          steps: [
            { message: { body: 'Connecting you to a human.' } },
            {
              request: {
                name: 'escalate',
                url: 'https://example.com/escalate',
                method: 'POST',
                headers: { Authorization: 'Bearer token' },
                timeout: 10000,
                retry: 5,
              },
            },
          ],
        },
      }

      const catalog = mapActionCatalog(config)

      const action = catalog.get('escalate')!
      expect(action.steps).toHaveLength(2)
      expect((action.steps[0] as any).message.body).toBe('Connecting you to a human.')
      expect((action.steps[1] as any).request.name).toBe('escalate')
      expect((action.steps[1] as any).request.retries).toBe(5)
    })

    it('should throw if action has no steps and no on_blocked', () => {
      const config: Record<string, ActionConfig> = {
        empty: {},
      }

      expect(() => mapActionCatalog(config)).toThrow('Action "empty" must define steps or a cooldown guard with on_blocked')
    })

    it('should map location-only action', () => {
      const config: Record<string, ActionConfig> = {
        send_store: {
          steps: [{
            location: {
              latitude: 19.4326,
              longitude: -99.1332,
              name: 'Store',
              address: 'Reforma 123',
              url: 'https://maps.example.com/store',
              description: 'Open Mon-Fri',
            },
          }],
        },
      }

      const catalog = mapActionCatalog(config)

      const action = catalog.get('send_store')!
      expect(action.steps).toHaveLength(1)
      expect((action.steps[0] as any).location).toEqual({
        latitude: 19.4326,
        longitude: -99.1332,
        name: 'Store',
        address: 'Reforma 123',
        url: 'https://maps.example.com/store',
        description: 'Open Mon-Fri',
      })
    })

    it('should map composite pipeline (message + location)', () => {
      const config: Record<string, ActionConfig> = {
        send_office: {
          steps: [
            { message: { body: 'Here is our office.' } },
            {
              location: {
                latitude: 19.4326,
                longitude: -99.1332,
              },
            },
          ],
        },
      }

      const catalog = mapActionCatalog(config)

      const action = catalog.get('send_office')!
      expect((action.steps[0] as any).message.body).toBe('Here is our office.')
      expect((action.steps[1] as any).location.latitude).toBe(19.4326)
      expect((action.steps[1] as any).location.longitude).toBe(-99.1332)
    })

    it('should map a cooldown guard with on_blocked pipeline', () => {
      const config: Record<string, ActionConfig> = {
        escalate: {
          guards: {
            cooldown: {
              duration: 120,
              on_blocked: [
                { message: { body: 'Please wait before requesting again.' } },
              ],
            },
          },
          steps: [
            { message: { body: 'Escalating...' } },
          ],
        },
      }

      const catalog = mapActionCatalog(config)
      const action = catalog.get('escalate')!

      expect(action.guards?.cooldown?.duration).toBe(120)
      expect(action.guards?.cooldown?.onBlocked).toHaveLength(1)
      expect((action.guards?.cooldown?.onBlocked![0] as any).message.body).toBe('Please wait before requesting again.')
    })
  })

  describe('mapSettings', () => {
    it('should map settings with default values', () => {
      const config: BotSettingsConfig = {}
      const settings = mapSettings(config)

      expect(settings.simulateTyping).toBe(true)
      expect(settings.typingDelay).toBe(1000)
      expect(settings.queueDelay).toBe(1000)
      expect(settings.readReceipts).toBe(true)
      expect(settings.ignoreGroups).toBe(true)
      expect(settings.ignoredSenders).toEqual([])
    })

    it('should map settings with custom values', () => {
      const config: BotSettingsConfig = {
        simulate_typing: false,
        typing_delay: 500,
        queue_delay: 2000,
        read_receipts: false,
        ignore_groups: false,
        ignored_senders: ['1111111111', '2222222222'],
      }

      const settings = mapSettings(config)

      expect(settings.simulateTyping).toBe(false)
      expect(settings.typingDelay).toBe(500)
      expect(settings.queueDelay).toBe(2000)
      expect(settings.readReceipts).toBe(false)
      expect(settings.ignoreGroups).toBe(false)
      expect(settings.ignoredSenders).toEqual(['1111111111', '2222222222'])
    })
  })

  describe('mapConfigToBot', () => {
    it('should map minimal bot configuration', () => {
      const bot = mapConfigToBot('test-bot', {})

      expect(bot.id).toBe('test-bot')
      expect(bot.graph).toBe('')
    })

    it('should map bot with graph reference', () => {
      const bot = mapConfigToBot('graph-bot', { graph: 'faq-menu' })

      expect(bot.graph).toBe('faq-menu')
    })

    it('should map complete bot configuration', () => {
      const bot = mapConfigToBot('complete-bot', {
        graph: 'faq-menu',
        settings: {
          simulate_typing: true,
          typing_delay: 1500,
          queue_delay: 1000,
          read_receipts: true,
          ignore_groups: false,
          ignored_senders: ['spam@broadcast'],

        },
      })

      expect(bot.id).toBe('complete-bot')
      expect(bot.graph).toBe('faq-menu')
      expect(bot.settings.ignoreGroups).toBe(false)
    })

    it('should map bot with webhooks config', () => {
      const bot = mapConfigToBot('webhook-bot', {
        graph: 'faq-menu',
        webhooks: {
          url: 'https://example.com/api/botforge',
          headers: {
            'X-API-Key': 'secret',
            Authorization: 'Bearer token',
          },
        },
      })

      expect(bot.webhooks).toEqual({
        url: 'https://example.com/api/botforge',
        headers: {
          'X-API-Key': 'secret',
          Authorization: 'Bearer token',
        },
      })
    })

    it('should leave webhooks undefined when not configured', () => {
      const bot = mapConfigToBot('plain-bot', { graph: 'faq-menu' })

      expect(bot.webhooks).toBeUndefined()
    })

    it('should throw error for invalid bot ID', () => {
      expect(() => mapConfigToBot('ab', {})).toThrow('Bot ID must be at least 3 characters long')
    })

    it('should throw error for empty bot name', () => {
      expect(() => mapConfigToBot('', {})).toThrow('Bot ID must be at least 3 characters long')
    })
  })

  describe('mapBotsFromConfig', () => {
    it('should map multiple bot configurations', () => {
      const configs: Record<string, BotConfig> = {
        'bot-1': {},
        'bot-2': {},
        'bot-3': {},
      }

      const bots = mapBotsFromConfig(configs)

      expect(bots).toHaveLength(3)
      expect(bots[0].id).toBe('bot-1')
      expect(bots[1].id).toBe('bot-2')
      expect(bots[2].id).toBe('bot-3')
    })

    it('should return empty array for empty input', () => {
      const bots = mapBotsFromConfig({})
      expect(bots).toHaveLength(0)
    })
  })

  describe('mapGraphCatalog', () => {
    it('should map a simple graph with edges', () => {
      const config: Record<string, GraphConfig> = {
        'faq-menu': {
          root: 'menu',
          timeout: 300,
          fallback: 'invalid',
          nodes: {
            menu: {
              action: 'greet',
              edges: [
                { match: '1, horario', goto: 'hours' },
                { match: '2, precio', goto: 'prices' },
                { goto: 'invalid' },
              ],
            },
            hours: {
              action: 'hours-info',
              edges: [
                { match: 'menu, volver', goto: 'menu' },
              ],
            },
            prices: {
              action: 'prices-info',
              edges: [],
            },
            invalid: {
              action: 'invalid-option',
              edges: [
                { goto: 'menu' },
              ],
            },
          },
        },
      }

      const catalog = mapGraphCatalog(config)
      const graph = catalog.get('faq-menu')

      expect(graph).toBeDefined()
      expect(graph?.root).toBe('menu')
      expect(graph?.timeout).toBe(300)
      expect(graph?.fallbackNode).toBe('invalid')

      expect(graph?.nodes.menu.action).toBe('greet')
      expect(graph?.nodes.menu.edges).toHaveLength(3)
      expect(graph?.nodes.menu.edges[0].goto).toBe('hours')
      expect(graph?.nodes.menu.edges[2].match).toBeUndefined()

      expect(graph?.nodes.prices.edges).toHaveLength(0)
    })

    it('should map edge with match as string array', () => {
      const config: Record<string, GraphConfig> = {
        test: {
          root: 'start',
          nodes: {
            start: {
              action: 'greet',
              edges: [
                { match: ['1', 'one'], goto: 'option1' },
              ],
            },
            option1: {
              action: 'greet',
              edges: [],
            },
          },
        },
      }

      const catalog = mapGraphCatalog(config)
      const graph = catalog.get('test')

      expect(graph?.nodes.start.edges[0].match).toEqual(['1', 'one'])
    })

    it('should handle node without edges field', () => {
      const config: Record<string, GraphConfig> = {
        test: {
          root: 'start',
          nodes: {
            start: {
              action: 'greet',
            },
          },
        },
      }

      const catalog = mapGraphCatalog(config)
      const graph = catalog.get('test')

      expect(graph?.nodes.start.edges).toEqual([])
    })

    it('should throw if root node does not exist', () => {
      const config: Record<string, GraphConfig> = {
        broken: {
          root: 'missing',
          nodes: {},
        },
      }

      expect(() => mapGraphCatalog(config)).toThrow('Graph "broken" root node "missing" not found')
    })

    it('should throw if fallback node does not exist', () => {
      const config: Record<string, GraphConfig> = {
        broken: {
          root: 'start',
          fallback: 'missing',
          nodes: {
            start: {
              action: 'greet',
              edges: [],
            },
          },
        },
      }

      expect(() => mapGraphCatalog(config)).toThrow('Graph "broken" fallback node "missing" not found')
    })
  })
})
