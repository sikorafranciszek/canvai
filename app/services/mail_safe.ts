/**
 * Tekst od użytkownika w temacie i treści maila (SEC-8): bez znaków
 * sterujących, przycięty i bez klikalnych linków — zaproszenie z nazwą
 * tablicy „Wygrałeś! odbierz na evil.example” nie może nieść linku z domeny canvai.
 */
const URLISH =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/gi

export function mailSafe(text: string, max = 60): string {
  const clean = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Kropki w adresach jako „․” (U+2024) — klienty poczty nie robią z nich linków.
    .replace(URLISH, (m) => m.replace(/^https?:\/\//i, '').replace(/\./g, '\u2024'))
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}
