package com.ylkhn.gitnotes

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Hosts the Tauri WebView. The template draws edge-to-edge; we keep the WebView out of the
 * system bars and above the keyboard by padding the content root with the window insets,
 * so the web layout never has to guess inset sizes. Status bar icon colour follows the
 * system light/dark mode (the in-app theme defaults to "system" as well).
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val root = findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime(),
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    applyChrome(resources.configuration)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applyChrome(newConfig)
  }

  /** Background behind the insets and status/navigation bar icon colours. */
  private fun applyChrome(config: Configuration) {
    val night = (config.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    // Matches --gn-bg in src/app/styles.css (light: oklch(0.985 0.003 85), dark: oklch(0.2 0.007 260)).
    val background = if (night) Color.rgb(0x1f, 0x20, 0x24) else Color.rgb(0xfb, 0xfa, 0xf8)
    findViewById<ViewGroup>(android.R.id.content).setBackgroundColor(background)
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.isAppearanceLightStatusBars = !night
    controller.isAppearanceLightNavigationBars = !night
  }
}
