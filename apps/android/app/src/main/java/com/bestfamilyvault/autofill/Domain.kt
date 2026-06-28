package com.bestfamilyvault.autofill

/**
 * Registrable-domain (eTLD+1) extraction, mirroring the browser extension's
 * logic in extensions/browser/src/content/autofill.ts so client and server
 * agree on what "the same site" means. The server re-normalizes anyway
 * (src/lib/clients/domain.ts), but normalizing here keeps the query tidy
 * and avoids shipping subdomains around.
 *
 * We don't bundle the full Public Suffix List — just the multi-label TLDs an
 * English-speaking family realistically hits. Everything else uses the
 * last-two-labels rule, correct for .com/.net/.org/.io etc.
 */
object Domain {

    private val MULTI_LABEL_TLDS = setOf(
        "co.uk", "org.uk", "me.uk", "gov.uk", "ac.uk", "ltd.uk", "plc.uk",
        "co.nz", "net.nz", "org.nz", "gov.nz", "ac.nz",
        "com.au", "net.au", "org.au", "gov.au", "edu.au",
        "co.jp", "ne.jp", "or.jp", "go.jp", "ac.jp",
        "co.kr", "or.kr", "go.kr",
        "com.br", "org.br", "gov.br",
    )

    /** Pull a bare hostname out of whatever the autofill structure gave us
     *  (a host, or sometimes a full URL). Returns lowercase host or "". */
    fun host(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        var s = raw.trim().lowercase()
        // Strip scheme if a full URL slipped through.
        s = s.substringAfter("://", s)
        // Strip path / query / port.
        s = s.substringBefore('/').substringBefore('?').substringBefore(':')
        return s
    }

    /** Reduce a hostname to its registrable domain (eTLD+1). */
    fun registrable(rawHost: String?): String {
        val h = host(rawHost)
        if (h.isEmpty()) return ""
        val parts = h.split('.')
        if (parts.size < 2) return h
        val last2 = parts.takeLast(2).joinToString(".")
        if (parts.size >= 3) {
            val last3 = parts.takeLast(3).joinToString(".")
            if (MULTI_LABEL_TLDS.contains(last2)) return last3
        }
        return last2
    }
}
