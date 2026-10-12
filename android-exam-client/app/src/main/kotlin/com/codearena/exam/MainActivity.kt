package com.codearena.exam

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Bundle
import android.os.SystemClock
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * The CodeArena exam screen: one WebView confined to the CodeArena hosts, running inside Lock Task Mode on an institution-owned (device-owner) device.
 *
 *  - The app reports only OBSERVABLE facts (the exam window lost focus, the screen went off, navigation was refused, lock task ended). It never names an
 *    application and never says an assistant was used; the server applies the configured policy to those facts.
 *  - The server is the authority for the timer, attempts, warnings, locking and submission. This app holds no answers, keys or hidden tests.
 *  - The student signs in on the normal CodeArena page inside the WebView; the app then performs the signed handshake with its managed device secret.
 */
class MainActivity : AppCompatActivity() {
    private var config: ExamConfig? = null
    private var policy: DevicePolicy? = null
    private var api: SecureApi? = null
    private lateinit var web: WebView
    private lateinit var status: TextView
    private lateinit var overlay: TextView

    private val events = ConcurrentLinkedQueue<Pair<String, Map<String, Any>>>()
    private val worker: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    @Volatile private var studentToken: String? = null
    @Volatile private var secureToken: String? = null
    @Volatile private var refused: String? = null
    @Volatile private var serverLocked = false
    @Volatile private var lockTaskWasActive = false
    private var focusLostAt = 0L
    private var screenOffAt = 0L
    private var fullscreen = false

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF) screenOffAt = SystemClock.elapsedRealtime()
            if (intent.action == Intent.ACTION_USER_PRESENT && screenOffAt != 0L) {
                events.add("SCREEN_OFF_RESUME" to mapOf("seconds" to ((SystemClock.elapsedRealtime() - screenOffAt) / 1000)))
                screenOffAt = 0L
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Blocks screenshots, screen recording and the recents thumbnail for this window.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        status = TextView(this).apply { setPadding(24, 12, 24, 12); textSize = 13f; setTextColor(Color.WHITE) }
        val invigilator = Button(this).apply { text = "Invigilator"; textSize = 11f; setOnClickListener { askPin() } }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(Color.parseColor("#1f2937"))
            addView(status, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)); addView(invigilator)
        }
        web = WebView(this)
        overlay = TextView(this).apply {
            gravity = Gravity.CENTER; textSize = 18f; setTextColor(Color.WHITE); setBackgroundColor(Color.parseColor("#b91c1c")); setPadding(48, 48, 48, 48); visibility = View.GONE
        }
        val body = android.widget.FrameLayout(this).apply { addView(web, -1, -1); addView(overlay, -1, -1) }
        setContentView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; addView(bar, -1, -2); addView(body, -1, 0).also { (body.layoutParams as LinearLayout.LayoutParams).weight = 1f } })
        enterImmersive()

        val (cfg, error) = ExamConfig.load(this)
        if (cfg == null) { refused = error; render(); return }
        config = cfg
        policy = DevicePolicy(this, cfg).also { p ->
            if (p.apply() && p.lockTaskPermitted()) { try { startLockTask() } catch (e: Exception) { refused = "Lock task could not start: ${e.message}" } }
        }
        api = SecureApi(cfg)
        setupWebView(cfg)
        registerReceiver(screenReceiver, IntentFilter().apply { addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_USER_PRESENT) })
        web.loadUrl(cfg.appUrl)
        worker.scheduleWithFixedDelay({ tick() }, 3, 3, TimeUnit.SECONDS)
        render()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(cfg: ExamConfig) {
        WebView.setWebContentsDebuggingEnabled(false)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            safeBrowsingEnabled = true
        }
        web.setDownloadListener { _, _, _, _, _ -> events.add("EXTERNAL_NAVIGATION" to mapOf("reason" to "download blocked")) }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (cfg.isAllowed(url)) return false
                events.add("EXTERNAL_NAVIGATION" to mapOf("host" to (request.url.host ?: "?")))
                return true
            }
            override fun onPageFinished(view: WebView, url: String?) { injectSecureToken() }
        }
        web.webChromeClient = object : WebChromeClient() {
            // Camera / microphone / location requests from the page are refused: the app requests none of those permissions.
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message?): Boolean {
                events.add("WINDOW_ATTEMPT" to emptyMap()); return false
            }
        }
    }

    /** Periodic worker: establish the secure session once the student has signed in, then heartbeat. Runs off the UI thread. */
    private fun tick() {
        val a = api ?: return
        val p = policy ?: return
        if (refused != null) return
        val active = p.lockTaskActive()
        if (lockTaskWasActive && !active) events.add("KIOSK_EXIT" to mapOf("how" to "lock-task-ended"))
        lockTaskWasActive = active
        if (!active && p.isDeviceOwner && p.lockTaskPermitted()) runOnUiThread { try { startLockTask() } catch (e: Exception) { /* retried next tick */ } }
        runOnUiThread { fetchStudentToken { token -> worker.execute { step(a, p, token) } } }
    }

    private fun fetchStudentToken(done: (String?) -> Unit) {
        web.evaluateJavascript("(function(){try{return localStorage.getItem('token')}catch(e){return null}})()") { raw ->
            val t = raw?.trim()?.removeSurrounding("\"")
            done(if (t.isNullOrEmpty() || t == "null") null else t)
        }
    }

    private fun step(a: SecureApi, p: DevicePolicy, token: String?) {
        if (token == null) { studentToken = null; secureToken = null; runOnUiThread { render() }; return }
        studentToken = token
        val caps = p.capabilities(fullscreen, true)
        try {
            if (secureToken == null) {
                val s = a.establish(token, caps)
                secureToken = s.token
                runOnUiThread { injectSecureToken() }
            }
            val sent = events.toList(); events.clear()
            try {
                val beat = a.heartbeat(token, secureToken!!, caps, sent)
                serverLocked = beat.locked
                refused = null
            } catch (e: ApiException) { events.addAll(sent); throw e } catch (e: Exception) { events.addAll(sent) /* offline: keep the events, the server notices missed heartbeats */ }
        } catch (e: ApiException) {
            // 403 = the session or device is no longer valid: drop it and re-establish on the next tick; the server decides what that means for the attempt.
            secureToken = null
            refused = "${e.message}${e.code?.let { " ($it)" } ?: ""}"
        } catch (e: Exception) { /* offline */ }
        runOnUiThread { render() }
    }

    private fun injectSecureToken() {
        val t = secureToken
        val js = if (t == null) "try{sessionStorage.removeItem('ca_secure_session')}catch(e){}" else "try{sessionStorage.setItem('ca_secure_session','$t')}catch(e){}"
        web.evaluateJavascript(js, null)
    }

    /** Visible lockdown status for the whole attempt (the student and the invigilator can both see it). */
    private fun render() {
        val p = policy
        val caps = p?.capabilities(fullscreen, true)
        val strict = caps != null && caps["deviceOwner"] == true && caps["lockTask"] == true && caps["kiosk"] == true
        when {
            refused != null && secureToken == null && config == null -> { status.text = "Not ready: $refused"; status.setBackgroundColor(Color.parseColor("#b91c1c")) }
            serverLocked -> { overlay.text = "Your exam is locked.\nPlease call your invigilator.\nYour answers and timer are preserved."; overlay.visibility = View.VISIBLE; status.text = "Exam locked"; status.setBackgroundColor(Color.parseColor("#b91c1c")) }
            else -> {
                overlay.visibility = View.GONE
                status.text = when {
                    strict && secureToken != null -> "Lockdown ACTIVE - secure session connected"
                    strict -> "Lockdown active - sign in to start your exam"
                    else -> "Lockdown NOT active on this device${refused?.let { ": $it" } ?: ""}"
                }
                status.setBackgroundColor(Color.parseColor(if (strict && secureToken != null) "#15803d" else if (strict) "#a16207" else "#b91c1c"))
            }
        }
        if (config == null) { overlay.text = refused ?: "Not configured"; overlay.visibility = View.VISIBLE }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            enterImmersive()
            clearClipboard()
            if (focusLostAt != 0L) {
                val seconds = (SystemClock.elapsedRealtime() - focusLostAt) / 1000
                // A brief loss is normal (a system dialog, the keyboard switching); only a lasting one is worth the reviewer's time.
                if (seconds >= 1) events.add("SYSTEM_UI_INTERRUPTION" to mapOf("seconds" to seconds))
                focusLostAt = 0L
            }
        } else if (focusLostAt == 0L) focusLostAt = SystemClock.elapsedRealtime()
    }

    private fun enterImmersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val c = WindowInsetsControllerCompat(window, window.decorView)
        c.hide(WindowInsetsCompat.Type.systemBars())
        c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        fullscreen = true
    }

    private fun clearClipboard() {
        try { (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).clearPrimaryClip() } catch (e: Exception) { /* not permitted in the background on some versions */ }
    }

    // The system Back gesture does nothing: leaving the exam is an invigilator action.
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { /* intentionally ignored */ }

    private fun askPin() {
        val cfg = config ?: return
        val input = EditText(this).apply { inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD }
        AlertDialog.Builder(this).setTitle("Invigilator PIN").setView(input)
            .setPositiveButton("Exit exam") { _, _ ->
                if (Handshake.verifyPin(input.text.toString(), cfg.pinHash)) exitExam()
                else events.add("SECURE_CLIENT_STOPPED" to mapOf("attempt" to "bad-pin"))
            }
            .setNeutralButton("Exit and remove management") { _, _ ->
                if (Handshake.verifyPin(input.text.toString(), cfg.pinHash)) { policy?.unenroll(); exitExam() }
                else events.add("SECURE_CLIENT_STOPPED" to mapOf("attempt" to "bad-pin"))
            }
            .setNegativeButton("Cancel", null).show()
    }

    /** Controlled exit: tells the server, stops lock task and gives the device back its normal behaviour (every restriction applied is undone). */
    private fun exitExam() {
        val a = api; val st = studentToken; val sec = secureToken
        worker.execute { if (a != null && st != null && sec != null) a.end(st, sec) }
        policy?.release()
        try { stopLockTask() } catch (e: Exception) { /* not in lock task */ }
        finish()
    }

    override fun onDestroy() {
        try { unregisterReceiver(screenReceiver) } catch (e: Exception) { /* not registered */ }
        worker.shutdownNow()
        super.onDestroy()
    }
}
