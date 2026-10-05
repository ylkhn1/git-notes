package com.ylkhn.gitnotes

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import androidx.core.content.IntentCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Share target: receives `ACTION_SEND` intents with any `text` MIME type (`text/plain`,
 * `text/markdown`, …; see the intent filter in AndroidManifest.xml) and keeps the last one
 * until the Rust side asks for it with
 * `takeShared` (`src-tauri/src/share.rs`). The frontend polls when it starts and whenever the
 * app comes back to the foreground, which is when a new share arrives.
 */
@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
  private var pending: JSObject? = null

  override fun load(webView: WebView) {
    // The intent the app was launched with (cold start from the share sheet).
    consume(activity.intent)
  }

  override fun onNewIntent(intent: Intent) {
    // The app was already running (singleTask) and was brought to the front by a share.
    consume(intent)
  }

  @Command
  fun takeShared(invoke: Invoke) {
    val shared = pending
    pending = null
    invoke.resolve(JSObject().put("shared", shared))
  }

  private fun consume(intent: Intent?) {
    if (intent == null || intent.action != Intent.ACTION_SEND) return
    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: readStream(intent) ?: return
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.takeIf { it.isNotBlank() }
    pending = JSObject().put("title", subject).put("text", text)
    // Never import the same share twice if the activity or the WebView is recreated.
    intent.action = Intent.ACTION_MAIN
    intent.removeExtra(Intent.EXTRA_TEXT)
    intent.removeExtra(Intent.EXTRA_SUBJECT)
    intent.removeExtra(Intent.EXTRA_STREAM)
  }

  /** A shared text file (`EXTRA_STREAM`), read as UTF-8 up to [MAX_STREAM_BYTES]. */
  private fun readStream(intent: Intent): String? {
    val uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) ?: return null
    return try {
      activity.contentResolver.openInputStream(uri)?.use { stream ->
        val bytes = stream.readBytes()
        if (bytes.size > MAX_STREAM_BYTES) null else String(bytes, Charsets.UTF_8)
      }
    } catch (_: Exception) {
      null
    }
  }

  private companion object {
    const val MAX_STREAM_BYTES = 2 * 1024 * 1024
  }
}
