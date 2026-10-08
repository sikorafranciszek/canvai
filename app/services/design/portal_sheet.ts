import type { DesignSpec } from '#services/design/spec'

/**
 * Arkusz dla klienta w portalu (FEAT-4): próbki kolorów, krojów i skali,
 * komponenty i ekrany — zamiast markdownu dla maszyn. Bez źródeł i pytań
 * technicznych; † (założenia) zostają, żeby klient wiedział, co potwierdzić.
 */
export interface PortalSheet {
  theme: DesignSpec['theme']
  tagline: string
  colors: { name: string; hex: string; role: string; assumed: boolean }[]
  families: { name: string; substitute: string; role: string; assumed: boolean }[]
  scale: { role: string; family: string; size: string; weight: string }[]
  radii: { name: string; value: string }[]
  components: { name: string; description: string; assumed: boolean }[]
  screens: { name: string; purpose: string }[]
  voice: { tone: string; examples: string[] }
  dos: string[]
  donts: string[]
}

export function portalSheet(spec: DesignSpec): PortalSheet {
  return {
    theme: spec.theme,
    tagline: spec.tagline,
    colors: spec.colors.slice(0, 24).map((c) => ({
      name: c.name,
      hex: c.hex,
      role: c.role,
      assumed: c.assumed && !c.confirmed,
    })),
    families: spec.typography.families.slice(0, 6).map((f) => ({
      name: f.name,
      substitute: f.substitute,
      role: f.role,
      assumed: f.assumed && !f.confirmed,
    })),
    scale: spec.typography.scale.slice(0, 8).map((r) => ({
      role: r.role,
      family: r.family,
      size: r.size,
      weight: r.weight,
    })),
    radii: spec.radii.slice(0, 6),
    components: spec.components.slice(0, 16).map((c) => ({
      name: c.name,
      description: c.description,
      assumed: c.assumed,
    })),
    screens: spec.screens.slice(0, 12).map((s) => ({ name: s.name, purpose: s.purpose })),
    voice: { tone: spec.voice.tone, examples: spec.voice.examples.slice(0, 6) },
    dos: spec.dos.slice(0, 8),
    donts: spec.donts.slice(0, 8),
  }
}
