# Siri Shortcut: "Ask the Vault"

Hands-free vault access on iPhone via Siri. No iOS Developer account
needed — Shortcuts can hit any HTTPS endpoint.

```
"Hey Siri, ask the vault"
→ Siri: "What do you want to ask?"
→ "What's the WiFi password"
→ Siri reads the answer from your vault
```

## Setup walkthrough (~5 minutes)

### 1. Pair the shortcut (one-time)

This is the same flow as the browser extension + Alexa skill — get a
bearer token from the vault.

a. Open the vault on your phone or computer:
   **Settings → Autofill — Linked Devices → Pair new device**.
   Copy the 6-digit code.

b. From any computer terminal:
   ```bash
   curl -X POST https://bestfamilyvault.vercel.app/api/clients/pair/complete \
     -H "Content-Type: application/json" \
     -d '{"code":"123456","name":"Lance iPhone (Siri)","platform":"siri"}'
   ```
   Replace `123456` with your code. **Copy the `token` value** from the
   response — you'll paste it into the shortcut in step 2.6.

### 2. Build the shortcut on your iPhone

1. Open the **Shortcuts** app
2. Tap the **+** in the top-right to create a new shortcut
3. Name it: **Ask the Vault**
4. Add these actions in order:

   **Action 1 — Dictate Text**
   - Search "Dictate"
   - Set language to your preference
   - Set "Stop Listening" to "After Pause"

   **Action 2 — Get Contents of URL**
   - Search "Get contents of URL"
   - URL: `https://bestfamilyvault.vercel.app/api/clients/voice/ask`
   - Tap **Show More**:
     - Method: **POST**
     - Headers:
       - `Authorization` = `Bearer YOUR_TOKEN_HERE` (paste the token from step 1.b)
       - `Content-Type` = `application/json`
     - Request Body: **JSON**
       - Add field: key `question`, value `Dictated Text` (variable from action 1)

   **Action 3 — Get Dictionary Value**
   - Key: `answer`
   - Dictionary: the output of action 2

   **Action 4 — Speak Text**
   - Text: the output of action 3 (the answer string)
   - Voice: your preference

5. Tap **Done** (top right)

### 3. Add the Siri trigger

1. Long-press your new shortcut → **Details**
2. Tap **Add to Siri**
3. Record a phrase: **"Ask the vault"**
4. Save

### 4. Use it

```
"Hey Siri, ask the vault"
→ "What do you want to ask?"
→ "What's the garage code"
→ (Siri speaks the answer)
```

You can also long-press the shortcut on your home screen, or add it as
a home-screen icon (Share → Add to Home Screen) for one-tap access.

### 5. Privacy note

Siri speaks the answer aloud — same caveat as Alexa. Anyone in the
room hears. The vault API returns `sensitive: true` for password-class
answers; you can extend the shortcut later to display a notification
banner instead of speaking when that flag is set:

- After action 2, add **Get Dictionary Value** key=`sensitive`
- **If** that value = true: **Show Notification** with the answer
  (silent — appears as a notification on your screen)
- **Otherwise**: **Speak Text** (current behavior)

This requires a few more action blocks — leave it as v2 if you don't
need it on day one.

## Revoking access

Vault → **Settings → Autofill — Linked Devices** → find "Lance iPhone
(Siri)" → **Revoke**. The shortcut immediately stops working. To use
again, repeat step 1 with a fresh code.
