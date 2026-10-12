package com.codearena.exam

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

/**
 * Entry point for device-owner provisioning (QR code / zero-touch / EMM / adb on a factory-fresh test device). It does not change any policy by itself:
 * policies are applied by PolicyApplier when an exam starts and undone when it ends or an invigilator exits.
 */
class ExamDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        // Device owner just became active. Nothing is restricted until the exam screen starts.
    }
}
