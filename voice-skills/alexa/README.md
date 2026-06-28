# Alexa Skill: "Ask the Vault"

Hands-free read access to your vault from any Echo. Stays **Account
Only** — never published to the public skill store; only your household
sees it.

```
"Alexa, ask the vault what's the WiFi password"
"Alexa, ask the vault for the garage code"
"Alexa, ask the vault for River's microchip number"
```

## What you'll need (one-time, ~30 minutes)

1. **Amazon Developer account** — free at https://developer.amazon.com.
   Sign in with the same Amazon account your Echos are registered to.
2. **AWS account** — also free for low-volume Lambda. Sign up at
   https://aws.amazon.com if you don't have one.
3. **Pair token** from your vault (see step 4 below).

## Setup walkthrough

### 1. Pair the skill (vault side)

In the vault: **Settings → Autofill — Linked Devices → Pair new device**.
Copy the 6-digit code. We'll use it in step 4.

### 2. Create the AWS Lambda function

1. Go to https://console.aws.amazon.com/lambda → **Create function**
2. Name: `ask-the-vault`
3. Runtime: **Node.js 20.x**
4. Architecture: x86_64 (default fine)
5. Click **Create function**
6. In the code editor, **delete the default `index.mjs`** and paste in
   the contents of [`lambda/index.mjs`](lambda/index.mjs)
7. Click **Deploy**
8. Go to **Configuration → Environment variables → Edit → Add**:
   - `VAULT_BASE_URL` = `https://bestfamilyvault.vercel.app` (or your fork's URL)
   - `VAULT_BEARER` = (we'll fill this in after step 4)
9. Click **Save**
10. **Copy the Function ARN** from the top-right of the page — we need
    it in step 3. Looks like `arn:aws:lambda:us-east-1:123:function:ask-the-vault`

### 3. Create the Alexa Skill

1. Go to https://developer.amazon.com/alexa/console/ask
2. Click **Create Skill**
3. **Name**: `Ask the Vault`
4. **Primary locale**: English (US)
5. **Experience type**: Other
6. **Model**: Custom
7. **Hosting service**: Provision your own
8. Click **Next** → choose template **Start from Scratch** → **Create Skill**

### 4. Pair the skill ↔ vault

1. From the Alexa Developer Console, you don't actually pair via
   account-linking for this private skill. Instead:
2. Open another tab: visit your vault → **Settings → Autofill — Linked
   Devices → Pair new device**. A 6-digit code appears.
3. We need to complete the pairing programmatically (the browser
   extension does this automatically; for the Lambda we do it once
   manually via curl):
   ```bash
   curl -X POST https://bestfamilyvault.vercel.app/api/clients/pair/complete \
     -H "Content-Type: application/json" \
     -d '{"code":"123456","name":"Echo (kitchen)","platform":"alexa"}'
   ```
   Replace `123456` with your code. Response includes `token`.
4. **Copy the `token` value** and paste it into your Lambda's
   `VAULT_BEARER` environment variable (step 2.8 above). Save.

### 5. Wire the skill to your Lambda

Back in the Alexa Developer Console for your skill:

1. Left nav → **Endpoint** → **AWS Lambda ARN**
2. Paste the **Function ARN** from step 2.10 into "Default Region"
3. Copy the **Skill ID** (e.g. `amzn1.ask.skill.abcdef12-...`) shown above
4. Click **Save Endpoints**

### 6. Authorize the skill in Lambda

1. Back in the Lambda console → **Configuration → Triggers → Add
   trigger**
2. Trigger type: **Alexa Skills Kit**
3. Skill ID verification: **Enabled**
4. Skill ID: paste the Skill ID from step 5.3
5. Click **Add**

### 7. Upload the interaction model

1. In the Alexa Developer Console for your skill: **Build** tab
2. Left nav → **JSON Editor**
3. Paste in the contents of [`interaction-model.json`](interaction-model.json)
4. Click **Save Model**
5. Click **Build Model** — wait for "Build successful" (~30s)

### 8. Test it

1. **Test** tab → set "Skill testing is enabled in: **Development**"
2. Type or speak: `ask the vault what's the WiFi password`
3. The right pane shows the request → Lambda → response. The Echo
   in your house can now use the same skill.

### 9. Use it on your Echo

Any Echo logged in to your Amazon account immediately has access to
this skill (because it's in development mode under your account).
Just speak to any device:

```
"Alexa, ask the vault for the WiFi password"
```

## Day-to-day

- **Update the skill code**: edit `lambda/index.mjs`, paste into the
  Lambda console, click Deploy.
- **Update the wake-phrase examples**: edit `interaction-model.json`,
  re-paste into the JSON Editor, click Save + Build.
- **Revoke the pairing**: from the vault → Linked Devices → tap Revoke
  on the Echo entry. The Lambda's bearer immediately stops working;
  re-pair via step 4.

## Sensitive answers

For now the skill speaks every answer aloud, including passwords. v2
will route sensitive answers to the Alexa app's notification card so
they're not heard out loud. The vault API already returns
`sensitive: true` on those — the Lambda just doesn't act on it yet.
