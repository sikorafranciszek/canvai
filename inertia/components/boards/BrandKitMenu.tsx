/** Wstawianie brand kitu na płótno (notatka z kolorami, fontami i zasadami dla AI). */
import { useEffect } from 'react'
import { router } from '@inertiajs/react'
import { Lock, Palette, Settings2 } from 'lucide-react'
import { Menu } from '~/components/ui/Menu'
import { brandKitNote, useBrandKitStore } from '~/lib/brand_kits'
import { useBoardStore } from '~/lib/board/session'
import { useT } from '~/i18n'

export function BrandKitMenu() {
  const { t } = useT()
  const kits = useBrandKitStore((s) => s.kits)
  const allowed = useBrandKitStore((s) => s.allowed)
  const load = useBrandKitStore((s) => s.load)
  const addBrandKitNote = useBoardStore((s) => s.addBrandKitNote)

  useEffect(() => {
    void load()
  }, [load])

  const actions = !allowed
    ? [
        {
          label: t('brandKits.locked'),
          icon: <Lock size={14} />,
          onSelect: () => router.visit('/billing'),
        },
      ]
    : [
        ...kits.map((kit) => ({
          label: kit.name,
          icon: (
            <span className="kit-dots" aria-hidden>
              {kit.colors.slice(0, 3).map((c) => (
                <span key={c.hex + c.name} style={{ background: c.hex }} />
              ))}
            </span>
          ),
          testId: `brand-kit-insert-${kit.id}`,
          onSelect: () => addBrandKitNote(brandKitNote(kit)),
        })),
        {
          label: kits.length ? t('brandKits.manage') : t('brandKits.emptyMenu'),
          icon: <Settings2 size={14} />,
          onSelect: () => router.visit('/brand-kits'),
        },
      ]

  return (
    <Menu
      label={t('brandKits.insert')}
      testId="brand-kit-menu"
      triggerClassName="btn btn--quiet btn--icon btn--sm"
      trigger={<Palette />}
      actions={actions}
    />
  )
}
