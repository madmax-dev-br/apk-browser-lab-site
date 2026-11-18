// Attributes an original widget class reads and keeps (its getter and its own drawing through a Canvas have the value) that change nothing on the page, with what is missing.
// Said under "XML attributes accepted, no effect in this VM" for a tag that carries one (AndroidPlatform.leaveAttributeToClass); docs/XML-ATTRIBUTES.md lists them per class
// (scripts/xml-attribute-doc.mjs reads this list). `owner` is the class whose tag (or a subclass's) the rule is for; android.view.View is any tag.
const DISPATCH_DRAW_ONLY = 'the widget draws it in dispatchDraw, around its children, and the page composes a ViewGroup from its children without running that method; it is drawn where the widget is drawn through a Canvas';
export const ORIGINAL_ATTRIBUTES_WITHOUT_PAGE_EFFECT = [
  { owner: 'Landroid/widget/ListView;', names: ['divider', 'headerDividersEnabled', 'footerDividersEnabled', 'overScrollHeader', 'overScrollFooter'], reason: DISPATCH_DRAW_ONLY },
  { owner: 'Landroid/widget/AbsListView;', names: ['listSelector', 'drawSelectorOnTop'], reason: DISPATCH_DRAW_ONLY },
  { owner: 'Landroid/widget/ExpandableListView;', names: ['groupIndicator', 'childIndicator', 'indicatorLeft', 'indicatorRight', 'childIndicatorLeft', 'childIndicatorRight', 'childDivider', 'indicatorStart', 'indicatorEnd', 'childIndicatorStart', 'childIndicatorEnd'], reason: DISPATCH_DRAW_ONLY },
  { owner: 'Landroid/widget/TabWidget;', names: ['tabStripEnabled', 'tabStripLeft', 'tabStripRight'], reason: DISPATCH_DRAW_ONLY },
  { owner: 'Landroid/widget/NumberPicker;', names: ['solidColor'], reason: 'it is the colour of the fading edges, which are not drawn; the value is kept for getSolidColor()' },
  { owner: 'Landroid/view/View;', names: ['popupElevation'], reason: 'window shadows are not drawn (WindowManager.LayoutParams.setSurfaceInsets only keeps its flags); the popup window keeps the elevation' },
  { owner: 'Landroid/view/View;', names: ['popupAnimationStyle'], reason: 'the window manager of the virtual device runs no window animation style (WindowManager.LayoutParams.windowAnimations): the popup appears and goes at once' },
];
