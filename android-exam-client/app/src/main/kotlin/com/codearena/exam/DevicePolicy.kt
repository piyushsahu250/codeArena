package com.codearena.exam

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager

/**
 * Applies and reads back the supported device-owner policies. Every restriction is applied only while an exam is running and is undone by [release], so
 * nothing here is permanent. Only supported DevicePolicyManager APIs are used: no root, no Accessibility service, no overlay window.
 *
 * Honest limits (see docs/ANDROID_MANAGED_EXAM_MODE.md): which Power-button and assistant behaviours remain depends on the Android version and the
 * manufacturer. The capabilities reported to the server are READ BACK from the device after applying the policy; they are not assumed.
 */
class DevicePolicy(private val context: Context, private val config: ExamConfig) {
    private val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(context, ExamDeviceAdminReceiver::class.java)
    private val pkg = context.packageName

    val isDeviceOwner: Boolean get() = dpm.isDeviceOwnerApp(pkg)

    /** Turns the lock-task allow-list and features on. Returns false (and changes nothing) on a device this app does not own. */
    fun apply(): Boolean {
        if (!isDeviceOwner) return false
        dpm.setLockTaskPackages(admin, arrayOf(pkg))
        // Every feature off: no Home, no Overview (recent apps), no power-menu, no notifications / quick settings, no system info, no keyguard shortcut.
        dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
        dpm.setStatusBarDisabled(admin, true)
        dpm.setScreenCaptureDisabled(admin, true)
        for (p in config.blockedPackages) {
            try { dpm.setApplicationHidden(admin, p, true) } catch (e: Exception) { /* package absent on this device */ }
        }
        return true
    }

    /** Undoes everything [apply] did. Called when the exam ends, on invigilator exit and on a configuration error. */
    fun release() {
        if (!isDeviceOwner) return
        for (p in config.blockedPackages) {
            try { dpm.setApplicationHidden(admin, p, false) } catch (e: Exception) { /* ignore */ }
        }
        dpm.setScreenCaptureDisabled(admin, false)
        dpm.setStatusBarDisabled(admin, false)
        dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_HOME or DevicePolicyManager.LOCK_TASK_FEATURE_OVERVIEW or
            DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS or DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO)
    }

    /**
     * Gives the device back to the institution: after [release], this app stops being device owner. Used for the invigilator-authorised "remove management"
     * recovery. A device that is later needed for exams must be provisioned again (factory reset / QR / zero-touch). clearDeviceOwnerApp is deprecated but is
     * the supported way for a device-owner app to relinquish its own role.
     */
    @Suppress("DEPRECATION")
    fun unenroll() {
        if (!isDeviceOwner) return
        release()
        dpm.clearDeviceOwnerApp(pkg)
    }

    fun lockTaskPermitted(): Boolean = dpm.isLockTaskPermitted(pkg)

    fun lockTaskActive(): Boolean {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
    }

    private fun packageUnavailable(p: String): Boolean {
        if (dpm.isApplicationHidden(admin, p)) return true
        return try { context.packageManager.getPackageInfo(p, 0); false } catch (e: PackageManager.NameNotFoundException) { true }
    }

    /**
     * Reads the real device state. [fullscreen] is the app's own immersive state; [navigationGuard] says the WebView navigation allow-list is installed
     * (code-attested: the guard lives in this app, so it is as trustworthy as the signed, provisioned APK itself).
     */
    fun capabilities(fullscreen: Boolean, navigationGuard: Boolean): Map<String, Boolean> {
        val owner = isDeviceOwner
        val lock = owner && lockTaskActive()
        val features = if (owner) dpm.getLockTaskFeatures(admin) else -1
        fun off(flag: Int) = lock && (features and flag) == 0
        val onlyUs = owner && dpm.getLockTaskPackages(admin).toList() == listOf(pkg)
        val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        return mapOf(
            "deviceOwner" to owner,
            "lockTask" to lock,
            "kiosk" to (lock && onlyUs),
            "homeBlocked" to off(DevicePolicyManager.LOCK_TASK_FEATURE_HOME),
            "overviewBlocked" to off(DevicePolicyManager.LOCK_TASK_FEATURE_OVERVIEW),
            "globalActionsBlocked" to off(DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS),
            "notificationsBlocked" to off(DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS),
            "assistantUnavailable" to (owner && config.blockedPackages.isNotEmpty() && config.blockedPackages.all { packageUnavailable(it) }),
            "screenCaptureProtection" to (owner && dpm.getScreenCaptureDisabled(admin)),
            "appRestriction" to onlyUs,
            "browserRestriction" to navigationGuard,
            "fullscreen" to fullscreen,
            "devtoolsDisabled" to !debuggable,
            // Reserved: the clipboard guard is best effort (cleared on resume), so it is not claimed.
            "clipboard" to false,
        )
    }
}
