package com.ylkhn.gitnotes

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

@InvokeArg
class FetchTextArgs {
  lateinit var url: String
}

@InvokeArg
class DownloadArgs {
  lateinit var url: String
  lateinit var onProgress: Channel
}

@InvokeArg
class InstallArgs {
  var openSettings: Boolean = false
}

/**
 * In-app updates of the APK (`src-tauri/src/apk_update.rs` decides what to download): fetches
 * the release manifest, downloads the new APK into the cache with progress events, and hands
 * it to the system package installer. The installer checks that the APK is signed with the
 * same key as the installed app.
 */
@TauriPlugin
class ApkUpdatePlugin(private val activity: Activity) : Plugin(activity) {
  private val worker = Executors.newSingleThreadExecutor()

  private val updatesDir get() = File(activity.cacheDir, "updates")
  private val apkFile get() = File(updatesDir, "git-notes-update.apk")

  override fun load(webView: WebView) {
    // An APK left from an earlier update (installed or abandoned) is only dead weight.
    worker.execute { updatesDir.deleteRecursively() }
  }

  @Command
  fun fetchText(invoke: Invoke) {
    val args = invoke.parseArgs(FetchTextArgs::class.java)
    worker.execute {
      try {
        val connection = open(args.url)
        val bytes = try {
          readLimited(connection, MAX_TEXT_BYTES)
        } finally {
          connection.disconnect()
        }
        invoke.resolve(JSObject().put("text", String(bytes, Charsets.UTF_8)))
      } catch (e: Exception) {
        invoke.reject(describe(e))
      }
    }
  }

  @Command
  fun download(invoke: Invoke) {
    val args = invoke.parseArgs(DownloadArgs::class.java)
    worker.execute {
      val partial = File(updatesDir, "git-notes-update.apk.part")
      try {
        updatesDir.mkdirs()
        apkFile.delete()
        val connection = open(args.url)
        try {
          val total = connection.contentLengthLong.takeIf { it > 0 }
          args.onProgress.send(event("started", JSObject().put("contentLength", total)))
          var downloaded = 0L
          var reported = 0L
          connection.inputStream.use { input ->
            partial.outputStream().use { output ->
              val buffer = ByteArray(64 * 1024)
              while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                output.write(buffer, 0, read)
                downloaded += read
                if (downloaded - reported >= PROGRESS_STEP_BYTES) {
                  reported = downloaded
                  args.onProgress.send(event("progress", JSObject().put("downloaded", downloaded)))
                }
              }
            }
          }
          if (total != null && downloaded != total) {
            throw IOException("the download stopped at $downloaded of $total bytes")
          }
          args.onProgress.send(event("progress", JSObject().put("downloaded", downloaded)))
        } finally {
          connection.disconnect()
        }
        checkPackage(partial)
        if (!partial.renameTo(apkFile)) throw IOException("could not store the downloaded APK")
        invoke.resolve()
      } catch (e: Exception) {
        partial.delete()
        invoke.reject(describe(e))
      }
    }
  }

  @Command
  fun install(invoke: Invoke) {
    val args = invoke.parseArgs(InstallArgs::class.java)
    activity.runOnUiThread {
      try {
        if (!apkFile.isFile) {
          invoke.reject("the update is not downloaded")
          return@runOnUiThread
        }
        val outcome = if (canInstallPackages()) {
          val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", apkFile)
          val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME_TYPE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          activity.startActivity(intent)
          "started"
        } else {
          if (args.openSettings) {
            activity.startActivity(
              Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")),
            )
          }
          "needsPermission"
        }
        invoke.resolve(JSObject().put("outcome", outcome))
      } catch (e: Exception) {
        invoke.reject(describe(e))
      }
    }
  }

  /** Android 8+ asks the user once to let an app install other apps (here: its own updates). */
  private fun canInstallPackages(): Boolean = activity.packageManager.canRequestPackageInstalls()

  /** Rejects a download that is not a newer build of this app before it reaches the installer. */
  private fun checkPackage(file: File) {
    val pm = activity.packageManager
    val archive = pm.getPackageArchiveInfo(file.path, 0)
      ?: throw IOException("the download is not an Android package")
    if (archive.packageName != activity.packageName) {
      throw IOException("the download is a different app (${archive.packageName})")
    }
    val installed = pm.getPackageInfo(activity.packageName, 0)
    if (versionCode(archive) <= versionCode(installed)) {
      throw IOException("the download is not newer than the installed version ${installed.versionName}")
    }
  }

  @Suppress("DEPRECATION")
  private fun versionCode(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

  /** Opens a GET request; redirects are followed, as GitHub release assets redirect to a CDN. */
  private fun open(url: String): HttpURLConnection {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = TIMEOUT_MS
    connection.readTimeout = TIMEOUT_MS
    connection.instanceFollowRedirects = true
    connection.setRequestProperty("User-Agent", "git-notes")
    val status = connection.responseCode
    if (status !in 200..299) {
      connection.disconnect()
      throw IOException(if (status == 404) "not found on the server (HTTP 404)" else "HTTP $status")
    }
    return connection
  }

  private fun readLimited(connection: HttpURLConnection, limit: Int): ByteArray =
    connection.inputStream.use { input ->
      val out = ByteArrayOutputStream()
      val buffer = ByteArray(16 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        out.write(buffer, 0, read)
        if (out.size() > limit) throw IOException("the response is too large")
      }
      out.toByteArray()
    }

  private fun event(name: String, data: JSObject) = JSObject().put("event", name).put("data", data)

  private fun describe(e: Exception): String = e.message?.takeIf { it.isNotBlank() } ?: e.javaClass.simpleName

  private companion object {
    const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    const val MAX_TEXT_BYTES = 1024 * 1024
    const val PROGRESS_STEP_BYTES = 256 * 1024L
    const val TIMEOUT_MS = 30_000
  }
}
