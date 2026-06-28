package com.bestfamilyvault.autofill

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.autofill.Dataset
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat

/**
 * Biometric gate that runs before the system pours a credential into a
 * fillable form. The autofill service hands each picker row a PendingIntent
 * pointing here; tapping a row fires that intent and we:
 *
 *   1. Read the credential (username, password) and the target field ids
 *      out of the launching intent.
 *   2. Run BiometricPrompt with DEVICE_CREDENTIAL fallback — fingerprint
 *      or face, otherwise the phone's PIN/pattern.
 *   3. On success, build a fresh Dataset with the real values and return
 *      it via EXTRA_AUTHENTICATION_RESULT. Android then performs the fill.
 *   4. On cancel / failure, finish without setting a result — nothing
 *      gets filled.
 *
 * Why pass the values through the intent at all (vs. re-fetching from the
 * vault by id): the picker presentation already had them in process, the
 * extras stay inside our app's IPC, and the alternative is a network call
 * per fill which would noticeably slow the picker. Trade-off documented;
 * a hardened v2 could re-fetch by id and rotate ephemeral keys.
 */
class AuthActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val username = intent.getStringExtra(EXTRA_USERNAME)
        val password = intent.getStringExtra(EXTRA_PASSWORD)
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "credential"
        val usernameId: AutofillId? = intent.getParcelableExtraCompat(EXTRA_USERNAME_ID)
        val passwordId: AutofillId? = intent.getParcelableExtraCompat(EXTRA_PASSWORD_ID)

        // The autofill framework requires we EVENTUALLY call setResult and
        // finish. Default to "canceled" so any path that doesn't explicitly
        // succeed leaves the form untouched.
        setResult(Activity.RESULT_CANCELED)

        if (passwordId == null || password.isNullOrEmpty()) {
            finish()
            return
        }

        runBiometricGate(
            title = title,
            onSuccess = {
                fillAndFinish(usernameId, username, passwordId, password, title)
            },
            onFail = { finish() },
        )
    }

    private fun runBiometricGate(
        title: String,
        onSuccess: () -> Unit,
        onFail: () -> Unit,
    ) {
        val mgr = BiometricManager.from(this)
        val allowedAuthenticators =
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
                BiometricManager.Authenticators.BIOMETRIC_WEAK or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
        val canAuth = mgr.canAuthenticate(allowedAuthenticators)
        if (canAuth != BiometricManager.BIOMETRIC_SUCCESS) {
            // Device has no biometric AND no device credential set up. Bail
            // rather than fill silently — a vault that fills on an unlocked
            // factory-reset phone is a bigger leak than a missed fill.
            onFail()
            return
        }

        val executor = ContextCompat.getMainExecutor(this)
        val prompt = BiometricPrompt(this, executor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                onSuccess()
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                onFail()
            }
            override fun onAuthenticationFailed() {
                // One miss is not a hard fail — BiometricPrompt lets the
                // user try again. Only onAuthenticationError finishes us.
            }
        })

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Fill from Best Family Vault")
            .setSubtitle(title)
            .setDescription("Verify it's you before the password fills.")
            .setAllowedAuthenticators(allowedAuthenticators)
            // setNegativeButtonText is incompatible with DEVICE_CREDENTIAL —
            // BiometricPrompt provides Cancel + a fallback button itself.
            .build()

        prompt.authenticate(info)
    }

    private fun fillAndFinish(
        usernameId: AutofillId?,
        username: String?,
        passwordId: AutofillId,
        password: String,
        title: String,
    ) {
        // Build a fresh Dataset with the REAL values. The picker dataset
        // was a placeholder behind setAuthentication(); this one is what
        // actually fills the form.
        val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item)
            .apply { setTextViewText(android.R.id.text1, title) }

        val ds = Dataset.Builder(presentation)
        if (usernameId != null && !username.isNullOrEmpty()) {
            ds.setValue(usernameId, AutofillValue.forText(username))
        }
        ds.setValue(passwordId, AutofillValue.forText(password))

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

    companion object {
        const val EXTRA_USERNAME = "username"
        const val EXTRA_PASSWORD = "password"
        const val EXTRA_TITLE = "title"
        const val EXTRA_USERNAME_ID = "username_id"
        const val EXTRA_PASSWORD_ID = "password_id"
    }
}
