package com.cobbvault.autofill

import android.content.Intent
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// Vault palette — kept here to dodge the white-on-white default that
// Theme.Material3.DayNight gave us on the programmatic UI. Stays
// readable whether the user's system is in light or dark mode.
private const val COLOR_BG = 0xFF0C0A09.toInt()       // stone-950
private const val COLOR_CARD = 0xFF1C1917.toInt()     // stone-900
private const val COLOR_BORDER = 0xFF44403C.toInt()   // stone-700
private const val COLOR_TEXT = 0xFFFAFAF9.toInt()     // stone-50
private const val COLOR_MUTED = 0xFFA8A29E.toInt()    // stone-400
private const val COLOR_ACCENT = 0xFF10B981.toInt()   // emerald-500
private const val COLOR_ACCENT_TEXT = 0xFF052E1A.toInt() // emerald-950 (text on accent)

/**
 * Pair / settings screen. Also the activity the system opens from
 * Settings -> Autofill service gear. The user:
 *   1. Opens "Linked Devices" in the vault, taps "Pair new device",
 *      reads off the 6-digit code.
 *   2. Types it here (with the vault URL + a device name), taps Pair.
 *   3. Taps "Enable Cobb Vault autofill" to set us as the system provider.
 *
 * Built programmatically to keep the scaffold dependency-light — swap for
 * a proper layout + Compose later if desired.
 */
class PairActivity : AppCompatActivity() {

    private lateinit var store: SecureStore
    private lateinit var status: TextView
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = SecureStore(this)
        buildUi()
        render()
    }

    private fun buildUi() {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(COLOR_BG)
            val pad = (24 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
        }
        setContentView(root)
    }

    private fun render() {
        root.removeAllViews()
        addTitle("Cobb Vault Autofill")
        if (store.isPaired) renderPaired() else renderPairing()
    }

    private fun renderPairing() {
        addLabel("Vault URL")
        val urlField = addField(prefill = store.baseUrl ?: "https://www.cobbvault.com")
        addLabel("6-digit pairing code")
        val codeField = addField(prefill = "", numeric = true)
        addLabel("Device name")
        val nameField = addField(prefill = defaultDeviceName())

        addSpacer()
        addText("In the vault, open Settings → Linked Devices → Pair new device to get a code (valid 10 minutes).")

        status = addStatus()

        addButton("Pair") {
            val baseUrl = urlField.text.toString().trim().trimEnd('/')
            val code = codeField.text.toString().trim()
            val name = nameField.text.toString().trim().ifBlank { defaultDeviceName() }
            if (!baseUrl.startsWith("https://")) { setStatus("Vault URL must start with https://"); return@addButton }
            if (!Regex("^\\d{6}$").matches(code)) { setStatus("Code must be 6 digits."); return@addButton }
            pair(baseUrl, code, name)
        }
    }

    private fun renderPaired() {
        addText("Connected as ${store.userName ?: "your account"}.")
        addSpacer()
        status = addStatus()
        addButton("Enable Cobb Vault autofill") { requestAutofillService() }
        addText("If it doesn't open, set it manually: Settings → Passwords & accounts → Autofill service → Cobb Vault.")
        addSpacer()
        addButton("Unpair this device") {
            store.clear()
            Toast.makeText(this, "Unpaired.", Toast.LENGTH_SHORT).show()
            render()
        }
    }

    private fun pair(baseUrl: String, code: String, name: String) {
        setStatus("Pairing…")
        lifecycleScope.launch {
            val result = runCatching {
                withContext(Dispatchers.IO) { VaultApi.pairComplete(baseUrl, code, name) }
            }
            result.onSuccess { r ->
                store.baseUrl = baseUrl
                store.token = r.token
                store.sessionId = r.sessionId
                store.userName = r.userName
                render()
                requestAutofillService()
            }.onFailure { e ->
                setStatus("Pairing failed: ${e.message}")
            }
        }
    }

    /** Prompt the OS to make us the active autofill service. */
    private fun requestAutofillService() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
                    data = Uri.parse("package:$packageName")
                }
                startActivity(intent)
            } catch (e: Exception) {
                setStatus("Open Settings → Passwords & accounts → Autofill service to enable it.")
            }
        }
    }

    private fun defaultDeviceName(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

    // ─── tiny view helpers ──────────────────────────────────────────────────

    private fun addTitle(text: String) = TextView(this).apply {
        this.text = text
        textSize = 22f
        setTextColor(COLOR_TEXT)
        setPadding(0, 0, 0, dp(16))
        root.addView(this)
    }

    private fun addLabel(text: String) = TextView(this).apply {
        this.text = text
        textSize = 12f
        setTextColor(COLOR_MUTED)
        setPadding(0, dp(12), 0, dp(4))
        root.addView(this)
    }

    private fun addField(prefill: String, numeric: Boolean = false): EditText = EditText(this).apply {
        setText(prefill)
        if (numeric) inputType = InputType.TYPE_CLASS_NUMBER
        // Explicit colors — defaults from Theme.Material3.DayNight render
        // black-on-black for EditText on some skins, making the field
        // look empty. Plus a thin border drawable so the field is visible
        // against the stone-950 background.
        setTextColor(COLOR_TEXT)
        setHintTextColor(COLOR_MUTED)
        background = GradientDrawable().apply {
            setColor(COLOR_CARD)
            setStroke(dp(1), COLOR_BORDER)
            cornerRadius = dp(8).toFloat()
        }
        val padH = dp(12)
        val padV = dp(10)
        setPadding(padH, padV, padH, padV)
        val lp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        lp.topMargin = dp(2)
        layoutParams = lp
        root.addView(this)
    }

    private fun addText(text: String) = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTextColor(COLOR_MUTED)
        setPadding(0, dp(8), 0, dp(8))
        root.addView(this)
    }

    private fun addStatus(): TextView = TextView(this).apply {
        textSize = 13f
        setTextColor(COLOR_TEXT)
        gravity = Gravity.START
        setPadding(0, dp(8), 0, dp(8))
        root.addView(this)
    }

    private fun addButton(text: String, onClick: () -> Unit) = Button(this).apply {
        this.text = text
        // Material3's default button styling looks reasonable, but the
        // theme can fight it on some devices — pin the colors so it
        // always reads as an emerald CTA on the dark background.
        setTextColor(COLOR_ACCENT_TEXT)
        background = GradientDrawable().apply {
            setColor(COLOR_ACCENT)
            cornerRadius = dp(10).toFloat()
        }
        setPadding(dp(16), dp(12), dp(16), dp(12))
        val lp = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        lp.topMargin = dp(12)
        layoutParams = lp
        setOnClickListener { onClick() }
        root.addView(this)
    }

    private fun addSpacer() = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(12))
        root.addView(this)
    }

    private fun setStatus(msg: String) { status.text = msg }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

}
