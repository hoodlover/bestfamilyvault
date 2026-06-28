# Voice integrations: "Ask the vault"

Hands-free read access to your vault from Alexa or Siri. Same vault API
underneath — both call `POST /api/clients/voice/ask` with a paired
bearer token.

## What's here

- **`alexa/`** — Alexa Skill: manifest, interaction model, Lambda code,
  full setup walkthrough. ~30 minutes one-time to get an Echo working.
- **`siri/`** — Siri Shortcut on iPhone. ~5 minutes to build the
  shortcut on your phone.

## Capabilities

```
"Alexa, ask the vault what's the WiFi password"
"Hey Siri, ask the vault" → "What's the garage code"
"Alexa, ask the vault for River's microchip number"
"Alexa, ask the vault what time is the AAA membership renewal"
```

The vault uses Claude to read your entries + notes and answer in plain
English. Sensitive answers (passwords, account numbers, SSN) come back
with a `sensitive: true` flag the client can use to redirect to a
notification card instead of speaking the value aloud — currently both
the Alexa Skill and Siri Shortcut speak everything; refining the
sensitive-answer flow is a follow-up.

## Pairing

Both clients use the same one-time-code pairing flow as the browser
extension — get a code from **Settings → Autofill — Linked Devices →
Pair new device** and complete the pairing via curl (instructions in
each subfolder's README).

## Voice API surface

`POST /api/clients/voice/ask`

```jsonc
// Headers
Authorization: Bearer <paired_token>
Content-Type: application/json

// Body
{ "question": "what's the wifi password" }

// Response
{
  "answer": "It's 'mountain-river-432'.",
  "sensitive": true
}
```

Same auth model as everything else under `/api/clients/*` — bearer
token, scoped to the paired device, revokable from Linked Devices.
