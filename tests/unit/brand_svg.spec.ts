import { test } from '@japa/runner'
import { safeSvg } from '#controllers/brand_controller'

test.group('Logo SVG (SEC-16)', () => {
  test('odrzuca DTD, encje i zewnętrzne zasoby', ({ assert }) => {
    assert.isTrue(
      safeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#g)"/><use href="#a"/></svg>'
      )
    )
    assert.isTrue(safeSvg('<svg><image href="data:image/png;base64,AAAA"/></svg>'))
    assert.isFalse(
      safeSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>')
    )
    assert.isFalse(safeSvg('<svg><image xlink:href="../../secret.png"/></svg>'))
    assert.isFalse(safeSvg('<svg><image href="https://evil.example/a.png"/></svg>'))
    assert.isFalse(safeSvg('<svg><style>@import url(https://x)</style></svg>'))
    assert.isFalse(safeSvg('<svg><rect style="fill:url(file:///x)"/></svg>'))
  })
})
