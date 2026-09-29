import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { MailResponse } from '@adonisjs/mail'
import type { MailTransportContract, NodeMailerMessage } from '@adonisjs/mail/types'
import { createTransport } from 'nodemailer'

/**
 * Transport deweloperski „outbox”: zamiast wysyłać, zapisuje maile jako JSON
 * w `tmp/mail-outbox/` i loguje temat + linki. Domyślny, gdy nie skonfigurowano
 * SMTP — rejestracja i reset hasła działają lokalnie bez serwera pocztowego.
 * Podgląd: `/dev/mailbox` (tylko poza produkcją).
 */

export const OUTBOX_DIR = () => app.tmpPath('mail-outbox')

export interface OutboxMail {
  id: string
  to: string
  subject: string
  html: string
  text: string
  sentAt: string
}

function addresses(value: unknown): string {
  const list = Array.isArray(value) ? value : [value]
  return list
    .map((v) => (typeof v === 'string' ? v : ((v as { address?: string })?.address ?? '')))
    .filter(Boolean)
    .join(', ')
}

export class OutboxTransport implements MailTransportContract {
  #json = createTransport({ jsonTransport: true })

  async send(message: NodeMailerMessage) {
    const result = await this.#json.sendMail(message)
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const mail: OutboxMail = {
      id,
      to: addresses(message.to),
      subject: String(message.subject ?? ''),
      html: String(message.html ?? ''),
      text: String(message.text ?? ''),
      sentAt: new Date().toISOString(),
    }
    await mkdir(OUTBOX_DIR(), { recursive: true })
    await writeFile(join(OUTBOX_DIR(), `${id}.json`), JSON.stringify(mail, null, 2))
    const links = mail.text.match(/https?:\/\/\S+/g) ?? []
    logger.info({ to: mail.to, subject: mail.subject, links }, 'mail saved to outbox')
    return new MailResponse(result.messageId, result.envelope, result)
  }
}

export async function listOutbox(limit = 50): Promise<OutboxMail[]> {
  let files: string[] = []
  try {
    files = (await readdir(OUTBOX_DIR())).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  files.sort().reverse()
  const mails = await Promise.all(
    files
      .slice(0, limit)
      .map(async (f) => JSON.parse(await readFile(join(OUTBOX_DIR(), f), 'utf8')) as OutboxMail)
  )
  return mails
}
