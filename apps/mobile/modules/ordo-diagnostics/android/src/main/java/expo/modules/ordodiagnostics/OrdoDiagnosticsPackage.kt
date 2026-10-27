package expo.modules.ordodiagnostics

import android.content.Context
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactNativeHostHandler

/** Public Expo bridgeless lifecycle hook. No replacement of Expo's host or
 * exception handler: every other host handler still receives the original. */
class OrdoDiagnosticsPackage : Package {
  override fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> =
    listOf(object : ReactNativeHostHandler {
      override fun onReactInstanceException(useDeveloperSupport: Boolean, exception: Exception) {
        OrdoDiagnosticsJournal.record(context, exception)
      }
    })
}
