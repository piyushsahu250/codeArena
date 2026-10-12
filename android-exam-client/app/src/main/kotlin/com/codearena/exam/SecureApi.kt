package com.codearena.exam

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val status: Int, val code: String?, message: String) : Exception(message)

/** Talks to /api/secure-exam/* over https with the platform default TLS (no custom trust managers, no hostname bypass). Blocking: call from a worker thread. */
class SecureApi(private val config: ExamConfig) {
    data class Session(val token: String, val heartbeatSec: Int)
    data class Beat(val locked: Boolean, val ok: Boolean)

    private fun call(path: String, bearer: String, secure: String?, body: JSONObject): Pair<Int, JSONObject> {
        val c = URL(config.apiUrl + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 10_000
            c.readTimeout = 15_000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("Authorization", "Bearer $bearer")
            if (secure != null) c.setRequestProperty("X-Secure-Session", secure)
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = c.responseCode
            val text = (if (status in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
            return status to (try { JSONObject(text) } catch (e: Exception) { JSONObject() })
        } finally { c.disconnect() }
    }

    /** challenge -> signed session. Throws ApiException with the server code (DEVICE_NOT_ALLOWED, SIGNATURE_INVALID, VERSION_MISMATCH, ...). */
    fun establish(studentToken: String, caps: Map<String, Boolean>): Session {
        val (s1, ch) = call("/secure-exam/challenge", studentToken, null, JSONObject().put("deviceId", config.deviceId))
        if (s1 !in 200..299) throw ApiException(s1, ch.optString("code"), ch.optString("error", "challenge refused"))
        val nonce = ch.getString("nonce")
        val sig = Handshake.signSession(config.deviceSecret, nonce, Handshake.CLIENT_VERSION, caps)
        val capsJson = JSONObject().also { j -> Handshake.CAPABILITIES.forEach { k -> j.put(k, caps[k] == true) } }
        val (s2, res) = call(
            "/secure-exam/session", studentToken, null,
            JSONObject().put("deviceId", config.deviceId).put("nonce", nonce).put("sig", sig).put("clientVersion", Handshake.CLIENT_VERSION)
                .put("clientKind", Handshake.CLIENT_KIND).put("capabilities", capsJson),
        )
        if (s2 !in 200..299) throw ApiException(s2, res.optString("code"), res.optString("error", "session refused"))
        return Session(res.getString("token"), res.optInt("heartbeatSec", 15))
    }

    /** Sends the current capability attestation and queued events. The server alone decides whether the exam is locked. */
    fun heartbeat(studentToken: String, secureToken: String, caps: Map<String, Boolean>, events: List<Pair<String, Map<String, Any>>>): Beat {
        val capsJson = JSONObject().also { j -> Handshake.CAPABILITIES.forEach { k -> j.put(k, caps[k] == true) } }
        val evJson = JSONArray()
        events.take(20).forEach { (type, meta) -> evJson.put(JSONObject().put("type", type).put("metadata", JSONObject(meta))) }
        val (status, res) = call("/secure-exam/heartbeat", studentToken, secureToken, JSONObject().put("capabilities", capsJson).put("events", evJson))
        if (status == 403) throw ApiException(status, res.optString("code"), res.optString("error", "session invalid"))
        return Beat(locked = res.optBoolean("locked", false), ok = status in 200..299)
    }

    fun end(studentToken: String, secureToken: String) {
        try { call("/secure-exam/end", studentToken, secureToken, JSONObject()) } catch (e: Exception) { /* best effort */ }
    }
}
