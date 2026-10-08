/**
 * Współpraca na tablicy: kto jest obecny, kursory innych osób, komentarze
 * przypięte do płótna (wątki, odpowiedzi, rozwiązywanie) i zapraszanie
 * członków z rolami.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { router } from '@inertiajs/react'
import {
  Check,
  MessageSquare,
  MessageSquarePlus,
  MousePointer2,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { Dialog } from '~/components/ui/Dialog'
import { csrfHeaders } from '~/lib/board/api'
import { useCommentsStore, type BoardCommentDto } from '~/lib/board/comments'
import { onMembersChanged, useLiveStore } from '~/lib/board/live'
import { useSceneStore } from '~/lib/scene/store'
import { relativeTime } from '~/lib/format'
import { translate, useT } from '~/i18n'
import { httpError, notifyError } from '~/lib/errors'

// ---------------------------------------------------------------------------
// Obecność
// ---------------------------------------------------------------------------

export function PresenceAvatars({ selfId }: { selfId?: number }) {
  const participants = useLiveStore((s) => s.participants)
  const { t } = useT()
  const others = participants.filter((p) => p.userId !== selfId)
  if (!others.length) return null
  return (
    <div
      className="presence"
      data-testid="presence"
      aria-label={t('live.here', { n: others.length })}
    >
      {others.slice(0, 5).map((p) => (
        <span
          key={p.userId}
          className="presence__avatar"
          style={{ background: p.color }}
          data-tip={`${p.name} · ${t(p.role === 'viewer' ? 'members.viewer' : p.role === 'owner' ? 'members.owner' : 'members.editor')}`}
        >
          {p.initials}
        </span>
      ))}
      {others.length > 5 ? <span className="presence__more">+{others.length - 5}</span> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Kursory
// ---------------------------------------------------------------------------

export function CursorsLayer() {
  const cursors = useLiveStore((s) => s.cursors)
  const camera = useSceneStore((s) => s.camera)
  const [now, setNow] = useState(() => Date.now())
  // Kursor, który nie ruszał się 10 s, znika.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="collab-layer" aria-hidden>
      {Object.values(cursors)
        .filter((c) => now - c.at < 10_000)
        .map((c) => (
          <div
            key={c.clientId}
            className="live-cursor"
            style={{
              transform: `translate(${c.x * camera.scale + camera.x}px, ${c.y * camera.scale + camera.y}px)`,
            }}
          >
            <MousePointer2 size={18} fill={c.color} color="#fff" strokeWidth={1.5} />
            <span className="live-cursor__label" style={{ background: c.color }}>
              {c.name}
            </span>
          </div>
        ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Komentarze
// ---------------------------------------------------------------------------

function threadsOf(comments: BoardCommentDto[]) {
  const roots = comments.filter((c) => c.parentId == null)
  return roots.map((root) => ({
    root,
    replies: comments.filter((c) => c.parentId === root.id),
  }))
}

function Composer({
  onSubmit,
  onCancel,
  placeholder,
  autoFocus = true,
}: {
  /** Zwraca `false` przy błędzie — wtedy treść zostaje w polu. */
  onSubmit: (body: string) => Promise<boolean | void> | boolean | void
  onCancel?: () => void
  placeholder: string
  autoFocus?: boolean
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const { t } = useT()
  const submit = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    const ok = await onSubmit(body.trim())
    setBusy(false)
    if (ok !== false) setBody('')
  }
  return (
    <div className="comment-composer">
      <textarea
        className="input"
        rows={2}
        value={body}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={4000}
        data-testid="comment-input"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          if (e.key === 'Escape') onCancel?.()
        }}
      />
      <div className="comment-composer__actions">
        {onCancel ? (
          <button type="button" className="btn btn--quiet btn--sm" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!body.trim() || busy}
          onClick={() => void submit()}
          data-testid="comment-submit"
        >
          {t('comments.send')}
        </button>
      </div>
    </div>
  )
}

function CommentBody({ c }: { c: BoardCommentDto }) {
  const remove = useCommentsStore((s) => s.remove)
  const { t } = useT()
  return (
    <div className="comment">
      <span className="comment__avatar" style={{ background: c.author?.color ?? '#72706b' }}>
        {c.author?.initials ?? '?'}
      </span>
      <div className="comment__main">
        <div className="comment__meta">
          <b>{c.author?.name ?? t('comments.deletedUser')}</b>
          <span className="t-faint">{relativeTime(c.createdAt)}</span>
          {c.canEdit ? (
            <button
              type="button"
              className="btn btn--quiet btn--icon btn--xs"
              aria-label={t('common.delete')}
              onClick={() => void remove(c.id)}
            >
              <Trash2 size={12} />
            </button>
          ) : null}
        </div>
        <p className="comment__text">{c.body}</p>
      </div>
    </div>
  )
}

function ThreadPopover({ root, replies }: { root: BoardCommentDto; replies: BoardCommentDto[] }) {
  const { reply, resolve, open } = useCommentsStore.getState()
  const { t } = useT()
  const ref = useRef<HTMLDivElement>(null)
  // Okienko wątku jest dialogiem (UX-9): fokus przy otwarciu, Esc zamyka.
  useEffect(() => {
    ref.current?.focus()
  }, [root.id])
  return (
    <div
      ref={ref}
      className="comment-popover"
      data-testid="comment-thread"
      role="dialog"
      aria-label={t('comments.threadLabel', { name: root.author?.name ?? '' })}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          open(null)
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="comment-popover__head">
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={() => void resolve(root.id, !root.resolved)}
          data-testid="comment-resolve"
        >
          <Check size={14} />
          {root.resolved ? t('comments.reopen') : t('comments.resolve')}
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--icon btn--sm"
          aria-label={t('common.close')}
          onClick={() => open(null)}
        >
          <X size={14} />
        </button>
      </div>
      <div className="comment-popover__list">
        <CommentBody c={root} />
        {replies.map((r) => (
          <CommentBody key={r.id} c={r} />
        ))}
      </div>
      <Composer
        placeholder={t('comments.replyPlaceholder')}
        autoFocus={false}
        onSubmit={(body) => reply(root.id, body)}
      />
    </div>
  )
}

export function CommentsLayer({ boardId }: { boardId: number }) {
  const comments = useCommentsStore((s) => s.comments)
  const placing = useCommentsStore((s) => s.placing)
  const draft = useCommentsStore((s) => s.draft)
  const openId = useCommentsStore((s) => s.openId)
  const showResolved = useCommentsStore((s) => s.showResolved)
  const camera = useSceneStore((s) => s.camera)
  const layer = useRef<HTMLDivElement>(null)
  const { t } = useT()

  useEffect(() => {
    void useCommentsStore.getState().load(boardId)
  }, [boardId])

  const threads = useMemo(() => threadsOf(comments), [comments])
  const at = (x: number, y: number) => ({
    left: x * camera.scale + camera.x,
    top: y * camera.scale + camera.y,
  })

  return (
    <div
      ref={layer}
      className={`collab-layer${placing ? ' collab-layer--placing' : ''}`}
      data-testid="comments-layer"
      onClick={(e) => {
        if (!placing || e.target !== layer.current) return
        const rect = layer.current!.getBoundingClientRect()
        useCommentsStore.getState().setDraft({
          x: (e.clientX - rect.left - camera.x) / camera.scale,
          y: (e.clientY - rect.top - camera.y) / camera.scale,
        })
      }}
    >
      {threads
        .filter(({ root }) => showResolved || !root.resolved || root.id === openId)
        .map(({ root, replies }) =>
          root.x == null || root.y == null ? null : (
            <div key={root.id} className="comment-pin-wrap" style={at(root.x, root.y)}>
              <button
                type="button"
                className={`comment-pin${root.resolved ? ' comment-pin--resolved' : ''}`}
                style={{ background: root.author?.color ?? '#72706b' }}
                aria-label={t('comments.openThread', { name: root.author?.name ?? '' })}
                data-testid={`comment-pin-${root.id}`}
                onClick={() =>
                  useCommentsStore.getState().open(openId === root.id ? null : root.id)
                }
              >
                {root.author?.initials ?? '?'}
                {replies.length ? (
                  <span className="comment-pin__count">{replies.length + 1}</span>
                ) : null}
              </button>
              {openId === root.id ? <ThreadPopover root={root} replies={replies} /> : null}
            </div>
          )
        )}
      {draft ? (
        <div className="comment-pin-wrap" style={at(draft.x, draft.y)}>
          <span className="comment-pin comment-pin--draft">
            <MessageSquarePlus size={14} />
          </span>
          <div
            className="comment-popover"
            role="dialog"
            aria-label={t('comments.newThread')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                useCommentsStore.getState().setDraft(null)
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Composer
              placeholder={t('comments.placeholder')}
              onSubmit={(body) => useCommentsStore.getState().create(body)}
              onCancel={() => useCommentsStore.getState().setDraft(null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Przycisk w pasku: tryb dodawania komentarza + liczba otwartych wątków. */
export function CommentsButton() {
  const comments = useCommentsStore((s) => s.comments)
  const placing = useCommentsStore((s) => s.placing)
  const showResolved = useCommentsStore((s) => s.showResolved)
  const { t } = useT()
  const open = comments.filter((c) => c.parentId == null && !c.resolved).length
  const resolved = comments.filter((c) => c.parentId == null && c.resolved).length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useCommentsStore.getState().setPlacing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="comments-button">
      <button
        type="button"
        className="btn btn--quiet btn--sm"
        aria-pressed={placing}
        aria-label={open ? `${t('comments.addTip')} (${open})` : t('comments.addTip')}
        onClick={() => useCommentsStore.getState().setPlacing(!placing)}
        data-tip={t('comments.addTip')}
        data-testid="comments-add"
      >
        <MessageSquare />
        {open ? <span className="comments-button__count">{open}</span> : null}
      </button>
      {resolved ? (
        <button
          type="button"
          className="chip"
          aria-pressed={showResolved}
          onClick={() => useCommentsStore.getState().toggleResolved()}
          data-tip={t('comments.showResolved')}
        >
          <Check size={12} /> {resolved}
        </button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Członkowie
// ---------------------------------------------------------------------------

interface MembersPayload {
  canManage: boolean
  limit: number | null
  owner: { id: number; name: string; email: string | null } | null
  members: {
    id: number
    email: string | null
    name: string | null
    role: 'editor' | 'viewer'
    pending: boolean
    isYou: boolean
  }[]
}

async function membersRequest(url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...csrfHeaders() },
    credentials: 'same-origin',
  })
  if (!res.ok) throw await httpError(res, translate('members.changeFailed'))
  const body = (await res.json().catch(() => ({}))) as { data?: MembersPayload }
  return body.data ?? null
}

export function MembersButton({ boardId, isOwner }: { boardId: number; isOwner: boolean }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<MembersPayload | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const [busy, setBusy] = useState(false)
  const { t } = useT()

  useEffect(() => {
    if (!open) return
    const load = () =>
      membersRequest(`/api/boards/${boardId}/members`)
        .then(setData)
        .catch(() => setData(null))
    void load()
    onMembersChanged(() => void load())
    return () => onMembersChanged(null)
  }, [open, boardId])

  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    try {
      setData(
        await membersRequest(`/api/boards/${boardId}/members`, {
          method: 'POST',
          body: JSON.stringify({ email: email.trim(), role }),
        })
      )
      setEmail('')
      toast.success(t('members.invited'))
    } catch (error) {
      notifyError(error, 'members.inviteFailed')
    } finally {
      setBusy(false)
    }
  }

  const change = async (id: number, next: 'editor' | 'viewer') => {
    try {
      setData(
        await membersRequest(`/api/boards/${boardId}/members/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role: next }),
        })
      )
    } catch (error) {
      notifyError(error, 'members.changeFailed')
    }
  }
  const remove = async (id: number, self: boolean) => {
    let next: MembersPayload | null
    try {
      next = await membersRequest(`/api/boards/${boardId}/members/${id}`, { method: 'DELETE' })
    } catch (error) {
      notifyError(error, 'members.removeFailed')
      return
    }
    if (self && !isOwner) {
      router.visit('/boards')
      return
    }
    setData(next)
  }

  return (
    <>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => setOpen(true)}
        data-testid="members-button"
        data-tip={t('members.tip')}
      >
        <UserPlus />
        {t('members.button')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('members.title')}
        description={t('members.desc')}
        testId="members-dialog"
        footer={
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            {t('common.close')}
          </button>
        }
      >
        {data?.canManage ? (
          <form className="members-invite" onSubmit={invite}>
            <input
              className="input"
              type="email"
              required
              placeholder={t('members.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="members-email"
            />
            <select
              className="select"
              value={role}
              onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
              aria-label={t('members.roleLabel')}
            >
              <option value="editor">{t('members.editor')}</option>
              <option value="viewer">{t('members.viewer')}</option>
            </select>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              data-testid="members-invite"
            >
              {t('members.invite')}
            </button>
          </form>
        ) : null}
        {data?.canManage && data.limit != null ? (
          <p className="t-small t-muted">
            {t('members.seats', { used: data.members.length, limit: data.limit })}
          </p>
        ) : null}
        <ul className="members-list">
          {data?.owner ? (
            <li>
              <div>
                <b>{data.owner.name}</b>
                {data.owner.email ? (
                  <div className="t-small t-muted">{data.owner.email}</div>
                ) : null}
              </div>
              <span className="badge badge--outline">{t('members.owner')}</span>
            </li>
          ) : null}
          {data?.members.map((m) => (
            <li key={m.id}>
              <div>
                <b>{m.name ?? m.email}</b>
                <div className="t-small t-muted">
                  {m.email}
                  {m.pending ? ` · ${t('members.pending')}` : ''}
                </div>
              </div>
              {data.canManage ? (
                <select
                  className="select select--sm"
                  value={m.role}
                  aria-label={t('members.roleLabel')}
                  onChange={(e) => void change(m.id, e.target.value as 'editor' | 'viewer')}
                >
                  <option value="editor">{t('members.editor')}</option>
                  <option value="viewer">{t('members.viewer')}</option>
                </select>
              ) : (
                <span className="badge badge--outline">
                  {t(m.role === 'editor' ? 'members.editor' : 'members.viewer')}
                </span>
              )}
              {data.canManage || m.isYou ? (
                <button
                  type="button"
                  className="btn btn--quiet btn--icon btn--sm"
                  aria-label={m.isYou ? t('members.leave') : t('members.remove')}
                  data-tip={m.isYou ? t('members.leave') : t('members.remove')}
                  onClick={() => void remove(m.id, m.isYou)}
                >
                  <X size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  )
}
