#!/usr/bin/env node
/**
 * generate-image.mjs — illustrated report cover generator via kie.ai
 *
 * Zero external dependencies. Requires Node 18+ (native fetch).
 *
 * Usage:
 *   node generate-image.mjs --prompt "modern minimal cover, deep teal" --out docs/reports/assets/cover.png
 *   node generate-image.mjs --prompt "restyle" --ref docs/reports/assets/diagram.png --out docs/reports/assets/cover-styled.png
 *
 * Env vars:
 *   KIE_API_KEY      (required)
 *   KIE_BASE_URL     (default: https://api.kie.ai)
 *   KIE_MODEL_T2I    (default: google/nano-banana)
 *   KIE_MODEL_I2I    (default: google/nano-banana-edit)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'

const BASE_URL = process.env.KIE_BASE_URL ?? 'https://api.kie.ai'
const MODEL_T2I = process.env.KIE_MODEL_T2I ?? 'google/nano-banana'
const MODEL_I2I = process.env.KIE_MODEL_I2I ?? 'google/nano-banana-edit'
const API_KEY   = process.env.KIE_API_KEY
const TIMEOUT_MS = 180_000
const POLL_INTERVAL_MS = 4_000

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--prompt') args.prompt = argv[++i]
    else if (argv[i] === '--out')    args.out    = argv[++i]
    else if (argv[i] === '--ref')    args.ref    = argv[++i]
  }
  return args
}

async function kiePost(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`kie.ai ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function kieGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  })
  if (!res.ok) throw new Error(`kie.ai ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function uploadRef(refPath) {
  const data = readFileSync(resolve(refPath))
  const b64  = data.toString('base64')
  const ext  = refPath.split('.').pop()
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
  const { url } = await kiePost('/v1/files', { data: `data:${mime};base64,${b64}` })
  return url
}

async function pollJob(jobId) {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const { status, output_url } = await kieGet(`/v1/jobs/${jobId}`)
    if (status === 'succeeded' && output_url) return output_url
    if (status === 'failed') throw new Error(`Job ${jobId} failed`)
    process.stderr.write('.')
  }
  throw new Error(`Job ${jobId} timed out after ${TIMEOUT_MS / 1000}s`)
}

async function downloadTo(url, outPath) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(dirname(resolve(outPath)), { recursive: true })
  writeFileSync(resolve(outPath), buf)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!API_KEY) { console.error('KIE_API_KEY is required'); process.exit(1) }
  if (!args.prompt) { console.error('--prompt is required'); process.exit(1) }
  if (!args.out)    { console.error('--out is required');    process.exit(1) }

  let refUrl = null
  if (args.ref) {
    process.stderr.write(`Uploading reference image ${args.ref}…\n`)
    refUrl = await uploadRef(args.ref)
  }

  const model  = refUrl ? MODEL_I2I : MODEL_T2I
  const body   = { model, prompt: args.prompt, ...(refUrl ? { image_url: refUrl } : {}) }

  process.stderr.write(`Creating ${refUrl ? 'i2i' : 't2i'} job (${model})…\n`)
  const { job_id } = await kiePost('/v1/jobs', body)

  process.stderr.write(`Waiting for job ${job_id}`)
  const outputUrl = await pollJob(job_id)
  process.stderr.write('\n')

  process.stderr.write(`Downloading to ${args.out}…\n`)
  await downloadTo(outputUrl, args.out)

  console.log(resolve(args.out))
}

main().catch(e => { console.error(e.message); process.exit(1) })
