// Plaid client wrapper. Switches between sandbox and production based
// on PLAID_ENV — same client_id, different secret per environment.
// Code that needs Plaid calls `plaid()` to get a configured client.
//
// Env vars expected in .env.local:
//   PLAID_CLIENT_ID
//   PLAID_ENV               'sandbox' | 'production'
//   PLAID_SECRET_SANDBOX    used when PLAID_ENV='sandbox'
//   PLAID_SECRET_PRODUCTION used when PLAID_ENV='production'

import 'server-only'
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

export type PlaidEnv = 'sandbox' | 'production'

export function plaidEnv(): PlaidEnv {
  const e = (process.env.PLAID_ENV ?? '').trim().toLowerCase()
  return e === 'production' ? 'production' : 'sandbox'
}

function plaidSecret(): string {
  const env = plaidEnv()
  const key = env === 'production' ? 'PLAID_SECRET_PRODUCTION' : 'PLAID_SECRET_SANDBOX'
  const v = process.env[key]
  if (!v) throw new Error(`${key} is not set in the environment`)
  return v
}

let _client: PlaidApi | null = null

export function plaid(): PlaidApi {
  if (_client) return _client
  const clientId = process.env.PLAID_CLIENT_ID
  if (!clientId) throw new Error('PLAID_CLIENT_ID is not set in the environment')
  const env = plaidEnv()
  const basePath = env === 'production'
    ? PlaidEnvironments.production
    : PlaidEnvironments.sandbox
  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': plaidSecret(),
      },
    },
  })
  _client = new PlaidApi(config)
  return _client
}
