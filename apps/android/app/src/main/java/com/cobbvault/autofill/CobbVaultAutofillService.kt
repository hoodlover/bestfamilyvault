package com.cobbvault.autofill

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * The system binds to this when the user focuses a fillable field in any
 * app/browser. We:
 *   1. Walk the AssistStructure for the web domain + username/password fields.
 *   2. Ask the vault (/api/clients/credentials?domain=) for matches.
 *   3. Return one Dataset per match; tapping it fills username + password.
 *
 * v1 = BROWSER logins only: we key off each node's webDomain. Native-app
 * fields (no webDomain) are skipped for now.
 *
 * NOTE (security follow-up): v1 fills directly. A hardened version wraps
 * each Dataset in an authentication IntentSender that runs BiometricPrompt
 * before the real values are released. Scaffolded here; not yet wired.
 */
class CobbVaultAutofillService : AutofillService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback,
    ) {
        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) { callback.onSuccess(null); return }

        val parsed = parseStructure(structure)
        val store = SecureStore(this)

        // Nothing to do unless we're paired and looking at a login-shaped
        // form (a password field present). Both web AND native forms are
        // supported now — web uses webDomain for the trust boundary, native
        // uses the activity's package name with a heuristic match.
        if (!store.isPaired || parsed.passwordId == null) {
            callback.onSuccess(null)
            return
        }

        // Capture as stable non-null locals for use inside the coroutine.
        val passwordId: AutofillId = parsed.passwordId
        val usernameId: AutofillId? = parsed.usernameId
        val baseUrl = store.baseUrl!!
        val token = store.token!!

        // Source key + lookup mode. Web wins when both are present (Chrome
        // running an app's web view still gets webDomain set on its nodes).
        val isWeb = !parsed.webDomain.isNullOrBlank()
        val activityPackage = structure.activityComponent?.packageName
        val lookupKey: String = when {
            isWeb -> Domain.registrable(parsed.webDomain)
            !activityPackage.isNullOrBlank() -> activityPackage
            else -> {
                callback.onSuccess(null)
                return
            }
        }

        cancellationSignal.setOnCancelListener { /* coroutine result simply ignored */ }

        scope.launch {
            // Cache by lookup key. The first fill in a process lifetime
            // still pays the network round-trip (and Vercel cold-start),
            // but every subsequent focus on the same site or app — and
            // jumping from username to password field on the same form —
            // is instant. Without this, the picker often missed its
            // initial draw window and only appeared after typing a char.
            val creds = getCachedCredentials(lookupKey) ?: run {
                val fetched = runCatching {
                    if (isWeb) {
                        VaultApi.getCredentials(baseUrl, token, lookupKey)
                    } else {
                        // Native-app heuristic: derive a search term from
                        // the package name (com.bankofamerica.app →
                        // "bankofamerica") and free-text search the vault.
                        // Misses apps with cryptic packages (com.infonow.bofa
                        // is the actual BofA package — outsourced) but the
                        // Search vault row at the bottom is the always-works
                        // fallback for those.
                        val term = extractSearchKey(lookupKey)
                        if (term.isNotBlank()) {
                            VaultApi.searchCredentials(baseUrl, token, term)
                        } else emptyList()
                    }
                }.getOrElse { emptyList() }
                cacheCredentials(lookupKey, fetched)
                fetched
            }

            // Always render at least the Search row so the user has an
            // out when the auto-match missed (e.g. native app with a
            // cryptic package). Skipping callback.onSuccess(null) here is
            // a deliberate change from the previous behavior.
            val response = FillResponse.Builder()
            for ((idx, c) in creds.withIndex()) {
                val label = buildString {
                    append(c.title)
                    if (!c.username.isNullOrBlank()) append("  ·  ").append(c.username)
                }
                // Custom RemoteViews layout — android.R.layout.simple_list_item_1
                // inherits the host app's theme attributes, which on Samsung One UI
                // (and other skins with aggressive contrast adjustments) rendered
                // the row as white text on a white background. Our own layout
                // bakes in explicit hex colors so the picker is always legible.
                val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item)
                    .apply { setTextViewText(android.R.id.text1, label) }

                // Biometric gate: each row's PendingIntent launches
                // AuthActivity, which runs BiometricPrompt (with DEVICE_
                // CREDENTIAL fallback) before letting the real values
                // reach the form. Without this, a stolen unlocked phone
                // could autofill the vault into any app — bad for a
                // password manager.
                val authIntent = Intent(this@CobbVaultAutofillService, AuthActivity::class.java).apply {
                    putExtra(AuthActivity.EXTRA_USERNAME, c.username ?: "")
                    putExtra(AuthActivity.EXTRA_PASSWORD, c.password ?: "")
                    putExtra(AuthActivity.EXTRA_TITLE, label)
                    putExtra(AuthActivity.EXTRA_USERNAME_ID, usernameId)
                    putExtra(AuthActivity.EXTRA_PASSWORD_ID, passwordId)
                }
                val pendingIntent = PendingIntent.getActivity(
                    this@CobbVaultAutofillService,
                    idx, // unique requestCode so PendingIntents don't collide
                    authIntent,
                    PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE,
                )

                // The dataset presented to the user is a PLACEHOLDER —
                // setValue() with empty values is required by the API so
                // the system knows which fields this dataset targets, but
                // the real values come back from AuthActivity after auth.
                val ds = Dataset.Builder(presentation)
                usernameId?.let { id -> ds.setValue(id, AutofillValue.forText("")) }
                ds.setValue(passwordId, AutofillValue.forText(""))
                ds.setAuthentication(pendingIntent.intentSender)
                response.addDataset(ds.build())
            }

            // SaveInfo — tells Android to surface its native "Save
            // password?" prompt when the user submits a form whose
            // password field changed. Without this, onSaveRequest never
            // fires. Type is PASSWORD (with USERNAME optional). Required
            // ids must be set OR the prompt won't appear.
            val saveInfoBuilder = SaveInfo.Builder(
                SaveInfo.SAVE_DATA_TYPE_PASSWORD or SaveInfo.SAVE_DATA_TYPE_USERNAME,
                arrayOf(passwordId),
            )
            if (usernameId != null) {
                saveInfoBuilder.setOptionalIds(arrayOf(usernameId))
            }
            response.setSaveInfo(saveInfoBuilder.build())

            // Always-on "Search vault" row. Launches SearchActivity which
            // runs bio + lets the user type to live-filter against all
            // their visible credentials, then returns the chosen Dataset
            // via EXTRA_AUTHENTICATION_RESULT.
            run {
                val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item)
                    .apply { setTextViewText(android.R.id.text1, "🔍  Search all my logins") }
                val searchIntent = Intent(this@CobbVaultAutofillService, SearchActivity::class.java).apply {
                    putExtra(SearchActivity.EXTRA_USERNAME_ID, usernameId)
                    putExtra(SearchActivity.EXTRA_PASSWORD_ID, passwordId)
                }
                val pi = PendingIntent.getActivity(
                    this@CobbVaultAutofillService,
                    1000 + creds.size, // requestCode distinct from the per-cred rows
                    searchIntent,
                    PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                val ds = Dataset.Builder(presentation)
                usernameId?.let { id -> ds.setValue(id, AutofillValue.forText("")) }
                ds.setValue(passwordId, AutofillValue.forText(""))
                ds.setAuthentication(pi.intentSender)
                response.addDataset(ds.build())
            }

            callback.onSuccess(response.build())
        }
    }

    /**
     * Extract a search-term from a package name to feed the vault's free-text
     * search (matches title + username + url). Drops common TLD prefixes
     * (com/org/io/...) and obviously generic words (app/android/mobile/...),
     * returning the longest remaining segment — typically the brand name.
     *
     * Examples:
     *   com.bankofamerica.app  → "bankofamerica"
     *   com.facebook.katana    → "facebook"
     *   org.thoughtcrime.securesms → "thoughtcrime" (misses Signal — that's
     *                           a heuristic miss; user falls back to Search)
     */
    private fun extractSearchKey(packageName: String): String {
        val tlds = setOf("com", "org", "net", "io", "co", "edu", "gov", "us", "uk")
        val generic = setOf(
            "app", "android", "mobile", "client", "official", "katana",
            "play", "services", "wear", "tv",
        )
        val parts = packageName.split('.').filter { it.isNotBlank() }
        val filtered = parts.filterIndexed { i, s -> !(i == 0 && tlds.contains(s)) }
            .filter { !generic.contains(it) }
        if (filtered.isEmpty()) return ""
        return filtered.maxBy { it.length }
    }

    /**
     * Fires when the user accepts Android's native "Save password for
     * Cobb Vault?" prompt. The framework hands us the latest snapshot of
     * the form; we walk it to recover the typed username/password, derive
     * a title from the source (registrable domain for web, app label for
     * native), and POST to /api/clients/credentials. Cache is busted so
     * the next fill on this site/app sees the new entry immediately.
     */
    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure
        if (structure == null) { callback.onSuccess(); return }

        val store = SecureStore(this)
        if (!store.isPaired) { callback.onSuccess(); return }

        val draft = extractSaveDraft(structure)
        if (draft == null || draft.password.isBlank()) {
            // Nothing meaningful to save. Tell the framework all went well
            // so it doesn't show the user a failure toast.
            callback.onSuccess()
            return
        }

        val baseUrl = store.baseUrl ?: run { callback.onSuccess(); return }
        val token = store.token ?: run { callback.onSuccess(); return }
        val title = draft.title
        val lookupKey = draft.lookupKey

        scope.launch {
            runCatching {
                VaultApi.saveCredential(
                    baseUrl = baseUrl,
                    token = token,
                    title = title,
                    username = draft.username,
                    password = draft.password,
                    url = draft.url,
                )
            }
            // Bust the in-process cache so the next focus on this domain
            // / package re-fetches and includes the just-saved credential.
            cache.remove(lookupKey)
            callback.onSuccess()
        }
    }

    private data class SaveDraft(
        val title: String,
        val username: String?,
        val password: String,
        val url: String?,
        val lookupKey: String,
    )

    private fun extractSaveDraft(structure: AssistStructure): SaveDraft? {
        var webDomain: String? = null
        var usernameValue: String? = null
        var passwordValue: String? = null
        var lastTextValueBeforePassword: String? = null

        fun visit(node: AssistStructure.ViewNode) {
            node.webDomain?.takeIf { it.isNotBlank() }?.let { if (webDomain == null) webDomain = it }

            val hints = node.autofillHints?.map { it.lowercase() } ?: emptyList()
            val htmlType = node.htmlInfo?.attributes
                ?.firstOrNull { it.first.equals("type", ignoreCase = true) }
                ?.second?.lowercase()
            val isPassword = hints.contains(View.AUTOFILL_HINT_PASSWORD) ||
                htmlType == "password" ||
                isPasswordInputType(node.inputType)
            val isUsername = hints.contains(View.AUTOFILL_HINT_USERNAME) ||
                hints.contains(View.AUTOFILL_HINT_EMAIL_ADDRESS) ||
                htmlType == "email"

            val value = node.autofillValue?.takeIf { it.isText }?.textValue?.toString()
            if (!value.isNullOrEmpty()) {
                when {
                    isPassword && passwordValue == null -> passwordValue = value
                    isUsername && usernameValue == null -> usernameValue = value
                    passwordValue == null -> lastTextValueBeforePassword = value
                }
            }

            for (i in 0 until node.childCount) visit(node.getChildAt(i))
        }

        for (i in 0 until structure.windowNodeCount) {
            visit(structure.getWindowNodeAt(i).rootViewNode)
        }

        val finalPassword = passwordValue ?: return null
        // Fall back to the text we saw immediately before the password
        // field when there was no explicit username hint — same heuristic
        // parseStructure uses to pick the username field.
        val finalUsername = usernameValue ?: lastTextValueBeforePassword

        val pkg = structure.activityComponent?.packageName
        val (title, url, lookupKey) = when {
            !webDomain.isNullOrBlank() -> {
                val reg = Domain.registrable(webDomain)
                Triple(reg, "https://$reg", reg)
            }
            !pkg.isNullOrBlank() -> {
                // Try to surface a user-recognizable app label rather than
                // the package id. PackageManager.getApplicationLabel falls
                // back to the package on failure, which is good enough.
                val label = runCatching {
                    val info = packageManager.getApplicationInfo(pkg, 0)
                    packageManager.getApplicationLabel(info).toString()
                }.getOrDefault(pkg)
                Triple(label, null, pkg)
            }
            else -> return null
        }

        return SaveDraft(
            title = title,
            username = finalUsername,
            password = finalPassword,
            url = url,
            lookupKey = lookupKey,
        )
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    // ─── Structure parsing ──────────────────────────────────────────────────

    private data class Parsed(
        val usernameId: AutofillId?,
        val passwordId: AutofillId?,
        val webDomain: String?,
    )

    private fun parseStructure(structure: AssistStructure): Parsed {
        var webDomain: String? = null
        var passwordId: AutofillId? = null
        var explicitUsernameId: AutofillId? = null
        var lastTextBeforePassword: AutofillId? = null
        var firstTextId: AutofillId? = null

        fun visit(node: AssistStructure.ViewNode) {
            node.webDomain?.takeIf { it.isNotBlank() }?.let { if (webDomain == null) webDomain = it }

            val id = node.autofillId
            if (id != null) {
                val hints = node.autofillHints?.map { it.lowercase() } ?: emptyList()
                val htmlType = node.htmlInfo?.attributes
                    ?.firstOrNull { it.first.equals("type", ignoreCase = true) }
                    ?.second?.lowercase()

                val isPassword = hints.contains(View.AUTOFILL_HINT_PASSWORD) ||
                    htmlType == "password" ||
                    isPasswordInputType(node.inputType)

                val isUsername = hints.contains(View.AUTOFILL_HINT_USERNAME) ||
                    hints.contains(View.AUTOFILL_HINT_EMAIL_ADDRESS) ||
                    htmlType == "email"

                val isEditableText = node.className?.contains("EditText") == true ||
                    htmlType == "text" || htmlType == "email" || node.inputType != 0

                when {
                    isPassword && passwordId == null -> passwordId = id
                    isUsername && explicitUsernameId == null -> explicitUsernameId = id
                    isEditableText -> {
                        if (firstTextId == null) firstTextId = id
                        if (passwordId == null) lastTextBeforePassword = id
                    }
                }
            }

            for (i in 0 until node.childCount) visit(node.getChildAt(i))
        }

        for (i in 0 until structure.windowNodeCount) {
            visit(structure.getWindowNodeAt(i).rootViewNode)
        }

        // Username preference: explicit hint > the text field right before
        // the password > the first text field on the form.
        val usernameId = explicitUsernameId ?: lastTextBeforePassword ?: firstTextId
        return Parsed(usernameId, passwordId, webDomain)
    }

    private fun isPasswordInputType(inputType: Int): Boolean {
        if (inputType and InputType.TYPE_MASK_CLASS != InputType.TYPE_CLASS_TEXT) return false
        return when (inputType and InputType.TYPE_MASK_VARIATION) {
            InputType.TYPE_TEXT_VARIATION_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD -> true
            else -> false
        }
    }

    // ─── Credential cache ───────────────────────────────────────────────────
    //
    // ConcurrentHashMap because onFillRequest can fire on multiple coroutines
    // when two password fields are present (e.g. signup forms). Process-scoped
    // so it dies when the autofill service is reclaimed by the system —
    // that's fine, the next fill warms it back up.

    private fun getCachedCredentials(domain: String): List<VaultApi.Credential>? {
        val entry = cache[domain] ?: return null
        if (System.currentTimeMillis() - entry.fetchedAt > CACHE_TTL_MS) {
            cache.remove(domain)
            return null
        }
        return entry.creds
    }

    private fun cacheCredentials(domain: String, creds: List<VaultApi.Credential>) {
        cache[domain] = CacheEntry(creds, System.currentTimeMillis())
    }

    private data class CacheEntry(val creds: List<VaultApi.Credential>, val fetchedAt: Long)

    companion object {
        private const val CACHE_TTL_MS = 5 * 60 * 1000L
        private val cache: MutableMap<String, CacheEntry> = ConcurrentHashMap()
    }
}
