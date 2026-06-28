// AWS Lambda handler for the "Ask the Vault" Alexa Skill.
//
// Deploy:
//   - Runtime: Node.js 20.x
//   - Handler: index.handler
//   - Env vars (set in Lambda console):
//       VAULT_BASE_URL    e.g. https://bestfamilyvault.vercel.app
//       VAULT_BEARER      paste from /settings → Linked Devices → Pair new device
//                         (use the same pairing flow as the browser extension;
//                         get a fresh code, complete it as platform="alexa")
//
// Skill flow:
//   User: "Alexa, ask the vault for the WiFi password"
//   Skill: invokes AskVaultIntent with Question = "for the WiFi password"
//   Lambda: POST {VAULT_BASE_URL}/api/clients/voice/ask with the question
//   Vault:  Claude reads the user's vault, returns answer
//   Lambda: returns Alexa response — speaks the answer
//
// Sensitive answers (password, SSN, account number) come back with
// sensitive=true. v1 still speaks them. v2 will route them to the
// Alexa app's notification card so they're not heard out loud.

const VAULT_BASE_URL = process.env.VAULT_BASE_URL || ''
const VAULT_BEARER = process.env.VAULT_BEARER || ''

function speak(text, options = {}) {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      card: options.card,
      shouldEndSession: options.endSession !== false,
    },
  }
}

async function askVault(question) {
  if (!VAULT_BASE_URL || !VAULT_BEARER) {
    return { answer: "The skill isn't fully set up yet. Check the Lambda environment variables." }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch(`${VAULT_BASE_URL}/api/clients/voice/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VAULT_BEARER}`,
      },
      body: JSON.stringify({ question }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    const data = await res.json()
    if (!res.ok) {
      return { answer: `Vault error: ${data.error || res.status}` }
    }
    return data
  } catch (err) {
    clearTimeout(timer)
    return { answer: `I couldn't reach the vault. ${err.message || err}` }
  }
}

export async function handler(event) {
  const requestType = event?.request?.type
  const intentName = event?.request?.intent?.name

  if (requestType === 'LaunchRequest') {
    return speak("Hi. Ask me anything in the vault — for example, what's the WiFi password.", { endSession: false })
  }

  if (requestType === 'IntentRequest') {
    if (intentName === 'AMAZON.HelpIntent') {
      return speak("Try asking 'what's the WiFi password' or 'where do we keep the cabin keys'. I read the answer from your family vault.", { endSession: false })
    }
    if (intentName === 'AMAZON.CancelIntent' || intentName === 'AMAZON.StopIntent') {
      return speak("Okay.")
    }
    if (intentName === 'AskVaultIntent') {
      const question = event.request.intent.slots?.Question?.value || ''
      if (!question) {
        return speak("I didn't catch the question. What were you looking for?", { endSession: false })
      }
      const data = await askVault(question)
      const card = {
        type: 'Simple',
        title: 'From the vault',
        content: data.answer,
      }
      return speak(data.answer, { card })
    }
  }

  if (requestType === 'SessionEndedRequest') {
    return { version: '1.0', response: {} }
  }

  return speak("Sorry, I didn't understand that.")
}
