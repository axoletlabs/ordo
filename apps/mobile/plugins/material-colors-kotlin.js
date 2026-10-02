/** Read public Android 12 tonal resources, including the user's selected style. */
function ordoMaterialColorsModuleKotlin(packageName) {
  return `package ${packageName}

import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.Locale

class OrdoMaterialColorsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "OrdoMaterialColors"

  @ReactMethod
  fun get(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      promise.resolve(null)
      return
    }
    try {
      val result = Arguments.createMap()
      val resources = reactApplicationContext.resources
      val shades = listOf(0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000)
      for (family in listOf("accent1", "accent2", "accent3", "neutral1", "neutral2")) {
        val tones = Arguments.createMap()
        for (shade in shades) {
          @Suppress("DiscouragedApi")
          val id = resources.getIdentifier("system_" + family + "_" + shade, "color", "android")
          if (id == 0) {
            promise.resolve(null)
            return
          }
          val color = resources.getColor(id, reactApplicationContext.theme)
          val tone = (100 - shade / 10).toString()
          tones.putString(tone, String.format(Locale.ROOT, "#%06X", color and 0xFFFFFF))
        }
        result.putMap(family, tones)
      }
      result.putBoolean("legacyNeutral", Build.VERSION.SDK_INT < 34)
      if (Build.VERSION.SDK_INT >= 34) {
        val schemes = Arguments.createMap()
        val roles = listOf("primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
          "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
          "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
          "surface", "onSurface", "onSurfaceVariant", "surfaceDim", "surfaceBright",
          "surfaceContainerLowest", "surfaceContainerLow", "surfaceContainer", "surfaceContainerHigh",
          "surfaceContainerHighest", "outline", "outlineVariant")
        for (mode in listOf("light", "dark")) {
          val scheme = Arguments.createMap()
          val opposite = if (mode == "light") "dark" else "light"
          val names = roles.map { role ->
            role to "system_" + role.replace(Regex("([a-z])([A-Z])"), "$1_$2").lowercase(Locale.ROOT) + "_" + mode
          } + listOf("inversePrimary" to "system_primary_" + opposite,
            "inverseSurface" to "system_surface_" + opposite,
            "inverseOnSurface" to "system_on_surface_" + opposite)
          for ((role, name) in names) {
            @Suppress("DiscouragedApi")
            val id = resources.getIdentifier(name, "color", "android")
            if (id != 0) {
              val color = resources.getColor(id, reactApplicationContext.theme)
              scheme.putString(role, String.format(Locale.ROOT, "#%06X", color and 0xFFFFFF))
            }
          }
          schemes.putMap(mode, scheme)
        }
        result.putMap("schemes", schemes)
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("ERR_MATERIAL_COLORS", error)
    }
  }
}
`;
}
module.exports = { ordoMaterialColorsModuleKotlin };
