package ch.sterneversenken.app

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Holt die neueste Version vom GitHub-Release "latest" und startet die Installation.
 *
 * Die Release-Seite enthält neben der APK eine kleine version.json mit der Versionsnummer.
 * Die Installation übernimmt der System-Installer; Android prüft dabei, dass die neue APK
 * mit demselben Schlüssel signiert ist wie die installierte.
 */
class Updater(
    private val activity: MainActivity,
    private val emit: (String, JSONObject) -> Unit,
) {
    private val io = Executors.newSingleThreadExecutor()
    @Volatile private var busy = false

    fun versionJson(): JSONObject {
        val info = packageInfo()
        return JSONObject()
            .put("code", PackageInfoCompat.getLongVersionCode(info))
            .put("name", info.versionName ?: "")
    }

    /** Prüft im Hintergrund, ob es eine neuere Version gibt. Antwort: update-info oder update-error. */
    fun check() {
        io.execute {
            try {
                val remote = JSONObject(fetchText(VERSION_URL))
                val latestCode = remote.getLong("versionCode")
                val current = versionJson()
                emit(
                    "update-info",
                    JSONObject()
                        .put("available", latestCode > current.getLong("code"))
                        .put("current", current.getString("name"))
                        .put("latest", remote.optString("versionName", "Build $latestCode")),
                )
            } catch (e: Exception) {
                emit("update-error", JSONObject().put("phase", "check").put("message", friendly(e)))
            }
        }
    }

    /** Lädt die neueste APK herunter und öffnet den Installer. */
    fun start() {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            // Android verlangt pro App die Erlaubnis, andere Apps (hier: Updates) zu installieren.
            emit("update-needs-permission", JSONObject())
            activity.runOnUiThread { activity.openSettings("install") }
            return
        }
        if (busy) return
        busy = true
        io.execute {
            try {
                val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
                val file = File(dir, "sterneversenken.apk")
                download(APK_URL, file)
                val archive = archiveInfo(file)
                if (archive?.packageName != activity.packageName) {
                    throw IOException("Die heruntergeladene Datei ist keine gültige App-Version.")
                }
                emit("update-installing", JSONObject())
                activity.runOnUiThread { install(file) }
            } catch (e: Exception) {
                emit("update-error", JSONObject().put("phase", "download").put("message", friendly(e)))
            } finally {
                busy = false
            }
        }
    }

    private fun install(file: File) {
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            activity.startActivity(intent)
        } catch (e: Exception) {
            emit("update-error", JSONObject().put("phase", "install").put("message", friendly(e)))
        }
    }

    // ---- Netzwerk -------------------------------------------------------------------------

    private fun open(url: String): HttpURLConnection {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true // GitHub leitet auf einen Download-Server um (https → https)
        conn.useCaches = false
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        conn.setRequestProperty("User-Agent", "Sterne-versenken-Android")
        val code = conn.responseCode
        if (code != HttpURLConnection.HTTP_OK) {
            conn.disconnect()
            throw IOException(if (code == 404) "Auf GitHub ist noch keine Version veröffentlicht." else "GitHub antwortet mit Fehler $code.")
        }
        return conn
    }

    private fun fetchText(url: String): String {
        val conn = open(url)
        try {
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun download(url: String, target: File) {
        val conn = open(url)
        try {
            val total = conn.contentLengthLong
            val tmp = File(target.parentFile, target.name + ".part")
            var done = 0L
            var lastPercent = -1
            conn.inputStream.use { input ->
                tmp.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        done += n
                        if (total > 0) {
                            val percent = (done * 100 / total).toInt()
                            if (percent >= lastPercent + 4) {
                                lastPercent = percent
                                emit("update-progress", JSONObject().put("percent", percent))
                            }
                        }
                    }
                }
            }
            if (total > 0 && done != total) throw IOException("Download unvollständig.")
            if (!tmp.renameTo(target)) {
                tmp.copyTo(target, overwrite = true)
                tmp.delete()
            }
        } finally {
            conn.disconnect()
        }
    }

    // ---- Hilfen ---------------------------------------------------------------------------

    private fun packageInfo(): PackageInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.packageManager.getPackageInfo(activity.packageName, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            activity.packageManager.getPackageInfo(activity.packageName, 0)
        }

    private fun archiveInfo(file: File): PackageInfo? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.packageManager.getPackageArchiveInfo(file.path, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            activity.packageManager.getPackageArchiveInfo(file.path, 0)
        }

    private fun friendly(e: Exception): String = when (e) {
        is java.net.UnknownHostException -> "Keine Internetverbindung."
        is java.net.SocketTimeoutException -> "GitHub antwortet nicht (Zeitüberschreitung)."
        else -> e.message ?: e.javaClass.simpleName
    }

    companion object {
        private const val RELEASE = "https://github.com/vb-roughus/sterneversenken/releases/download/latest"
        private const val VERSION_URL = "$RELEASE/version.json"
        private const val APK_URL = "$RELEASE/sterneversenken.apk"
    }
}
