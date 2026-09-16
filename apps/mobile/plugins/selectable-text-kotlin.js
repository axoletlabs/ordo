/** Android TextView hook so article phrases can be selected without an EditText caret. */

function ordoSelectableTextKotlin(packageName) {
  return `package ${packageName}

import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.TextView
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManager
import java.util.Collections
import java.util.WeakHashMap
import kotlin.math.max
import kotlin.math.min

class OrdoSelectableTextPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(OrdoSelectableTextModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}

class OrdoSelectableTextModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  private val hooked = Collections.newSetFromMap(WeakHashMap<TextView, Boolean>())
  private val drawListeners = WeakHashMap<TextView, ViewTreeObserver.OnPreDrawListener>()
  private val lastRange = WeakHashMap<TextView, Pair<Int, Int>>()
  private val reactTags = WeakHashMap<TextView, Int>()

  override fun getName(): String = NAME

  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Double) {}

  @ReactMethod
  fun attach(tag: Double) {
    val viewTag = tag.toInt()
    UiThreadUtil.runOnUiThread {
      val root = resolveView(viewTag) ?: return@runOnUiThread
      hookView(root, viewTag)
    }
  }

  @ReactMethod
  fun detach(tag: Double) {
    val viewTag = tag.toInt()
    UiThreadUtil.runOnUiThread {
      val root = resolveView(viewTag) ?: return@runOnUiThread
      unhookView(root)
    }
  }

  private fun hookView(view: View, tag: Int) {
    if (view is TextView) hookText(view, tag)
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) hookView(view.getChildAt(i), tag)
    }
  }

  private fun unhookView(view: View) {
    if (view is TextView) unhookText(view)
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) unhookView(view.getChildAt(i))
    }
  }

  private fun hookText(text: TextView, tag: Int) {
    reactTags[text] = tag
    if (!hooked.add(text)) return
    text.isCursorVisible = false
    text.setTextIsSelectable(true)
    text.customInsertionActionModeCallback = hiddenActionMode
    text.customSelectionActionModeCallback = suppressedSelectionMode(text)
    text.setOnTouchListener { view, event ->
      val phrase = view as TextView
      when (event.actionMasked) {
        MotionEvent.ACTION_MOVE -> {
          if (phrase.selectionStart != phrase.selectionEnd) {
            phrase.parent?.requestDisallowInterceptTouchEvent(true)
          }
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          phrase.parent?.requestDisallowInterceptTouchEvent(false)
        }
      }
      false
    }
    val drawListener = ViewTreeObserver.OnPreDrawListener {
      try {
        emit(text)
      } catch (_: Exception) {
      }
      true
    }
    drawListeners[text] = drawListener
    text.viewTreeObserver.addOnPreDrawListener(drawListener)
  }

  private fun unhookText(text: TextView) {
    hooked.remove(text)
    lastRange.remove(text)
    reactTags.remove(text)
    drawListeners.remove(text)?.let { listener ->
      text.viewTreeObserver.removeOnPreDrawListener(listener)
    }
    text.setOnTouchListener(null)
    text.customInsertionActionModeCallback = null
    text.customSelectionActionModeCallback = null
  }

  private fun suppressedSelectionMode(text: TextView): ActionMode.Callback {
    return object : ActionMode.Callback2() {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
        menu.clear()
        emit(text)
        return false
      }

      override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
        menu.clear()
        return false
      }

      override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean = false

      override fun onDestroyActionMode(mode: ActionMode) {}

      override fun onGetContentRect(mode: ActionMode, view: View, outRect: android.graphics.Rect) {
        outRect.setEmpty()
      }
    }
  }

  private fun emit(text: TextView) {
    val start = min(text.selectionStart, text.selectionEnd)
    val end = max(text.selectionStart, text.selectionEnd)
    if (start < 0 || end < 0) return
    val previous = lastRange[text]
    if (previous?.first == start && previous.second == end) return
    lastRange[text] = start to end
    val payload = Arguments.createMap()
    payload.putInt("target", reactTags[text] ?: text.id)
    payload.putInt("start", start)
    payload.putInt("end", end)
    putSelectionRect(payload, text, start, end)
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT, payload)
  }

  private fun dip(px: Number): Double = PixelUtil.toDIPFromPixel(px.toFloat()).toDouble()

  private fun putSelectionRect(
    payload: com.facebook.react.bridge.WritableMap,
    text: TextView,
    start: Int,
    end: Int,
  ) {
    val loc = IntArray(2)
    text.getLocationInWindow(loc)
    val layout = text.layout
    if (layout == null || start < 0 || end <= start || end > text.length()) {
      payload.putDouble("x", dip(loc[0]))
      payload.putDouble("y", dip(loc[1]))
      payload.putDouble("width", dip(max(1, text.width)))
      payload.putDouble("height", dip(max(1, text.lineHeight)))
      return
    }
    val startLine = layout.getLineForOffset(start)
    val startX = layout.getPrimaryHorizontal(start)
    val endOnLine = min(end, layout.getLineEnd(startLine))
    val endX = if (endOnLine > start) layout.getPrimaryHorizontal(endOnLine) else layout.getLineRight(startLine)
    val top = layout.getLineTop(startLine)
    val bottom = layout.getLineBottom(startLine)
    val left = min(startX, endX)
    payload.putDouble("x", dip(loc[0] + text.totalPaddingLeft + left.toInt()))
    payload.putDouble("y", dip(loc[1] + text.totalPaddingTop + top))
    payload.putDouble("width", dip(max(1, kotlin.math.abs(endX - startX).toInt())))
    payload.putDouble("height", dip(max(1, bottom - top)))
  }

  private fun resolveView(tag: Int): View? {
    val uiManager = UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, tag) ?: return null
    return try {
      uiManager.resolveView(tag)
    } catch (_: Exception) {
      null
    }
  }

  companion object {
    const val NAME = "OrdoSelectableText"
    const val EVENT = "ordoSelectableText"
    private val hiddenActionMode = object : ActionMode.Callback {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean = false
      override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean = false
      override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean = false
      override fun onDestroyActionMode(mode: ActionMode) {}
    }
  }
}
`;
}

module.exports = { ordoSelectableTextKotlin };
