#!/usr/bin/env node
/**
 * Capture a screenshot of the app with sample data.
 * Uses Puppeteer to interact with the page before capturing:
 *  - Expands one task to show rendered markdown + meeting chips
 *  - Clicks into another task's notes to show the markdown editor
 *
 * Run via: ./scripts/take_screenshot.sh (which starts servers first)
 */

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const puppeteerPath = join(__dirname, '..', 'web', 'node_modules', 'puppeteer', 'lib', 'puppeteer', 'puppeteer.js')
const puppeteer = await import(puppeteerPath)

const URL = process.env.SCREENSHOT_URL || 'http://localhost:4174'
const OUTPUT = process.env.SCREENSHOT_OUTPUT || 'docs/screenshot.png'

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--window-size=1280,1200', '--force-dark-mode', '--hide-scrollbars'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 1200, deviceScaleFactor: 2 })

  // Set dim theme in localStorage before loading
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('worklog-theme', 'dim')
  })

  await page.goto(URL, { waitUntil: 'networkidle0' })
  await sleep(1000)

  // 1. Expand "Implement rate limiting middleware" and click into its notes
  //    to show the markdown editor (it has meeting chips too)
  const rateLimitChevron = await findTaskChevron(page, 'Implement rate limiting middleware')
  if (rateLimitChevron) {
    await rateLimitChevron.click()
    await sleep(500)

    // Click into the notes area to activate the markdown editor
    const clicked = await page.evaluate(() => {
      const wrappers = document.querySelectorAll('[class*="cursor-text"]')
      for (const el of wrappers) {
        if (el.textContent && el.textContent.includes('token bucket')) {
          el.click()
          return true
        }
      }
      return false
    })
    if (clicked) {
      await sleep(500)
    }
  }

  // 2. Expand "Add OAuth2 PKCE support" — has rich markdown checklist + meeting chip
  const pkceChevron = await findTaskChevron(page, 'Add OAuth2 PKCE support')
  if (pkceChevron) {
    await pkceChevron.click()
    await sleep(500)
  }

  await sleep(300)

  await page.screenshot({ path: OUTPUT, fullPage: false })
  console.log(`✅ Screenshot saved to ${OUTPUT}`)

  await browser.close()
}

async function findTaskChevron(page, textMatch) {
  return page.evaluateHandle((text) => {
    const spans = document.querySelectorAll('span')
    for (const span of spans) {
      if (span.textContent && span.textContent.trim().includes(text)) {
        const row = span.closest('[class*="rounded-lg"]')
        if (row) {
          const btn = row.querySelector('button')
          if (btn) return btn
        }
      }
    }
    return null
  }, textMatch).then(h => h.asElement())
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
