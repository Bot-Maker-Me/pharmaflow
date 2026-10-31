import * as React from "react";

interface ResizableOptions {
  initial: number;
  min: number;
  max: number;
  /** Set when the panel grows to the left of the handle (i.e. handle on the left edge). */
  invert?: boolean;
}

/**
 * Pointer-driven panel resizing used by the split verification workspace.
 * The returned `onHandlePointerDown` should be bound to a divider element that
 * sits between the two panes.
 */
export function useResizable({ initial, min, max, invert = false }: ResizableOptions) {
  const [width, setWidth] = React.useState(initial);
  const [dragging, setDragging] = React.useState(false);
  const startRef = React.useRef({ x: 0, width: initial });

  const clamp = React.useCallback((value: number) => Math.min(max, Math.max(min, value)), [max, min]);

  const onHandlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      startRef.current = { x: event.clientX, width };
      setDragging(true);
    },
    [width],
  );

  const onHandlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const delta = (event.clientX - startRef.current.x) * (invert ? 1 : -1);
      setWidth(clamp(startRef.current.width + delta));
    },
    [clamp, dragging, invert],
  );

  const endDrag = React.useCallback(() => setDragging(false), []);

  const onHandleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 40 : 12;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setWidth((value) => clamp(value + (invert ? -step : step)));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setWidth((value) => clamp(value + (invert ? step : -step)));
      }
    },
    [clamp, invert],
  );

  const reset = React.useCallback(() => setWidth(initial), [initial]);

  return {
    width,
    dragging,
    reset,
    handleProps: {
      onPointerDown: onHandlePointerDown,
      onPointerMove: onHandlePointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onDoubleClick: reset,
      onKeyDown: onHandleKeyDown,
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-label": "Resize panels",
      tabIndex: 0,
    },
  };
}
