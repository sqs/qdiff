/**
 * Core UI framework exports
 */

export * from './binding.js'
export * from './build-context.js'
export * from './focus/index.js'
export * from './inherited-widget.js'
export * from './key.js'
export * from './layout/index.js'
export * from './media-query.js'
export * from './mouse/index.js'
export * from './parent-data.js'
export * from './parent-data-widget.js'
export * from './render-object.js'
export * from './render-object-widget.js'
export * from './state.js'
export * from './stateful-widget.js'
export * from './stateless-widget.js'
export * from './types.js'
export * from './widget.js'
export * from './widgets/ansi-text.js'
export * from './widgets/rich-text.js'
export * from './widgets/theme.js'

// Explicit re-exports for better IDE support
export { runApp, WidgetsBinding } from './binding.js'
export { BuildContextImpl } from './build-context.js'
export type { KeyboardEventHandler } from './focus/index.js'
export { FocusManager, FocusNode, KeyEventResult } from './focus/index.js'
export { InheritedElement, InheritedWidget } from './inherited-widget.js'
export { GlobalKey, Key, ObjectKey, UniqueKey, ValueKey } from './key.js'
export { MediaQuery, MediaQueryData } from './media-query.js'
export { ParentData } from './parent-data.js'
export { ParentDataElement, ParentDataWidget } from './parent-data-widget.js'
export { BoxConstraints, RenderBox, RenderObject } from './render-object.js'
export {
	LeafRenderObjectElement,
	LeafRenderObjectWidget,
	MultiChildRenderObjectElement,
	MultiChildRenderObjectWidget,
	RenderObjectElement,
	RenderObjectWidget,
	SingleChildRenderObjectElement,
	SingleChildRenderObjectWidget,
} from './render-object-widget.js'
export { State } from './state.js'
export { StatefulElement, StatefulWidget } from './stateful-widget.js'
export { StatelessElement, StatelessWidget } from './stateless-widget.js'
export { Element, Widget } from './widget.js'

// Actions and Shortcuts system
export * from './actions/index.js'
export { AnsiText, parseAnsiString } from './widgets/ansi-text.js'
export { Button } from './widgets/button.js'
export { Details, DetailsState } from './widgets/details.js'
export { DimContext } from './widgets/dim-context.js'
export { MouseRegion } from './widgets/mouse-region.js'
export { RgbThemeProvider } from './widgets/rgb-theme-provider.js'
export { RichText, TextAlign, TextOverflow, TextSpan, TextStyle } from './widgets/rich-text.js'
export { ColorScheme, Theme, ThemeData } from './widgets/theme.js'

// Scrolling widgets

export { SingleChildScrollView } from './widgets/single-child-scroll-view.js'
export { Scrollbar, type ScrollbarInfo } from './widgets/scrollbar.js'
export { ScrollController } from './scrolling/scroll-controller.js'

// Selection system
export { Focus, Focusable, FocusState } from './widgets/focus.js'
export * from './widgets/selection/index.js'
