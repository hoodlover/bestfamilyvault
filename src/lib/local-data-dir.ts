import { mkdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

type RailHelperSettings = {
  dataDir?: unknown
}

function dataDirFromArgs() {
  const inlineArg = process.argv.find((arg) => arg.startsWith('--data-dir='))
  if (inlineArg) return inlineArg.slice('--data-dir='.length).trim()

  const argIndex = process.argv.indexOf('--data-dir')
  if (argIndex >= 0) return process.argv[argIndex + 1]?.trim()

  return undefined
}

async function dataDirFromSettingsFile() {
  const appData = process.env.APPDATA
  if (!appData) return undefined

  try {
    const settingsPath = path.join(appData, 'RailHelper', 'settings.json')
    const raw = await readFile(settingsPath, 'utf8')
    const settings = JSON.parse(raw) as RailHelperSettings
    return typeof settings.dataDir === 'string' ? settings.dataDir.trim() : undefined
  } catch {
    return undefined
  }
}

export async function getRailHelperDataDir() {
  const dataDir =
    dataDirFromArgs() ||
    process.env.RAILHELPER_DATA_DIR?.trim() ||
    (await dataDirFromSettingsFile()) ||
    path.join(process.env.USERPROFILE || os.homedir(), 'Documents', 'RailHelper')

  const resolvedDataDir = path.resolve(/* turbopackIgnore: true */ dataDir)
  await mkdir(resolvedDataDir, { recursive: true })
  return resolvedDataDir
}
