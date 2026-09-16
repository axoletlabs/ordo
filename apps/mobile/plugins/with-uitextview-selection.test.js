const assert = require("node:assert/strict");
const { test } = require("node:test");
const { patchUiTextViewSource } = require("./with-uitextview-selection.js");

const SAMPLE = `
@interface RNUITextView () <RCTRNUITextViewViewProtocol, UIGestureRecognizerDelegate, UITextViewDelegate>
@end

@implementation RNUITextView{
  UITextView * _textView;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _textView = [[UITextView alloc] init];
    _textView.editable = false;
  }
  return self;
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (self.window) {
    [self.window addGestureRecognizer:_outsideTapRecognizer];
  } else {
    [_outsideTapRecognizer.view removeGestureRecognizer:_outsideTapRecognizer];
  }
}
`;

test("hides the insertion caret, system edit menu, and window tap clearer", () => {
  const patched = patchUiTextViewSource(SAMPLE);
  assert.match(patched, /RNUITextViewNoCaret/);
  assert.match(patched, /caretRectForPosition/);
  assert.match(patched, /canPerformAction/);
  assert.match(patched, /\[\[RNUITextViewNoCaret alloc\] init\]/);
  assert.doesNotMatch(patched, /\[\[UITextView alloc\] init\]/);
  assert.doesNotMatch(patched, /addGestureRecognizer:_outsideTapRecognizer/);
  assert.equal(patchUiTextViewSource(patched), patched);
});

test("adds canPerformAction to an existing caret subclass", () => {
  const already = `
@interface RNUITextViewNoCaret : UITextView
@end

@implementation RNUITextViewNoCaret
- (CGRect)caretRectForPosition:(UITextPosition *)position
{
  (void)position;
  return CGRectZero;
}
@end

@implementation RNUITextView{
  UITextView * _textView;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _textView = [[RNUITextViewNoCaret alloc] init];
  }
  return self;
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
}
`;
  const patched = patchUiTextViewSource(already);
  assert.match(patched, /canPerformAction/);
  assert.equal(patchUiTextViewSource(patched), patched);
});
