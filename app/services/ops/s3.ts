import { createHash, createHmac } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Minimalny klient S3 (AWS Signature V4) — PUT/GET/LIST/DELETE obiektów.
 * Działa z AWS S3, Cloudflare R2, Backblaze B2 i MinIO (adresy path-style),
 * bez ciężkiego SDK. Treść wysyłana strumieniowo (`UNSIGNED-PAYLOAD`).
 */

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export interface S3Object {
  key: string
  size: number
  lastModified: string
}

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest()

export class S3Client {
  constructor(private config: S3Config) {}

  private url(key: string, query: Record<string, string> = {}): URL {
    const base = this.config.endpoint.replace(/\/+$/, '')
    const path = [this.config.bucket, ...(key ? key.split('/') : [])].map(enc).join('/')
    const url = new URL(`${base}/${path}`)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    return url
  }

  /** Nagłówki podpisu SigV4 dla zapytania. */
  sign(
    method: string,
    url: URL,
    headers: Record<string, string> = {},
    payloadHash = 'UNSIGNED-PAYLOAD',
    now = new Date()
  ) {
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const day = amzDate.slice(0, 8)
    const all: Record<string, string> = {
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      'host': url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    }
    const names = Object.keys(all).sort()
    const canonicalQuery = [...url.searchParams.entries()]
      .map(([k, v]) => [enc(k), enc(v)])
      .sort(([a, x], [b, y]) => (a === b ? x.localeCompare(y) : a.localeCompare(b)))
      .map(([k, v]) => `${k}=${v}`)
      .join('&')
    const canonical = [
      method,
      url.pathname,
      canonicalQuery,
      names.map((n) => `${n}:${String(all[n]).trim()}\n`).join(''),
      names.join(';'),
      payloadHash,
    ].join('\n')
    const scope = `${day}/${this.config.region}/s3/aws4_request`
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')
    let key: Buffer = hmac(`AWS4${this.config.secretAccessKey}`, day)
    for (const part of [this.config.region, 's3', 'aws4_request']) key = hmac(key, part)
    const signature = createHmac('sha256', key).update(toSign).digest('hex')
    delete all.host
    return {
      ...all,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
    }
  }

  private async request(
    method: string,
    url: URL,
    init: RequestInit & { headers?: Record<string, string> } = {}
  ) {
    const res = await fetch(url, {
      ...init,
      method,
      headers: this.sign(method, url, init.headers ?? {}),
      signal: init.signal ?? AbortSignal.timeout(30 * 60_000),
    })
    if (!res.ok && res.status !== 404) {
      const body = (await res.text()).slice(0, 300)
      throw new Error(`S3 ${method} ${url.pathname}: HTTP ${res.status} ${body}`)
    }
    return res
  }

  async putFile(key: string, file: string, contentType = 'application/octet-stream') {
    const { size } = await stat(file)
    const body = Readable.toWeb(createReadStream(file)) as unknown as RequestInit['body']
    await this.request('PUT', this.url(key), {
      body,
      headers: { 'content-length': String(size), 'content-type': contentType },
      // Strumień jako treść zapytania wymaga trybu half-duplex w fetch Node.
      ...({ duplex: 'half' } as object),
    })
    return size
  }

  async putText(key: string, text: string, contentType = 'application/json') {
    await this.request('PUT', this.url(key), {
      body: text,
      headers: { 'content-type': contentType, 'content-length': String(Buffer.byteLength(text)) },
    })
  }

  async getToFile(key: string, file: string) {
    const res = await this.request('GET', this.url(key))
    if (res.status === 404 || !res.body) throw new Error(`S3: brak obiektu ${key}`)
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(file))
  }

  async delete(key: string) {
    await this.request('DELETE', this.url(key))
  }

  async list(prefix: string): Promise<S3Object[]> {
    const out: S3Object[] = []
    let token: string | undefined
    do {
      const query: Record<string, string> = { 'list-type': '2', 'prefix': prefix }
      if (token) query['continuation-token'] = token
      const res = await this.request('GET', this.url('', query))
      const xml = await res.text()
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const tag = (name: string) =>
          m[1].match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? ''
        out.push({
          key: decodeXml(tag('Key')),
          size: Number(tag('Size')),
          lastModified: tag('LastModified'),
        })
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? decodeXml(xml.match(/<NextContinuationToken>([^<]*)</)?.[1] ?? '')
        : undefined
    } while (token)
    return out
  }
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
