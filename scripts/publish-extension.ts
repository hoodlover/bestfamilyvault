// Zip extensions/browser/dist/ and upload to Vercel Blob so the vault
// can serve it as a download to family members on new devices.
//
// Two blobs land in storage:
//   extension/bestfamilyvault-vault-extension-v<version>-<rand>.zip  (the build)
//   extension/manifest.json                                    (stable URL)
//
// manifest.json is overwritten in place every publish and points at the
// freshest zip; the Settings page reads it to render the download card.
//
// Run AFTER building the extension:
//   cd extensions/browser && npm run build && cd ../..
//   npm run publish:extension
//
// Bump extensions/browser/package.json version before publishing — the
// version string is what the vault shows users.

import path from 'node:path'
import fs from 'node:fs'
import AdmZip from 'adm-zip'
import { put } from '@vercel/blob'

const REPO_ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(REPO_ROOT, 'extensions/browser/dist')
const PKG_PATH = path.join(REPO_ROOT, 'extensions/browser/package.json')

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Missing BLOB_READ_WRITE_TOKEN — make sure .env.local has the Vercel Blob token.')
    process.exit(1)
  }

  if (!fs.existsSync(DIST_DIR)) {
    console.error(`No dist/ at ${DIST_DIR}`)
    console.error("Build first: cd extensions/browser && npm run build")
    process.exit(1)
  }

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'))
  const version: string = pkg.version
  if (!version) {
    console.error('No "version" field in extensions/browser/package.json')
    process.exit(1)
  }

  // Sanity check: dist/ should contain manifest.json (the extension's own).
  const distManifest = path.join(DIST_DIR, 'manifest.json')
  if (!fs.existsSync(distManifest)) {
    console.error(`dist/manifest.json missing — looks like the build didn't complete.`)
    process.exit(1)
  }

  console.log(`Packaging extension v${version}…`)
  const zip = new AdmZip()
  zip.addLocalFolder(DIST_DIR)
  const buf = zip.toBuffer()
  const sizeKb = (buf.length / 1024).toFixed(1)

  const zipName = `bestfamilyvault-vault-extension-v${version}.zip`
  console.log(`Uploading ${zipName} (${sizeKb} KB)…`)
  // Private store — vault serves the download via /api/extension/download,
  // which auths the request and proxies the bytes from blob with the
  // bearer token. Direct blob URLs would 403 unauthenticated users.
  const uploaded = await put(`extension/${zipName}`, buf, {
    access: 'private',
    contentType: 'application/zip',
    addRandomSuffix: true,
  })

  const release = {
    version,
    downloadUrl: uploaded.url,
    filename: zipName,
    sizeBytes: buf.length,
    uploadedAt: new Date().toISOString(),
  }

  console.log('Writing extension/manifest.json…')
  await put('extension/manifest.json', JSON.stringify(release, null, 2), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  })

  console.log(`\nPublished v${version}`)
  console.log(`  download : ${uploaded.url}`)
  console.log(`  size     : ${sizeKb} KB`)
  console.log(`\nVault Settings → Autofill — Linked Devices will pick this up automatically.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
