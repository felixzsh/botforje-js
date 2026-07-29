jest.mock('whatsapp-web.js', () => {
  class Location {
    latitude: number
    longitude: number
    name?: string
    address?: string
    url?: string
    description?: string

    constructor(latitude: number, longitude: number, options: any = {}) {
      this.latitude = latitude
      this.longitude = longitude
      this.name = options.name
      this.address = options.address
      this.url = options.url
      this.description = options.name && options.address
        ? `${options.name}\n${options.address}`
        : options.name || options.address || ''
    }
  }

  return {
    Client: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      initialize: jest.fn(),
      destroy: jest.fn(),
      info: { wid: { _serialized: '521234567890@c.us' } },
      sendMessage: jest.fn().mockResolvedValue({ id: { _serialized: 'msg-1' } }),
    })),
    LocalAuth: jest.fn(),
    Location,
  }
})

import { Location, Client } from 'whatsapp-web.js'
import { WhatsAppChannel } from '../../../src/whatsapp/client'
import { OutgoingMessage } from '../../../src/messages/contracts'

const mockedClient = Client as unknown as jest.Mock

describe('WhatsAppChannel', () => {
  beforeEach(() => {
    mockedClient.mockClear()
  })

  async function createReadyChannel(): Promise<WhatsAppChannel> {
    const channel = new WhatsAppChannel('test-bot')
    ;(channel as any).isConnected = true
    return channel
  }

  it('should send text content as a string', async () => {
    const channel = await createReadyChannel()
    const message: OutgoingMessage = {
      to: '521234567890',
      content: 'Hello!',
    }

    const id = await channel.send(message)

    expect(id).toBe('msg-1')
    const clientInstance = mockedClient.mock.results[0].value
    expect(clientInstance.sendMessage).toHaveBeenCalledWith(
      '521234567890@c.us',
      'Hello!',
      undefined
    )
  })

  it('should build a Location when metadata.type is "location"', async () => {
    const channel = await createReadyChannel()
    const message: OutgoingMessage = {
      to: '521234567890',
      content: '',
      metadata: {
        type: 'location',
        latitude: 19.4326,
        longitude: -99.1332,
        name: 'Main Office',
        address: 'Av. Reforma 123',
        url: 'https://maps.example.com/office',
        description: 'Open Mon-Fri',
      },
    }

    await channel.send(message)

    const clientInstance = mockedClient.mock.results[0].value
    const callArgs = clientInstance.sendMessage.mock.calls[0]
    const [to, content, options] = callArgs

    expect(to).toBe('521234567890@c.us')
    expect(content).toBeInstanceOf(Location)
    expect(content.latitude).toBe(19.4326)
    expect(content.longitude).toBe(-99.1332)
    expect(content.name).toBe('Main Office')
    expect(content.address).toBe('Av. Reforma 123')
    expect(content.url).toBe('https://maps.example.com/office')
    expect(options).not.toHaveProperty('type')
    expect(options).not.toHaveProperty('latitude')
    expect(options).not.toHaveProperty('longitude')
  })

  it('should build a Location with minimal options', async () => {
    const channel = await createReadyChannel()
    const message: OutgoingMessage = {
      to: '521234567890',
      content: '',
      metadata: {
        type: 'location',
        latitude: 0,
        longitude: 0,
      },
    }

    await channel.send(message)

    const clientInstance = mockedClient.mock.results[0].value
    const content = clientInstance.sendMessage.mock.calls[0][1]

    expect(content).toBeInstanceOf(Location)
    expect(content.latitude).toBe(0)
    expect(content.longitude).toBe(0)
  })

  it('should not treat unrelated metadata.type as a location', async () => {
    const channel = await createReadyChannel()
    const message: OutgoingMessage = {
      to: '521234567890',
      content: 'Hi',
      metadata: { type: 'text', foo: 'bar' },
    }

    await channel.send(message)

    const clientInstance = mockedClient.mock.results[0].value
    expect(clientInstance.sendMessage).toHaveBeenCalledWith(
      '521234567890@c.us',
      'Hi',
      { type: 'text', foo: 'bar' }
    )
  })

  describe('detached frame handling', () => {
    async function createChannelWithMockedSend(rejectWith: Error): Promise<{ channel: WhatsAppChannel, disconnectedSpy: jest.Mock }> {
      const channel = new WhatsAppChannel('test-bot')
      ;(channel as any).isConnected = true
      const clientInstance = mockedClient.mock.results[0].value
      clientInstance.sendMessage.mockRejectedValue(rejectWith)
      const disconnectedSpy = jest.fn()
      channel.onDisconnected(disconnectedSpy)
      return { channel, disconnectedSpy }
    }

    it('should set isConnected to false on detached frame error', async () => {
      const { channel } = await createChannelWithMockedSend(new Error('Attempted to use detached Frame \'ABCD1234\'.'))
      const message: OutgoingMessage = { to: '521234567890', content: 'Hi' }

      await expect(channel.send(message)).rejects.toThrow('detached Frame')
      expect((channel as any).isConnected).toBe(false)
    })

    it('should fire disconnected handlers on detached frame error', async () => {
      const { channel, disconnectedSpy } = await createChannelWithMockedSend(new Error('Attempted to use detached Frame \'ABCD1234\'.'))
      const message: OutgoingMessage = { to: '521234567890', content: 'Hi' }

      await expect(channel.send(message)).rejects.toThrow('detached Frame')
      expect(disconnectedSpy).toHaveBeenCalledWith('Frame detached')
    })

    it('should not change isConnected on non-frame errors', async () => {
      const { channel } = await createChannelWithMockedSend(new Error('Some other error'))
      const message: OutgoingMessage = { to: '521234567890', content: 'Hi' }

      await expect(channel.send(message)).rejects.toThrow('Some other error')
      expect((channel as any).isConnected).toBe(true)
    })
  })
})
