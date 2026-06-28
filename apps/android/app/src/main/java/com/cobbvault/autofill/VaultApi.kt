package com.cobbvault.autofill

import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Thin client for the vault's `/api/clients/` surface — the SAME endpoints
 * the browser extension uses. Bearer-token auth, no cookies.
 *
 * (Watch the doc text: Kotlin allows NESTED block comments, so a literal
 * `/` followed by `*` inside this KDoc opens a new comment that has to be
 * closed before the outer one can — wrap any such URL in backticks, like
 * above, to keep the parser happy.)
 *
 * These are blocking calls; invoke from a background thread / Dispatchers.IO.
 * On non-2xx they throw ApiException carrying the server's {error} message.
 */
object VaultApi {

    private const val TIMEOUT_MS = 12_000

    class ApiException(val status: Int, message: String) : Exception(message)

    data class PairResult(val token: String, val sessionId: String, val userName: String?)

    data class Credential(
        val id: String,
        val title: String,
        val username: String?,
        val password: String?,
        val url: String?,
    )

    /** Redeem a 6-digit pairing code for a long-lived bearer token. */
    fun pairComplete(baseUrl: String, code: String, deviceName: String): PairResult {
        val body = JSONObject()
            .put("code", code)
            .put("name", deviceName)
            .put("platform", "android")
            .toString()
        val res = post("$baseUrl/api/clients/pair/complete", body, token = null)
        val json = JSONObject(res)
        return PairResult(
            token = json.getString("token"),
            sessionId = json.getString("sessionId"),
            userName = json.optString("userName").ifBlank { null },
        )
    }

    /** Fetch login credentials matching a domain. Empty list if none. */
    fun getCredentials(baseUrl: String, token: String, domain: String): List<Credential> {
        val q = URLEncoder.encode(domain, "UTF-8")
        return parseCredentialsList(get("$baseUrl/api/clients/credentials?domain=$q", token))
    }

    /**
     * Free-text search across the user's visible credentials (title + username
     * + url substring). Used for native-app heuristic match (e.g. package
     * `com.bankofamerica.app` becomes the query "bankofamerica") and for the
     * SearchActivity's live filter as the user types.
     */
    fun searchCredentials(baseUrl: String, token: String, q: String): List<Credential> {
        val encoded = URLEncoder.encode(q, "UTF-8")
        return parseCredentialsList(get("$baseUrl/api/clients/credentials?q=$encoded", token))
    }

    /**
     * Capture a freshly-typed credential. The server picks a default category
     * for it (the user's most-used login category) and the resulting entry is
     * personal — only the pairing user can see it until they reclassify in
     * the vault UI.
     *
     * Title carries whatever recognizable string we could pull from the
     * source: registrable domain for web fills, app label or package id for
     * native fills.
     */
    fun saveCredential(
        baseUrl: String,
        token: String,
        title: String,
        username: String?,
        password: String,
        url: String?,
    ): String {
        val body = JSONObject()
            .put("title", title)
            .put("username", username ?: JSONObject.NULL)
            .put("password", password)
            .put("url", url ?: JSONObject.NULL)
            .toString()
        val res = post("$baseUrl/api/clients/credentials", body, token)
        return JSONObject(res).optString("id")
    }

    private fun parseCredentialsList(json: String): List<Credential> {
        val arr = JSONObject(json).optJSONArray("credentials") ?: return emptyList()
        val out = ArrayList<Credential>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(
                Credential(
                    id = o.getString("id"),
                    title = o.optString("title"),
                    username = o.optString("username").ifBlank { null },
                    password = o.optString("password").ifBlank { null },
                    url = o.optString("url").ifBlank { null },
                )
            )
        }
        return out
    }

    // ─── HTTP plumbing ──────────────────────────────────────────────────────

    private fun get(urlStr: String, token: String?): String =
        request("GET", urlStr, null, token)

    private fun post(urlStr: String, body: String, token: String?): String =
        request("POST", urlStr, body, token)

    private fun request(method: String, urlStr: String, body: String?, token: String?): String {
        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            setRequestProperty("Accept", "application/json")
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (body != null) {
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
            if (status !in 200..299) {
                val msg = runCatching { JSONObject(text).optString("error") }
                    .getOrNull()
                    ?.takeIf { it.isNotBlank() }
                    ?: "HTTP $status"
                throw ApiException(status, msg)
            }
            return text
        } finally {
            conn.disconnect()
        }
    }
}
