// qa-crawl.mjs — deterministic sweep for /qa. Run from the repo's e2e/ dir (so
// @playwright/test resolves): the skill copies this file there, runs it, removes it.
//
//   node .qa-crawl.mjs --base http://localhost:5173 --routes ../apps/web/src/routes --out /path/out
//
// Visits every discoverable page (static SvelteKit routes + same-origin links found while
// crawling, which naturally covers dynamic ids from seeded data). For each page captures:
// console errors/warnings, uncaught page errors, failed/4xx/5xx requests, and a screenshot.
// Emits out/sweep.json + out/shots/*.png. Zero model tokens — judgment happens afterwards.
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const BASE = (arg('base', 'http://localhost:5173')).replace(/\/$/, '')
const ROUTES_DIR = arg('routes', '../apps/web/src/routes')
const OUT = arg('out', './qa-out')
const MAX_PAGES = parseInt(arg('max', '60'), 10)
const NAV_TIMEOUT = 15000

mkdirSync(join(OUT, 'shots'), { recursive: true })

// Static routes from the SvelteKit file tree; dynamic segments ([id]) are skipped here —
// the link-following crawl reaches them through real hrefs rendered from seeded data.
function staticRoutes(dir, prefix = '') {
  let out = []
  let entries = []
  try { entries = readdirSync(dir) } catch { return out }
  const hasPage = entries.some(e => e === '+page.svelte')
  if (hasPage) out.push(prefix || '/')
  for (const e of entries) {
    const p = join(dir, e)
    if (!statSync(p).isDirectory()) continue
    if (e.startsWith('[') || e.startsWith('(')) {
      if (e.startsWith('(')) out = out.concat(staticRoutes(p, prefix)) // layout group: no URL segment
      continue
    }
    out = out.concat(staticRoutes(p, `${prefix}/${e}`))
  }
  return out
}

const queue = [...new Set(staticRoutes(ROUTES_DIR))].map(r => BASE + r)
if (queue.length === 0) queue.push(BASE + '/')
const seen = new Set()
const pages = []

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })

while (queue.length && pages.length < MAX_PAGES) {
  const url = queue.shift()
  const key = url.split('#')[0]
  if (seen.has(key)) continue
  seen.add(key)

  const rec = { url, status: null, console: [], pageErrors: [], failedRequests: [], links: 0, shot: null, note: null }
  const page = await ctx.newPage()
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) rec.console.push({ type: m.type(), text: m.text().slice(0, 500) }) })
  page.on('pageerror', e => rec.pageErrors.push(String(e).slice(0, 500)))
  page.on('response', r => { if (r.status() >= 400) rec.failedRequests.push({ url: r.url().slice(0, 300), status: r.status(), method: r.request().method() }) })
  page.on('requestfailed', r => rec.failedRequests.push({ url: r.url().slice(0, 300), status: 'FAILED', method: r.method(), error: r.failure()?.errorText }))

  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT })
    rec.status = resp ? resp.status() : null
    await page.waitForTimeout(500) // let late async errors land
    const hrefs = await page.$$eval('a[href]', as => as.map(a => a.href))
    const inScope = hrefs.filter(h => h.startsWith(BASE) && !h.includes('/logout'))
    rec.links = inScope.length
    for (const h of inScope) if (!seen.has(h.split('#')[0])) queue.push(h)
    const name = (new URL(url).pathname.replace(/\W+/g, '_').replace(/^_|_$/g, '') || 'home') + '.png'
    await page.screenshot({ path: join(OUT, 'shots', name), fullPage: true })
    rec.shot = name
    const body = (await page.textContent('body'))?.trim() || ''
    if (body.length < 40) rec.note = 'NEAR-EMPTY PAGE'
  } catch (e) {
    rec.note = `NAVIGATION FAILED: ${String(e).slice(0, 300)}`
  }
  pages.push(rec)
  await page.close()
}

await browser.close()
const flagged = pages.filter(p => p.note || p.pageErrors.length || p.failedRequests.length || p.console.some(c => c.type === 'error') || (p.status && p.status >= 400))
writeFileSync(join(OUT, 'sweep.json'), JSON.stringify({ base: BASE, visited: pages.length, flagged: flagged.length, pages }, null, 2))
console.log(`Visited ${pages.length} page(s); ${flagged.length} flagged. Results: ${join(OUT, 'sweep.json')}`)
