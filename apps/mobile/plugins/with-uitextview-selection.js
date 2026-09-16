const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * Bluesky's UITextView is what the reader uses for iOS phrase selection.
 * Two native defaults fight highlight gestures:
 *
 * 1. A window-level tap clears selectedTextRange on the next runloop. Selection
 *    handles live in a system window, so lifting a finger looks like an
 *    "outside" tap and the range vanishes.
 * 2. Taps spawn an insertion caret (tint). Article phrases are not editable;
 *    hide that caret so the view cannot enter cursor mode.
 * 3. The system edit menu (Copy/Look Up/…) appears on the same long-press
 *    that starts a range. Disable canPerformAction so the selection context
 *    menu is the only action surface.
 */

const SOURCE = path.join("ios", "RNUITextView.mm");

const CARET_CLASS = `interface RNUITextViewNoCaret : UITextView
@end

@implementation RNUITextViewNoCaret
- (CGRect)caretRectForPosition:(UITextPosition *)position
{
  (void)position;
  return CGRectZero;
}
- (BOOL)canPerformAction:(SEL)action withSender:(id)sender
{
  (void)action;
  (void)sender;
  return NO;
}
@end

`;

const DID_MOVE_TO_WINDOW = `- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (self.window) {
    [self.window addGestureRecognizer:_outsideTapRecognizer];
  } else {
    [_outsideTapRecognizer.view removeGestureRecognizer:_outsideTapRecognizer];
  }
}`;

const DID_MOVE_TO_WINDOW_PATCHED = `- (void)didMoveToWindow
{
  [super didMoveToWindow];
}`;

function uiTextViewNativePath(fromDir) {
  const pkg = path.dirname(
    require.resolve("@bsky.app/react-native-uitextview/package.json", {
      paths: [fromDir],
    }),
  );
  return path.join(pkg, SOURCE);
}

function patchUiTextViewSource(src) {
  let next = src;
  if (!next.includes("RNUITextViewNoCaret")) {
    if (!next.includes("@implementation RNUITextView{")) {
      throw new Error("RNUITextView.mm is missing @implementation RNUITextView{");
    }
    next = next.replace(
      "@implementation RNUITextView{",
      `${CARET_CLASS}@implementation RNUITextView{`,
    );
  }
  next = next.replace("[[UITextView alloc] init]", "[[RNUITextViewNoCaret alloc] init]");
  if (!next.includes("canPerformAction")) {
    next = next.replace(
      "return CGRectZero;\n}\n@end",
      "return CGRectZero;\n}\n- (BOOL)canPerformAction:(SEL)action withSender:(id)sender\n{\n  (void)action;\n  (void)sender;\n  return NO;\n}\n@end",
    );
  }
  if (next.includes(DID_MOVE_TO_WINDOW)) {
    next = next.replace(DID_MOVE_TO_WINDOW, DID_MOVE_TO_WINDOW_PATCHED);
  } else if (!next.includes(DID_MOVE_TO_WINDOW_PATCHED)) {
    throw new Error("RNUITextView.mm is missing didMoveToWindow");
  }
  return next;
}

function withUiTextViewSelection(config) {
  return withDangerousMod(config, [
    "ios",
    async (mod) => {
      const file = uiTextViewNativePath(mod.modRequest.projectRoot);
      const src = await fs.readFile(file, "utf8");
      const patched = patchUiTextViewSource(src);
      if (patched !== src) await fs.writeFile(file, patched);
      return mod;
    },
  ]);
}

module.exports = withUiTextViewSelection;
module.exports.patchUiTextViewSource = patchUiTextViewSource;
module.exports.uiTextViewNativePath = uiTextViewNativePath;
