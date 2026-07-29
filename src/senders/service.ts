import { DatabaseSync } from 'node:sqlite'
import { getLogger } from '../helpers/logger'

export interface Sender {
  phone: string
  botId: string
  name: string | null
  firstSeen: number
  lastSeen: number
  messageCount: number
}

export class SenderService {
  private db: DatabaseSync

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath)
    this.initTable()
  }

  private get logger() {
    return getLogger()
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS senders (
        phone TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        name TEXT,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (phone, bot_id)
      )
    `)
  }

  recordMessage(botId: string, phone: string, name?: string): { isNew: boolean } {
    const now = Date.now()
    const existing = this.db.prepare(
      'SELECT phone, bot_id FROM senders WHERE phone = ? AND bot_id = ?'
    ).get(phone, botId)

    if (existing) {
      this.db.prepare(`
        UPDATE senders
        SET name = COALESCE(?, name), last_seen = ?, message_count = message_count + 1
        WHERE phone = ? AND bot_id = ?
      `).run(name || null, now, phone, botId)
      return { isNew: false }
    }

    this.db.prepare(`
      INSERT INTO senders (phone, bot_id, name, first_seen, last_seen, message_count)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(phone, botId, name || null, now, now)
    return { isNew: true }
  }

  getSenders(botId?: string, since?: number): Sender[] {
    let query = 'SELECT phone, bot_id, name, first_seen, last_seen, message_count FROM senders'
    const conditions: string[] = []
    const params: any[] = []

    if (botId) {
      conditions.push('bot_id = ?')
      params.push(botId)
    }
    if (since) {
      conditions.push('first_seen >= ?')
      params.push(since)
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ')
    }

    query += ' ORDER BY last_seen DESC'

    const stmt = this.db.prepare(query)
    return stmt.all(...params).map((row: any) => ({
      phone: row.phone,
      botId: row.bot_id,
      name: row.name,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      messageCount: row.message_count,
    }))
  }

  getSender(phone: string, botId: string): Sender | undefined {
    const row: any = this.db.prepare(
      'SELECT phone, bot_id, name, first_seen, last_seen, message_count FROM senders WHERE phone = ? AND bot_id = ?'
    ).get(phone, botId)

    if (!row) return undefined

    return {
      phone: row.phone,
      botId: row.bot_id,
      name: row.name,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      messageCount: row.message_count,
    }
  }

  close(): void {
    this.db.close()
  }
}
