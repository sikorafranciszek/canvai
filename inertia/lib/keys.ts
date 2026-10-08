/**
 * Nazwa klawisza modyfikatora do podpowiedzi (UX-9): ⌘ na macOS/iOS, Ctrl gdzie
 * indziej. Skróty działają z oboma (Canvas sprawdza ctrlKey || metaKey).
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

export const MOD = isApplePlatform() ? '⌘' : 'Ctrl'

/** „Ctrl+Z” / „⌘Z”. */
export function shortcut(...keys: string[]): string {
  return isApplePlatform()
    ? [MOD, ...keys.map((k) => (k === 'Shift' ? '⇧' : k))].join('')
    : [MOD, ...keys].join('+')
}
