/** Native Save As: ACTION_CREATE_DOCUMENT, then write via ContentResolver. */

function ordoExportFileModuleKotlin(packageName) {
  return `package ${packageName}

import android.app.Activity
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.IOException
import java.io.OutputStream

/**
 * Save As for library exports. Expo's FileSystem refuses Downloads
 * content:// URIs (it only treats com.android.externalstorage as writable).
 * Writing in onActivityResult with the real Uri goes through ContentResolver.
 */
class OrdoExportFileModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  private data class Pending(
    val promise: Promise,
    val source: File,
    val filename: String,
    val mimeType: String,
  )

  @Volatile private var pending: Pending? = null

  private val listener = object : BaseActivityEventListener() {
    override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?,
    ) {
      if (requestCode != REQUEST_CODE) return
      val job = pending
      pending = null
      if (job == null) return
      if (resultCode != Activity.RESULT_OK) {
        job.promise.reject(ERR_CANCELED, "Export canceled")
        return
      }
      val uri = data?.data
      if (uri == null) {
        job.promise.reject(ERR_EXPORT, "Couldn't open a save location.")
        return
      }
      takeWritePermission(activity.contentResolver, uri, data)
      Thread({
        try {
          writeExport(activity.contentResolver, uri, job)
          job.promise.resolve(null)
        } catch (e: Exception) {
          job.promise.reject(ERR_EXPORT, "Couldn't save the export file.", e)
        }
      }, "ordo-export").start()
    }
  }

  init {
    reactContext.addActivityEventListener(listener)
  }

  @ReactMethod
  fun saveDocument(filename: String, mimeType: String, sourcePath: String, promise: Promise) {
    if (pending != null) {
      promise.reject(ERR_EXPORT, "An export is already in progress.")
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(ERR_EXPORT, "Couldn't open a save location.")
      return
    }
    val source = localFile(sourcePath)
    if (!source.isFile) {
      promise.reject(ERR_EXPORT, "Couldn't write the export file.")
      return
    }
    val type = mimeType.ifBlank { "application/octet-stream" }
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      setType(type)
      putExtra(Intent.EXTRA_TITLE, filename)
    }
    pending = Pending(promise, source, filename, type)
    try {
      activity.startActivityForResult(intent, REQUEST_CODE)
    } catch (e: Exception) {
      pending = null
      promise.reject(ERR_EXPORT, "Couldn't open a save location.", e)
    }
  }

  private fun writeExport(resolver: ContentResolver, uri: Uri, job: Pending) {
    try {
      copyToUri(resolver, uri, job.source)
    } catch (e: Exception) {
      if (uri.authority?.contains("downloads") == true &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
      ) {
        copyToMediaStoreDownloads(resolver, job)
      } else {
        throw e
      }
    }
  }

  private fun copyToMediaStoreDownloads(resolver: ContentResolver, job: Pending) {
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, job.filename)
      put(MediaStore.Downloads.MIME_TYPE, job.mimeType)
      put(MediaStore.Downloads.IS_PENDING, 1)
    }
    val dest = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw IOException("Couldn't save the export file.")
    try {
      copyToUri(resolver, dest, job.source)
      values.clear()
      values.put(MediaStore.Downloads.IS_PENDING, 0)
      resolver.update(dest, values, null, null)
    } catch (e: Exception) {
      resolver.delete(dest, null, null)
      throw e
    }
  }

  companion object {
    const val NAME = "OrdoExportFile"
    const val ERR_EXPORT = "ERR_EXPORT"
    const val ERR_CANCELED = "ERR_EXPORT_CANCELED"
    const val REQUEST_CODE = 20301

    private fun localFile(path: String): File {
      val uri = Uri.parse(path)
      if (uri.scheme == "file") {
        return File(uri.path ?: path)
      }
      return File(path)
    }

    private fun takeWritePermission(resolver: ContentResolver, uri: Uri, data: Intent) {
      val flags = data.flags and
        (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      if (flags == 0) return
      try {
        resolver.takePersistableUriPermission(uri, flags)
      } catch (_: SecurityException) {
        /* temporary grant from startActivityForResult is enough to write once */
      }
    }

    private fun copyToUri(resolver: ContentResolver, uri: Uri, file: File) {
      file.inputStream().use { input ->
        openOutput(resolver, uri).use { output ->
          input.copyTo(output, 64 * 1024)
          output.flush()
        }
      }
    }

    private fun openOutput(resolver: ContentResolver, uri: Uri): OutputStream {
      val modes = arrayOf("wt", "w", "rwt")
      var last: Exception? = null
      for (mode in modes) {
        try {
          val stream = resolver.openOutputStream(uri, mode)
          if (stream != null) return stream
        } catch (e: Exception) {
          last = e
        }
      }
      resolver.openOutputStream(uri)?.let { return it }
      throw last ?: IOException("Couldn't save the export file.")
    }
  }
}
`;
}

module.exports = { ordoExportFileModuleKotlin };
