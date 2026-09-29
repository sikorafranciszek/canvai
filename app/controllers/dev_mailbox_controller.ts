import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import { listOutbox } from '#services/mail_outbox'

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/**
 * Podgląd lokalnej skrzynki (transport `outbox`) — tylko poza produkcją.
 * Pozwala przejść rejestrację i reset hasła bez serwera pocztowego.
 */
export default class DevMailboxController {
  async index({ response, request }: HttpContext) {
    if (app.inProduction) return response.notFound()
    const mails = await listOutbox()
    const selected = mails.find((m) => m.id === request.qs().id) ?? mails[0]
    const list = mails
      .map(
        (m) =>
          `<a href="?id=${encodeURIComponent(m.id)}" style="display:block;padding:10px 12px;border-bottom:1px solid #e6e3dd;text-decoration:none;color:#27251e;${m === selected ? 'background:#01697114;' : ''}"><div style="font-size:13px;font-weight:500">${escape(m.subject)}</div><div style="font-size:12px;color:#72706b">${escape(m.to)} · ${escape(new Date(m.sentAt).toLocaleString())}</div></a>`
      )
      .join('')
    const body = selected
      ? `<iframe title="mail" sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" srcdoc="${escape(selected.html)}" style="border:0;width:100%;height:100%"></iframe>`
      : '<p style="padding:24px;color:#72706b">Outbox is empty.</p>'
    response.header('Content-Type', 'text/html; charset=utf-8')
    return `<!doctype html><html><head><meta charset="utf-8"><title>Dev mailbox</title></head><body style="margin:0;font-family:system-ui,sans-serif;background:#faf8f5;display:grid;grid-template-columns:340px 1fr;height:100vh"><aside style="overflow:auto;border-right:1px solid #e6e3dd;background:#f4f1ec"><div style="padding:14px 12px;font-weight:500">Dev mailbox <span style="color:#92918b;font-weight:400">(${mails.length})</span></div>${list}</aside><main>${body}</main></body></html>`
  }
}
