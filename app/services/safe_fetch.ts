import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import zlib from 'node:zlib'

/**
 * Pobieranie zewnętrznych URL-i podanych przez użytkownika (metadane linków,
 * import strony) z ochroną przed SSRF:
 * - tylko http/https i porty 80/443 (albo jawnie podany port ≥ 1024 poza zakresem usług),
 * - adres IP sprawdzany W CHWILI ŁĄCZENIA (własny `lookup`) — odrzucamy sieci
 *   prywatne, loopback, link-local, CGNAT, multicast i zarezerwowane; to chroni
 *   też przed DNS rebinding,
 * - przekierowania obsługiwane ręcznie (każdy krok sprawdzany), limit rozmiaru i czasu.
 */

export class UnsafeUrlError extends Error {}

/** Tylko dla testów: pozwala łączyć się z lokalnym serwerem testowym. */
export const safeFetchTesting = { allowPrivate: false }

export interface SafeResponse {
  url: string
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
  contentType: string
  text: () => string
}

function ipv4Blocked(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/** Rozwija adres IPv6 do 8 liczb 16-bitowych (obsługuje `::` i końcówkę IPv4). */
function ipv6Hextets(ip: string): number[] | null {
  let addr = ip.toLowerCase().replace(/%.*$/, '')
  // Końcówka w postaci kropkowej (::ffff:1.2.3.4) → dwie grupy szesnastkowe.
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    if (!net.isIPv4(v4[1])) return null
    const [a, b, c, d] = v4[1].split('.').map(Number)
    addr =
      addr.slice(0, -v4[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const halves = addr.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const groups = [...head, ...Array(fill).fill('0'), ...tail]
  if (groups.length !== 8) return null
  const out = groups.map((g) => Number.parseInt(g, 16))
  return out.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? out : null
}

function embeddedIPv4(h: number[], from: number): string {
  return [h[from] >> 8, h[from] & 0xff, h[from + 1] >> 8, h[from + 1] & 0xff].join('.')
}

/**
 * Czy adres jest niepubliczny. IPv6 jest rozwijany do pełnej postaci, więc
 * każdy zapis (`::ffff:7f00:1`, `::ffff:127.0.0.1`, `0:0:0:0:0:ffff:…`) daje ten
 * sam wynik. Adresy z osadzonym IPv4 (mapowane, zgodne, NAT64) sprawdzamy jak
 * IPv4; tunele i przestarzałe zakresy blokujemy w całości.
 */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4Blocked(ip)
  if (!net.isIPv6(ip)) return true
  const h = ipv6Hextets(ip)
  if (!h) return true
  const zeros = (n: number) => h.slice(0, n).every((x) => x === 0)
  // :: (nieokreślony) i ::1 (loopback)
  if (zeros(7) && (h[7] === 0 || h[7] === 1)) return true
  // ::ffff:a.b.c.d (mapowany) i ::a.b.c.d (zgodny, przestarzały)
  if (zeros(5) && h[5] === 0xffff) return ipv4Blocked(embeddedIPv4(h, 6))
  if (zeros(6)) return ipv4Blocked(embeddedIPv4(h, 6))
  // 64:ff9b::/96 i 64:ff9b:1::/48 (NAT64) — osadzony IPv4
  if (h[0] === 0x64 && h[1] === 0xff9b) return true
  const first = h[0]
  return (
    first === 0x2002 || // 6to4 (osadzony IPv4 dowolnej sieci)
    (first === 0x2001 && h[1] === 0) || // Teredo
    (first === 0x2001 && h[1] === 0xdb8) || // dokumentacja
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unikalne lokalne
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xffc0) === 0xfec0 || // fec0::/10 site-local (przestarzałe)
    (first & 0xff00) === 0xff00 || // multicast
    first < 0x2000 || // poza globalnym unicastem 2000::/3
    first >= 0x4000
  )
}

/** `lookup` dla http(s).request — odrzuca zablokowane adresy przy łączeniu. */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0)
    const list = (addresses as dns.LookupAddress[]).filter(
      (a) => safeFetchTesting.allowPrivate || !isBlockedAddress(a.address)
    )
    if (!list.length) return callback(new UnsafeUrlError(`Blocked address for ${hostname}`), '', 0)
    if ((options as dns.LookupOptions).all) return (callback as any)(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

export function assertPublicUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UnsafeUrlError('Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new UnsafeUrlError('Only http(s)')
  if (url.username || url.password) throw new UnsafeUrlError('Credentials in URL are not allowed')
  if (safeFetchTesting.allowPrivate) return url
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  if (![80, 443, 8080, 8443].includes(port)) throw new UnsafeUrlError('Port not allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) && isBlockedAddress(host)) throw new UnsafeUrlError('Blocked address')
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host))
    throw new UnsafeUrlError('Blocked host')
  return url
}

function requestOnce(
  url: URL,
  timeoutMs: number,
  maxBytes: number
): Promise<SafeResponse & { location?: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'canvai/0.1 (+https://canvai.dev)',
          'Accept': 'text/html,text/css,image/*;q=0.9,*/*;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          return resolve({
            url: url.toString(),
            status,
            headers: res.headers,
            body: Buffer.alloc(0),
            contentType: '',
            text: () => '',
            location: res.headers.location,
          })
        }
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase()
        const stream =
          encoding === 'gzip' || encoding === 'x-gzip'
            ? res.pipe(zlib.createGunzip())
            : encoding === 'deflate'
              ? res.pipe(zlib.createInflate())
              : encoding === 'br'
                ? res.pipe(zlib.createBrotliDecompress())
                : res
        const chunks: Buffer[] = []
        let size = 0
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) {
            req.destroy()
            stream.destroy()
            return resolveBody()
          }
          chunks.push(chunk)
        })
        const resolveBody = () => {
          const body = Buffer.concat(chunks)
          resolve({
            url: url.toString(),
            status,
            headers: res.headers,
            body,
            contentType: String(res.headers['content-type'] ?? ''),
            text: () => body.toString('utf8'),
          })
        }
        stream.on('end', resolveBody)
        stream.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error('Timeout')))
    req.on('error', reject)
    req.end()
  })
}

export async function safeFetch(
  raw: string,
  { timeoutMs = 5000, maxBytes = 2 * 1024 * 1024, maxRedirects = 4 } = {}
): Promise<SafeResponse> {
  let url = assertPublicUrl(raw)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await requestOnce(url, timeoutMs, maxBytes)
    if (!res.location) return res
    url = assertPublicUrl(new URL(res.location, url).toString())
  }
  throw new UnsafeUrlError('Too many redirects')
}
