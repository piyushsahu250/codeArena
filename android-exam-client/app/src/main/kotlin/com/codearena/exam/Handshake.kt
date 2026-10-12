package com.codearena.exam

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.SecretKeySpec

/**
 * Client side of the secure-session handshake. MUST stay byte-compatible with backend/src/utils/secureExam.js (clientSignature / canonicalCaps for the
 * ANDROID_MANAGED kind). The same test vector is asserted in backend/test/secureAndroidClient.test.js and in HandshakeTest.kt.
 */
object Handshake {
    const val CLIENT_KIND = "ANDROID_MANAGED"
    const val CLIENT_VERSION = "1.0.0"

    /** Order matters: it is the order the server signs. */
    val CAPABILITIES = listOf(
        "deviceOwner", "lockTask", "kiosk", "homeBlocked", "overviewBlocked", "globalActionsBlocked", "notificationsBlocked", "assistantUnavailable",
        "screenCaptureProtection", "appRestriction", "browserRestriction", "fullscreen", "devtoolsDisabled", "clipboard",
    )

    /** JSON.stringify(CAPABILITIES.map(k => [k, !!caps[k]])) - compact, no spaces, keys are plain ASCII. */
    fun canonicalCaps(caps: Map<String, Boolean>): String =
        CAPABILITIES.joinToString(prefix = "[", postfix = "]", separator = ",") { k -> "[\"$k\",${caps[k] == true}]" }

    fun hmacHex(secret: String, data: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(data.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }

    fun signSession(deviceSecret: String, nonce: String, clientVersion: String, caps: Map<String, Boolean>): String =
        hmacHex(deviceSecret, "session|$nonce|$clientVersion|$CLIENT_KIND|${canonicalCaps(caps)}")

    /** PBKDF2-HMAC-SHA256 invigilator PIN check against "saltHex:hashHex" (constant-time compare). */
    fun verifyPin(pin: String, stored: String?): Boolean {
        if (stored.isNullOrBlank() || !stored.contains(":")) return false
        val (saltHex, hashHex) = stored.split(":", limit = 2)
        val salt = hexToBytes(saltHex) ?: return false
        val expected = hexToBytes(hashHex) ?: return false
        val spec = javax.crypto.spec.PBEKeySpec(pin.toCharArray(), salt, PIN_ITERATIONS, expected.size * 8)
        val actual = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        return MessageDigest.isEqual(actual, expected)
    }

    const val PIN_ITERATIONS = 120_000

    private fun hexToBytes(s: String): ByteArray? {
        if (s.isEmpty() || s.length % 2 != 0) return null
        return try { ByteArray(s.length / 2) { i -> s.substring(i * 2, i * 2 + 2).toInt(16).toByte() } } catch (e: NumberFormatException) { null }
    }
}
