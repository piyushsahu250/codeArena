package com.codearena.exam

import android.content.Context
import android.content.RestrictionsManager
import java.net.URI

/** Managed configuration pushed by the EMM (app_restrictions.xml). Nothing secret is compiled into the APK. */
data class ExamConfig(
    val appUrl: String,
    val apiUrl: String,
    val deviceId: String,
    val deviceSecret: String,
    val allowedHosts: Set<String>,
    val blockedPackages: List<String>,
    val pinHash: String?,
) {
    fun isAllowed(url: String?): Boolean {
        val u = try { URI(url ?: return false) } catch (e: Exception) { return false }
        // https only: no cleartext, no file:, content:, intent: or javascript: navigation.
        return u.scheme == "https" && u.host != null && allowedHosts.contains(u.host.lowercase())
    }

    companion object {
        /** Returns the config or a human-readable reason it cannot be used (shown on screen; the exam does not start). */
        fun load(context: Context): Pair<ExamConfig?, String?> {
            val b = (context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
            fun s(k: String, d: String = "") = (b.getString(k) ?: d).trim()
            val appUrl = s("app_url", "https://codearena.site")
            val apiUrl = s("api_url", "https://api-aws.codearena.site/api")
            val deviceId = s("device_id")
            val secret = s("device_secret")
            if (deviceId.isEmpty() || secret.length < 16) return null to "This device has no exam registration. Ask the administrator to register it and push its managed configuration."
            if (!appUrl.startsWith("https://") || !apiUrl.startsWith("https://")) return null to "The configured CodeArena addresses must use https."
            val hosts = s("allowed_hosts", "codearena.site,api-aws.codearena.site,fonts.googleapis.com,fonts.gstatic.com")
                .split(",").map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet()
            val blocked = s("blocked_packages", "com.google.android.googlequicksearchbox,com.google.android.apps.bard,com.google.android.apps.googleassistant")
                .split(",").map { it.trim() }.filter { it.isNotEmpty() }
            val pin = s("invigilator_pin_hash").ifEmpty { null }
            return ExamConfig(appUrl, apiUrl.trimEnd('/'), deviceId, secret, hosts, blocked, pin) to null
        }
    }
}
