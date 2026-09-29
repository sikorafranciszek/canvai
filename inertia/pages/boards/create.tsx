import { Form, Link } from '@adonisjs/inertia/react'
import { Head } from '@inertiajs/react'
import { ArrowLeft } from 'lucide-react'
import type React from 'react'
import { useT } from '~/i18n'

/** Samodzielna strona tworzenia tablicy (link bezpośredni; w UI jest dialog). */
const BoardsCreate: React.FC = () => {
  const { t } = useT()
  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <Head title={t('boards.create.title')} />
      <Link route="boards.index" className="btn btn--quiet btn--sm" style={{ alignSelf: 'flex-start' }}>
        <ArrowLeft />
        {t('nav.boards')}
      </Link>
      <div className="card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="t-title">{t('boards.create.title')}</h1>
          <p className="t-muted">{t('boards.create.description')}</p>
        </div>
        <Form route="boards.store">
          {({ errors, processing }: { errors: Record<string, string>; processing: boolean }) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="field">
                <label className="field__label" htmlFor="title">
                  {t('common.name')}
                </label>
                <input
                  className="input"
                  type="text"
                  name="title"
                  id="title"
                  autoFocus
                  autoComplete="off"
                  placeholder={t('boards.create.placeholder')}
                  aria-invalid={errors.title ? 'true' : undefined}
                />
                {errors.title ? <div className="field__error">{errors.title}</div> : null}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Link route="boards.index" className="btn">
                  {t('common.cancel')}
                </Link>
                <button type="submit" className="btn btn--primary" disabled={processing}>
                  {t('boards.create.submit')}
                </button>
              </div>
            </div>
          )}
        </Form>
      </div>
    </div>
  )
}

export default BoardsCreate
