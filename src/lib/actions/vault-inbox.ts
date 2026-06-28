'use server'

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { auth } from '@/lib/auth'
import { isVaultInboxAvailable } from '@/lib/vault-inbox-path'

const execFileAsync = promisify(execFile)

export async function syncVaultInboxNow(): Promise<{
  ok: boolean
  message: string
  output?: string
}> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, message: 'Please sign in first.' }
  if (session.user.role !== 'superuser' && session.user.role !== 'admin') {
    return { ok: false, message: 'Admin access is required to sync the Vault File Drop.' }
  }

  if (!isVaultInboxAvailable()) {
    return {
      ok: false,
      message: 'Vault File Drop sync can only run from the local Windows machine that has the folder.',
    }
  }

  try {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const { stdout, stderr } = await execFileAsync(npmCommand, ['run', 'import:inbox'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000 * 60 * 10,
      maxBuffer: 1024 * 1024 * 5,
      windowsHide: true,
    })

    return {
      ok: true,
      message: 'Vault File Drop sync finished.',
      output: [stdout, stderr].filter(Boolean).join('\n').trim(),
    }
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string }
    return {
      ok: false,
      message: e.message || 'Vault File Drop sync failed.',
      output: [e.stdout, e.stderr].filter(Boolean).join('\n').trim(),
    }
  }
}
