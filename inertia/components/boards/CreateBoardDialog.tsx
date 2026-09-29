import { Form } from '@adonisjs/inertia/react'
import { Dialog } from '~/components/ui/Dialog'
import { useUiStore } from '~/lib/ui'
import { useT } from '~/i18n'

/** Dialog „Nowa tablica” — POST boards.store, serwer przekierowuje do edytora. */
export function CreateBoardDialog() {
  const open = useUiStore((s) => s.createBoardOpen)
  const close = useUiStore((s) => s.closeCreateBoard)
  const { t } = useT()

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('boards.create.title')}
      description={t('boards.create.description')}
      testId="create-board-dialog"
    >
      <Form route="boards.store" onSuccess={close}>
        {({ errors, processing }: { errors: Record<string, string>; processing: boolean }) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="field">
              <label className="field__label" htmlFor="create-board-title">
                {t('common.name')}
              </label>
              <input
                id="create-board-title"
                name="title"
                className="input"
                placeholder={t('boards.create.placeholder')}
                autoFocus
                autoComplete="off"
                maxLength={255}
                aria-invalid={errors.title ? 'true' : undefined}
              />
              {errors.title ? <div className="field__error">{errors.title}</div> : null}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={close}>
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={processing}
                data-testid="create-board-submit"
              >
                {processing ? <span className="spinner" /> : null}
                {t('boards.create.submit')}
              </button>
            </div>
          </div>
        )}
      </Form>
    </Dialog>
  )
}
