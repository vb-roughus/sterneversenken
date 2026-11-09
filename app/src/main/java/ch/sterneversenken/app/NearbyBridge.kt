package ch.sterneversenken.app

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import org.json.JSONArray
import org.json.JSONObject

/**
 * Verbindet zwei Handys direkt über Google Nearby Connections (Bluetooth, BLE, WLAN direkt).
 * Es gibt keinen Server: Ein Gerät macht sich sichtbar ("hosten"), das andere sucht und verbindet sich.
 *
 * Aufrufe aus JavaScript kommen über window.AndroidBridge, Ereignisse gehen über
 * window.__nativeEvent(type, data) zurück an die Seite (siehe web/js/native.js).
 * Ausserdem: Einstellungen öffnen, Vibration und Updates (siehe [Updater]).
 */
class NearbyBridge(
    private val activity: MainActivity,
    private val webView: WebView,
) {
    private val main = Handler(Looper.getMainLooper())
    private val client: ConnectionsClient by lazy { Nearby.getConnectionsClient(activity) }

    @Volatile private var connectedId: String? = null
    private var myName = "Pilot"
    @Volatile private var active = true
    private val updater = Updater(activity) { type, data -> emit(type, data) }

    // ---- Aufrufe aus JavaScript -----------------------------------------------------------

    @JavascriptInterface
    fun nearbyAvailable(): Boolean =
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity) == ConnectionResult.SUCCESS

    @JavascriptInterface
    fun startHosting(name: String) {
        main.post {
            myName = cleanName(name)
            reset()
            withPermissions {
                val options = AdvertisingOptions.Builder().setStrategy(STRATEGY).build()
                client.startAdvertising(myName, SERVICE_ID, lifecycle, options)
                    .addOnSuccessListener { emit("advertising") }
                    .addOnFailureListener { emitProblem("error", describe(it)) }
            }
        }
    }

    @JavascriptInterface
    fun startDiscovery(name: String) {
        main.post {
            myName = cleanName(name)
            reset()
            withPermissions {
                val options = DiscoveryOptions.Builder().setStrategy(STRATEGY).build()
                client.startDiscovery(SERVICE_ID, discovery, options)
                    .addOnSuccessListener { emit("discovering") }
                    .addOnFailureListener { emitProblem("error", describe(it)) }
            }
        }
    }

    @JavascriptInterface
    fun connect(endpointId: String) {
        main.post {
            client.requestConnection(myName, endpointId, lifecycle)
                .addOnFailureListener { emitProblem("connect-failed", describe(it)) }
        }
    }

    @JavascriptInterface
    fun send(text: String): Boolean {
        val id = connectedId ?: return false
        val bytes = text.toByteArray(Charsets.UTF_8)
        main.post {
            client.sendPayload(id, Payload.fromBytes(bytes))
                .addOnFailureListener {
                    val problem = describe(it)
                    emitProblem("error", problem.copy(message = "Senden fehlgeschlagen: ${problem.message}"))
                }
        }
        return true
    }

    @JavascriptInterface
    fun stop() {
        main.post { reset() }
    }

    /** pattern: JSON-Array [an, aus, an, ...] in Millisekunden */
    @JavascriptInterface
    fun vibrate(pattern: String) {
        val values = try {
            val arr = JSONArray(pattern)
            LongArray(arr.length()) { arr.optLong(it).coerceIn(0, 2000) }
        } catch (e: Exception) {
            return
        }
        if (values.isEmpty()) return
        val vibrator = vibrator() ?: return
        if (!vibrator.hasVibrator()) return
        val effect = if (values.size == 1) {
            VibrationEffect.createOneShot(values[0].coerceAtLeast(1), VibrationEffect.DEFAULT_AMPLITUDE)
        } else {
            VibrationEffect.createWaveform(longArrayOf(0) + values, -1)
        }
        vibrator.vibrate(effect)
    }

    /** kind: app | location | bluetooth | install */
    @JavascriptInterface
    fun openSettings(kind: String) {
        main.post { activity.openSettings(kind) }
    }

    @JavascriptInterface
    fun keepAwake(on: Boolean) {
        main.post { activity.keepAwake(on) }
    }

    @JavascriptInterface
    fun appVersion(): String = updater.versionJson().toString()

    @JavascriptInterface
    fun checkUpdate() = updater.check()

    @JavascriptInterface
    fun canInstallUpdates(): Boolean = activity.packageManager.canRequestPackageInstalls()

    @JavascriptInterface
    fun startUpdate() {
        main.post { updater.start() }
    }

    // ---- Lebenszyklus ---------------------------------------------------------------------

    /** Die App ist wieder im Vordergrund (z.B. zurück aus den Einstellungen). */
    fun onResume() = emit("resumed")

    fun shutdown() {
        active = false
        reset()
    }

    private fun reset() {
        try {
            client.stopAdvertising()
            client.stopDiscovery()
            client.stopAllEndpoints()
        } catch (e: Exception) {
            // Play-Dienste fehlen o.ä. – nichts zu stoppen.
        }
        connectedId = null
    }

    // ---- Nearby-Callbacks -----------------------------------------------------------------

    private val discovery = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            if (info.serviceId != SERVICE_ID) return
            emit("found", JSONObject().put("id", endpointId).put("name", info.endpointName))
        }

        override fun onEndpointLost(endpointId: String) {
            emit("lost", JSONObject().put("id", endpointId))
        }
    }

    private val lifecycle = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            if (connectedId != null) {
                client.rejectConnection(endpointId)
                return
            }
            emit(
                "connecting",
                JSONObject()
                    .put("id", endpointId)
                    .put("name", info.endpointName)
                    .put("code", info.authenticationDigits),
            )
            client.acceptConnection(endpointId, payloads)
                .addOnFailureListener { emitProblem("connect-failed", describe(it)) }
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            if (result.status.isSuccess) {
                connectedId = endpointId
                client.stopAdvertising()
                client.stopDiscovery()
                emit("connected", JSONObject().put("id", endpointId))
            } else {
                val code = result.status.statusCode
                val reason = if (code == ConnectionsStatusCodes.STATUS_CONNECTION_REJECTED) {
                    "Verbindung abgelehnt."
                } else {
                    "Verbindung fehlgeschlagen (${ConnectionsStatusCodes.getStatusCodeString(code)})."
                }
                emit("connect-failed", JSONObject().put("message", reason))
            }
        }

        override fun onDisconnected(endpointId: String) {
            if (endpointId != connectedId) return
            connectedId = null
            emit("disconnected")
        }
    }

    private val payloads = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            if (payload.type != Payload.Type.BYTES) return
            val bytes = payload.asBytes() ?: return
            emit("message", JSONObject().put("text", String(bytes, Charsets.UTF_8)))
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
    }

    // ---- Hilfen ---------------------------------------------------------------------------

    private fun emit(type: String, data: JSONObject = JSONObject()) {
        val js = "window.__nativeEvent && window.__nativeEvent(${JSONObject.quote(type)}, $data)"
        main.post { if (active) webView.evaluateJavascript(js, null) }
    }

    private data class Problem(val message: String, val kind: String = "", val code: String = "")

    private fun emitProblem(type: String, p: Problem) =
        emit(type, JSONObject().put("message", p.message).put("kind", p.kind).put("code", p.code))

    /** Berechtigungen sicherstellen, auf ausgeschalteten Standort/Bluetooth hinweisen, dann `action`. */
    private fun withPermissions(action: () -> Unit) {
        activity.ensureNearbyPermissions { missing ->
            if (missing.isNotEmpty()) {
                val labels = missing.map { permissionLabel(it) }.distinct()
                emitProblem("error", permissionProblem(labels, missing.joinToString { it.substringAfterLast('.') }))
                return@ensureNearbyPermissions
            }
            when {
                !activity.isLocationEnabled() -> emitProblem(
                    "hint",
                    Problem("Der Standort ist ausgeschaltet. Damit sich die Handys finden, bitte Standort einschalten.", "location"),
                )
                !activity.isBluetoothEnabled() -> emitProblem(
                    "hint",
                    Problem("Bluetooth ist ausgeschaltet. Damit sich die Handys finden, bitte Bluetooth einschalten.", "bluetooth"),
                )
            }
            action()
        }
    }

    private fun permissionLabel(permission: String): String = when {
        permission.contains("LOCATION") -> "Standort"
        permission.contains("BLUETOOTH") || permission.contains("NEARBY") || permission.contains("WIFI") -> "Geräte in der Nähe"
        else -> permission.substringAfterLast('.')
    }

    private fun permissionProblem(labels: List<String>, code: String) = Problem(
        "Es fehlt die Berechtigung „${labels.joinToString("“ und „")}“. Ohne sie finden sich die Handys nicht. " +
            "Bitte in den App-Einstellungen unter Berechtigungen erlauben.",
        "permission",
        code,
    )

    private fun describe(e: Exception): Problem {
        val code = (e as? ApiException)?.statusCode ?: return Problem(e.message ?: "Unbekannter Fehler")
        val name = ConnectionsStatusCodes.getStatusCodeString(code)
        return when {
            name.startsWith("MISSING_PERMISSION") -> permissionProblem(listOf(permissionLabel(name)), name)
            code == ConnectionsStatusCodes.STATUS_RADIO_ERROR || name.contains("BLUETOOTH") ->
                Problem("Funkfehler. Bitte Bluetooth und WLAN einschalten und nochmals versuchen.", "bluetooth", name)
            code == ConnectionsStatusCodes.STATUS_ENDPOINT_UNKNOWN ->
                Problem("Das andere Handy ist nicht mehr erreichbar.", "", name)
            code == ConnectionsStatusCodes.STATUS_ALREADY_CONNECTED_TO_ENDPOINT -> Problem("Schon verbunden.", "", name)
            else -> Problem("Nearby-Fehler $name. Bluetooth, WLAN und Standort einschalten und nochmals versuchen.", "", name)
        }
    }

    private fun vibrator(): Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            activity.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Vibrator::class.java)
        }

    private fun cleanName(name: String): String =
        name.trim().take(20).ifEmpty { "Pilot" }

    companion object {
        // v2: neue Strategie – ältere App-Versionen (v1) finden diese nicht und umgekehrt.
        private const val SERVICE_ID = "ch.sterneversenken.app.v2"
        // P2P_CLUSTER bleibt bei Bluetooth/BLE. P2P_POINT_TO_POINT würde für mehr Bandbreite einen
        // WLAN-Hotspot bzw. WLAN-Direct aufbauen – unnötig für ein paar Bytes pro Zug und ein Akkufresser.
        // Beide Geräte müssen dieselbe Strategie verwenden (also beide aktualisieren).
        private val STRATEGY = Strategy.P2P_CLUSTER
    }
}
