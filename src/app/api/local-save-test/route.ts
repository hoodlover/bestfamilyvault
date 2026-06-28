import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { getRailHelperDataDir } from '@/lib/local-data-dir'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TEST_FILE = 'railhelper-local-save-test.json'

async function readSavedTest(dataDir: string) {
  try {
    const raw = await readFile(path.join(dataDir, TEST_FILE), 'utf8')
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const dataDir = await getRailHelperDataDir()
    const saved = await readSavedTest(dataDir)
    return NextResponse.json({ ok: true, dataDir, fileName: TEST_FILE, saved })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { message?: unknown }
    const dataDir = await getRailHelperDataDir()
    const saved = {
      message: typeof body.message === 'string' ? body.message : 'Local save test',
      savedAt: new Date().toISOString(),
      dataDir,
    }

    await writeFile(path.join(dataDir, TEST_FILE), JSON.stringify(saved, null, 2), 'utf8')
    return NextResponse.json({ ok: true, dataDir, fileName: TEST_FILE, saved })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

