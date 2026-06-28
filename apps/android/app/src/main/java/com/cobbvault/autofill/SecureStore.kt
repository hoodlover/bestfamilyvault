package com.cobbvault.autofill

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Encrypted-at-rest storage for the pairing result. The bearer token is
 * the keys-to-the-kingdom secret, so it lives in EncryptedSharedPreferences
 * (AES256-GCM, key in the Android Keystore) rather than plain prefs.
 *
 * Stored fields:
 *   baseUrl   - vault origin, e.g. https://www.cobbvault.com (no trailing slash)
 *   token     - bearer token returned by /api/clients/pair/complete
 *   sessionId - client_session id (for "revoke this device" later)
 *   userName  - display name ("Connected as Lance")
 */
class SecureStore(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "cobbvault_secure",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var baseUrl: String?
        get() = prefs.getString(KEY_BASE_URL, null)
        set(value) = prefs.edit().putString(KEY_BASE_URL, value).apply()

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    var sessionId: String?
        get() = prefs.getString(KEY_SESSION_ID, null)
        set(value) = prefs.edit().putString(KEY_SESSION_ID, value).apply()

    var userName: String?
        get() = prefs.getString(KEY_USER_NAME, null)
        set(value) = prefs.edit().putString(KEY_USER_NAME, value).apply()

    val isPaired: Boolean
        get() = !token.isNullOrBlank() && !baseUrl.isNullOrBlank()

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_SESSION_ID = "session_id"
        private const val KEY_USER_NAME = "user_name"
    }
}
