import { Router } from 'express'
import { SenderService } from '../../senders/service'

export function createSendersRouter(senderService: SenderService): Router {
  const router = Router()

  router.get('/', (req, res) => {
    try {
      const botId = req.query.bot_id as string | undefined
      const since = req.query.since ? parseInt(req.query.since as string, 10) : undefined

      const senders = senderService.getSenders(botId, since)

      res.json({
        senders,
        total: senders.length,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: msg })
    }
  })

  router.get('/:phone', (req, res) => {
    try {
      const { phone } = req.params
      const botId = req.query.bot_id as string | undefined

      if (!botId) {
        return res.status(400).json({ error: 'bot_id query parameter is required' })
      }

      const sender = senderService.getSender(phone, botId)
      if (!sender) {
        return res.status(404).json({ error: 'Sender not found' })
      }

      res.json(sender)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: msg })
    }
  })

  return router
}
