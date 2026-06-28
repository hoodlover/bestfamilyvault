import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

type DbClient = ReturnType<typeof drizzle<typeof schema>>

let dbClient: DbClient | null = null

export function getDb(): DbClient {
  if (!dbClient) {
    const sql = neon(process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost/placeholder')
    dbClient = drizzle(sql, { schema })
  }
  return dbClient
}

export const db = new Proxy({} as DbClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver)
  },
})

export type DB = DbClient
