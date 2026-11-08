package ch.sterneversenken.app

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Hülle für das Spiel. Die Oberfläche ist HTML/JS (Ordner /web), die Verbindung
 * zwischen zwei Handys läuft über [NearbyBridge] (Google Nearby Connections).
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var bridge: NearbyBridge
    private var permissionCallback: ((List<String>) -> Unit)? = null

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            val callback = permissionCallback
            permissionCallback = null
            // Nach dem Dialog den tatsächlichen Stand prüfen, nicht nur die Antwort.
            callback?.invoke(blockingMissing())
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val root = FrameLayout(this).apply { setBackgroundColor(SPACE) }
        webView = WebView(this).apply { setBackgroundColor(SPACE) }
        root.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        setContentView(root)

        // Randlos zeichnen, Inhalt aber von Status- und Navigationsleiste fernhalten.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.updatePadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
            setSupportZoom(false)
        }
        webView.webViewClient = AssetClient()

        bridge = NearbyBridge(this, webView)
        webView.addJavascriptInterface(bridge, "AndroidBridge")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript("window.App ? window.App.onBack() : false") { result ->
                    if (result != "true") finish()
                }
            }
        })

        webView.loadUrl(START_URL)
    }

    override fun onResume() {
        super.onResume()
        if (::bridge.isInitialized) bridge.onResume()
    }

    override fun onDestroy() {
        bridge.shutdown()
        webView.removeJavascriptInterface("AndroidBridge")
        webView.destroy()
        super.onDestroy()
    }

    /**
     * Fragt die für Nearby nötigen Berechtigungen an. `callback` bekommt die Liste der
     * Berechtigungen, die danach noch fehlen (leer = alles in Ordnung).
     */
    fun ensureNearbyPermissions(callback: (List<String>) -> Unit) {
        val missing = notGranted(nearbyPermissions())
        if (missing.isEmpty()) {
            callback(emptyList())
            return
        }
        permissionCallback = callback
        permissionLauncher.launch(missing.toTypedArray())
    }

    /**
     * Nearby verlangt auch auf neuen Android-Versionen den Standort, zusätzlich zu
     * „Geräte in der Nähe“ (Bluetooth und ab Android 13 WLAN).
     */
    private fun nearbyPermissions(): List<String> = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            add(Manifest.permission.BLUETOOTH_SCAN)
            add(Manifest.permission.BLUETOOTH_ADVERTISE)
            add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            add(Manifest.permission.NEARBY_WIFI_DEVICES)
        }
    }

    private fun notGranted(permissions: List<String>) = permissions.filter {
        ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
    }

    /** Fehlende Berechtigungen; „ungefährer Standort“ statt „genauer“ wird toleriert. */
    private fun blockingMissing(): List<String> {
        val missing = notGranted(nearbyPermissions())
        return missing.filterNot {
            it == Manifest.permission.ACCESS_FINE_LOCATION && Manifest.permission.ACCESS_COARSE_LOCATION !in missing
        }
    }

    fun isLocationEnabled(): Boolean {
        val manager = getSystemService(LocationManager::class.java) ?: return true
        return LocationManagerCompat.isLocationEnabled(manager)
    }

    fun isBluetoothEnabled(): Boolean = try {
        getSystemService(BluetoothManager::class.java)?.adapter?.isEnabled ?: true
    } catch (e: SecurityException) {
        true
    }

    /** kind: app | location | bluetooth | install */
    fun openSettings(kind: String) {
        val intent = when (kind) {
            "location" -> Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            "bluetooth" -> Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
            "install" -> Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
            else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))
        }
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }

    /** Liefert die Spieldateien aus den Assets unter einer https-Adresse aus (sicherer Kontext). */
    private inner class AssetClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            if (url.host != ASSET_HOST) return null
            val path = url.path.orEmpty().removePrefix("/")
            if (path.contains("..")) return notFound()
            return try {
                val stream = assets.open(path.ifEmpty { "index.html" })
                val mime = mimeType(path)
                val encoding = if (mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json")) "utf-8" else null
                WebResourceResponse(mime, encoding, stream)
            } catch (e: IOException) {
                notFound()
            }
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            request.url.host != ASSET_HOST

        private fun notFound() =
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }

    companion object {
        private val SPACE = Color.rgb(3, 5, 12)
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val START_URL = "https://$ASSET_HOST/index.html"

        fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            "txt" -> "text/plain"
            else -> "application/octet-stream"
        }
    }
}
