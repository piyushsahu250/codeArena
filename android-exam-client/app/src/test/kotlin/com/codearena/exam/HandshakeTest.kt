package com.codearena.exam

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HandshakeTest {
    private val caps = mapOf(
        "deviceOwner" to true, "lockTask" to true, "kiosk" to true, "homeBlocked" to true, "overviewBlocked" to true, "globalActionsBlocked" to true,
        "notificationsBlocked" to true, "assistantUnavailable" to true, "screenCaptureProtection" to true, "appRestriction" to true, "browserRestriction" to true,
        "fullscreen" to true, "devtoolsDisabled" to true, "clipboard" to false,
    )

    @Test
    fun signatureMatchesTheServerVector() {
        // Same vector as backend/test/secureAndroidClient.test.js, computed independently with openssl.
        assertEquals(
            "6d8d636c32ce078a76aa28b8aad65833e587c9a2df0a0b6509e0bfb9c45a3634",
            Handshake.signSession("test-device-secret", "nonce-123", "1.0.0", caps),
        )
    }

    @Test
    fun aClaimThatChangesTheCapabilitiesChangesTheSignature() {
        val honest = Handshake.signSession("s", "n", "1.0.0", caps)
        val forged = Handshake.signSession("s", "n", "1.0.0", caps + ("clipboard" to true))
        assertNotEquals(honest, forged)
    }

    @Test
    fun missingCapabilitiesAreSignedAsFalse() {
        assertEquals(Handshake.canonicalCaps(emptyMap()), Handshake.CAPABILITIES.joinToString(prefix = "[", postfix = "]", separator = ",") { "[\"$it\",false]" })
    }

    @Test
    fun pinCheckAcceptsTheRightPinAndRejectsEverythingElse() {
        val salt = "00112233445566778899aabbccddeeff"
        val spec = javax.crypto.spec.PBEKeySpec("2468".toCharArray(), ByteArray(16) { i -> (i * 17).toByte() }, Handshake.PIN_ITERATIONS, 256)
        val hash = javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded.joinToString("") { "%02x".format(it) }
        val stored = "$salt:$hash"
        assertTrue(Handshake.verifyPin("2468", stored))
        assertFalse(Handshake.verifyPin("2469", stored))
        assertFalse(Handshake.verifyPin("2468", null))
        assertFalse(Handshake.verifyPin("2468", "not-a-hash"))
        assertFalse(Handshake.verifyPin("2468", "zz:zz"))
    }
}
