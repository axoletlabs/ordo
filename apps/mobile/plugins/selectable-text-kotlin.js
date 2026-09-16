/** Android TextView hook so article phrases can be selected without an EditText caret. */

function ordoSelectableTextKotlin(packageName) {
  return `package ${packageName}

import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
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
      val text = resolveTextView(viewTag) ?: return@runOnUiThread
      reactTags[text] = viewTag
      if (!hooked.add(text)) return@runOnUiThread
      text.isCursorVisible = false
      text.setTextIsSelectable(true)
      text.customInsertionActionModeCallback = hiddenActionMode
      text.customSelectionActionModeCallback = object : ActionMode.Callback {
        override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
          menu.clear()
          emit(text)
          return true
        }

        override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
          menu.clear()
          emit(text)
          return false
        }

        override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean = false

        override fun onDestroyActionMode(mode: ActionMode) {}
      }
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
  }

  @ReactMethod
  fun detach(tag: Double) {
    val viewTag = tag.toInt()
    UiThreadUtil.runOnUiThread {
      val text = resolveTextView(viewTag) ?: return@runOnUiThread
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
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT, payload)
  }

  private fun resolveTextView(tag: Int): TextView? {
    val uiManager = UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, tag) ?: return null
    val view = try {
      uiManager.resolveView(tag)
    } catch (_: Exception) {
      null
    }
    return view as? TextView
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
