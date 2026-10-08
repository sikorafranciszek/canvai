import { test } from '@japa/runner'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import app from '@adonisjs/core/services/app'
import { validateDesignSpec } from '#services/design/spec'
import { renderStorybook } from '#services/design/storybook'

const STORYBOOK_STUB = `declare module '@storybook/react' {
  import type { ComponentType } from 'react'
  export type Meta = { title?: string; decorators?: ((Story: ComponentType) => unknown)[] }
  export type StoryObj = { render?: () => unknown }
}`

test.group('Eksport Storybook (FEAT-6)', () => {
  test('stories dla 5 komponentów ze stanami kompilują się z typami React', ({ assert }) => {
    const spec = validateDesignSpec({
      name: 'Kawiarnia „Ziarno”',
      overview: 'x',
      colors: [
        { name: 'Espresso', hex: '#3b2a20', role: 'primary text' },
        { name: 'Crema', hex: '#faf3e6', role: 'background surface' },
        { name: 'Teal', hex: '#016a71', role: 'primary action accent' },
        { name: 'Line', hex: '#e6e3dd', role: 'border hairline' },
      ],
      typography: { families: [{ name: 'Inter', substitute: 'system-ui' }] },
      radii: [{ element: 'Średni', value: '8px' }],
      components: [
        {
          name: 'Primary Button',
          description: 'Main CTA */ with ` backtick ${x}',
          states: ['hover: darker', 'disabled: 50%', 'focus ring'],
        },
        { name: 'Search input', description: 'Search field', states: ['error: red border'] },
        { name: 'Product card', description: 'Card "quoted" <b>', states: [] },
        { name: 'Status badge', description: 'Badge', states: ['selected'] },
        { name: '2nd nav bar', description: 'Top nav', states: [] },
        { name: 'Ignored sixth', description: 'x', states: [] },
      ],
      dos: ['a'],
      donts: ['b'],
    })
    const code = renderStorybook(spec)
    assert.include(code, 'export const PrimaryButtonHover: Story')
    assert.include(code, 'export const PrimaryButtonDisabled: Story')
    assert.include(code, 'export const SearchInputError: Story')
    assert.include(code, 'export const NdNavBarDefault: Story')
    assert.notInclude(code, 'IgnoredSixth')
    assert.include(code, 'var(--radius-sredni)')
    assert.include(code, '--color-teal')

    // Na czystej kopii (CI) katalogu tmp/ jeszcze nie ma.
    mkdirSync(app.tmpPath(), { recursive: true })
    const dir = mkdtempSync(join(app.tmpPath(), 'sb-'))
    try {
      const file = join(dir, 'design-system.stories.tsx')
      writeFileSync(file, code)
      writeFileSync(join(dir, 'storybook.d.ts'), STORYBOOK_STUB)
      const program = ts.createProgram([file, join(dir, 'storybook.d.ts')], {
        jsx: ts.JsxEmit.ReactJSX,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022,
        types: [],
      })
      const errors = ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      assert.deepEqual(errors, [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
