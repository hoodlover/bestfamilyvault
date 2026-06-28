package com.bestfamilyvault.autofill

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.service.autofill.Dataset
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.view.ViewGroup
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.RemoteViews
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Always-on fallback for the autofill picker. Surfaces as the
 * "🔍 Search all my logins" row at the bottom of every fill prompt.
 *
 * Flow:
 *   1. Bio gate (same as AuthActivity) — fingerprint / face / device PIN.
 *   2. Full-screen UI: search box + scrollable result list.
 *   3. User types; we debounce ~250ms and call VaultApi.searchCredentials.
 *   4. Tap a row → build a Dataset with the real values + return via
 *      EXTRA_AUTHENTICATION_RESULT. Android performs the fill.
 *
 * Same Intent extras shape as AuthActivity so the calling service stays
 * uniform: usernameId / passwordId on the original form.
 */
class SearchActivity : AppCompatActivity() {

    private lateinit var resultsContainer: LinearLayout
    private lateinit var searchField: EditText
    private lateinit var statusText: TextView
    private lateinit var progress: ProgressBar

    private var usernameId: AutofillId? = null
    private var passwordId: AutofillId? = null

    private var searchJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        usernameId = intent.getParcelableExtraCompat(EXTRA_USERNAME_ID)
        passwordId = intent.getParcelableExtraCompat(EXTRA_PASSWORD_ID)
        if (passwordId == null) { finish(); return }

        setResult(Activity.RESULT_CANCELED)

        // Bio first — same gate as AuthActivity. UI doesn't render until
        // the user passes, so a stolen unlocked phone can't browse all
        // credentials by tapping Search.
        runBiometricGate(
            onSuccess = { buildUi() },
            onFail = { finish() },
        )
    }

    private fun runBiometricGate(onSuccess: () -> Unit, onFail: () -> Unit) {
        val mgr = BiometricManager.from(this)
        val allowed = BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.BIOMETRIC_WEAK or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        if (mgr.canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) {
            onFail()
            return
        }
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onSuccess()
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = onFail()
            })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Search Best Family Vault")
            .setDescription("Verify it's you before browsing saved logins.")
            .setAllowedAuthenticators(allowed)
            .build()
        prompt.authenticate(info)
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(COLOR_BG)
            val pad = dp(16)
            setPadding(pad, dp(24), pad, pad)
        }

        TextView(this).apply {
            text = "Search vault"
            textSize = 18f
            setTextColor(COLOR_TEXT)
            setPadding(0, 0, 0, dp(12))
            root.addView(this)
        }

        searchField = EditText(this).apply {
            hint = "Type to filter — title, username, or url…"
            setTextColor(COLOR_TEXT)
            setHintTextColor(COLOR_MUTED)
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT
            background = GradientDrawable().apply {
                setColor(COLOR_CARD)
                setStroke(dp(1), COLOR_BORDER)
                cornerRadius = dp(8).toFloat()
            }
            setPadding(dp(12), dp(10), dp(12), dp(10))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            )
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    runSearch(s?.toString().orEmpty().trim())
                }
            })
            root.addView(this)
        }

        progress = ProgressBar(this).apply {
            visibility = View.GONE
            val lp = LinearLayout.LayoutParams(dp(20), dp(20))
            lp.topMargin = dp(8)
            layoutParams = lp
        }
        root.addView(progress)

        statusText = TextView(this).apply {
            text = "Type a few letters to find a login."
            setTextColor(COLOR_MUTED)
            setPadding(0, dp(12), 0, dp(8))
            textSize = 12f
            root.addView(this)
        }

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        resultsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        scroll.addView(resultsContainer)
        root.addView(scroll)

        setContentView(root)
        searchField.requestFocus()
    }

    private fun runSearch(q: String) {
        searchJob?.cancel()
        if (q.length < 2) {
            statusText.text = "Type a few letters to find a login."
            resultsContainer.removeAllViews()
            return
        }
        searchJob = lifecycleScope.launch {
            // Debounce — avoids hammering the API on every keystroke.
            delay(250)
            if (!isActive) return@launch
            progress.visibility = View.VISIBLE
            statusText.text = "Searching…"

            val store = SecureStore(this@SearchActivity)
            val baseUrl = store.baseUrl
            val token = store.token
            if (baseUrl == null || token == null) {
                progress.visibility = View.GONE
                statusText.text = "Not paired."
                return@launch
            }

            val results = withContext(Dispatchers.IO) {
                runCatching { VaultApi.searchCredentials(baseUrl, token, q) }
                    .getOrElse { emptyList() }
            }
            if (!isActive) return@launch
            progress.visibility = View.GONE
            renderResults(results, q)
        }
    }

    private fun renderResults(creds: List<VaultApi.Credential>, q: String) {
        resultsContainer.removeAllViews()
        if (creds.isEmpty()) {
            statusText.text = "No logins matching “${q}”."
            return
        }
        statusText.text = "${creds.size} match${if (creds.size == 1) "" else "es"} — tap to fill."
        for (c in creds) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                isClickable = true
                isFocusable = true
                background = GradientDrawable().apply {
                    setColor(COLOR_CARD)
                    setStroke(dp(1), COLOR_BORDER)
                    cornerRadius = dp(8).toFloat()
                }
                val lp = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                )
                lp.topMargin = dp(6)
                layoutParams = lp
                setPadding(dp(12), dp(10), dp(12), dp(10))
                setOnClickListener { pickCredential(c) }
            }
            TextView(this).apply {
                text = c.title
                textSize = 14f
                setTextColor(COLOR_TEXT)
                row.addView(this)
            }
            TextView(this).apply {
                val sub = buildString {
                    if (!c.username.isNullOrBlank()) append(c.username)
                    if (!c.url.isNullOrBlank()) {
                        if (isNotEmpty()) append("  ·  ")
                        append(c.url)
                    }
                }
                text = sub
                textSize = 11f
                setTextColor(COLOR_MUTED)
                setPadding(0, dp(2), 0, 0)
                row.addView(this)
            }
            resultsContainer.addView(row)
        }
    }

    private fun pickCredential(c: VaultApi.Credential) {
        val pwId = passwordId ?: return
        val password = c.password ?: return

        val label = c.title + (if (!c.username.isNullOrBlank()) "  ·  ${c.username}" else "")
        val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item)
            .apply { setTextViewText(android.R.id.text1, label) }
        val ds = Dataset.Builder(presentation)
        usernameId?.let { id ->
            if (!c.username.isNullOrEmpty()) ds.setValue(id, AutofillValue.forText(c.username))
        }
        ds.setValue(pwId, AutofillValue.forText(password))

        val replyIntent = Intent().apply {
            putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, ds.build())
        }
        setResult(Activity.RESULT_OK, replyIntent)
        finish()
    }

    @Suppress("DEPRECATION")
    private inline fun <reified T : android.os.Parcelable> Intent.getParcelableExtraCompat(name: String): T? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getParcelableExtra(name, T::class.java)
        } else {
            getParcelableExtra(name) as? T
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_USERNAME_ID = "username_id"
        const val EXTRA_PASSWORD_ID = "password_id"

        // Vault palette — kept in sync with PairActivity.
        private const val COLOR_BG = 0xFF0C0A09.toInt()
        private const val COLOR_CARD = 0xFF1C1917.toInt()
        private const val COLOR_BORDER = 0xFF44403C.toInt()
        private const val COLOR_TEXT = 0xFFFAFAF9.toInt()
        private const val COLOR_MUTED = 0xFFA8A29E.toInt()
    }
}
