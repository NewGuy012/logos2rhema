import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import {
	attachWindowDrag,
	measurePanelOrigin,
	type PanelPosition,
	VIEWPORT_MARGIN_PX,
} from "./useDraggablePanel";

export type ResizeEdge = "left" | "right";

export interface PanelSize {
	width: number | null;
	height: number | null;
}

export const DEFAULT_MIN_RAIL_WIDTH = 200;
export const DEFAULT_MAX_AUDIO_RAIL_WIDTH = 480;
export const DEFAULT_MAX_DICT_RAIL_WIDTH = 640;
export const DEFAULT_MIN_AUDIO_HEIGHT = 200;
export const DEFAULT_MIN_DICT_HEIGHT = 280;
export const DEFAULT_MAX_RAIL_HEIGHT = 1200;

const DESKTOP_MAIN_MIN_WIDTH = 430;
const DOCKED_RAIL_VERTICAL_CHROME_PX = 136;
const FALLBACK_PANEL_HEIGHT = 320;

function getDefaultRailWidth(): number {
	const vpW = typeof window !== "undefined" ? window.innerWidth : 0;
	return vpW > 0 ? clampDimension(vpW * 0.16, 216, 250) : 230;
}
const KEYBOARD_STEP_PX = 16;
const KEYBOARD_STEP_LARGE_PX = 32;
const RESIZE_ACTIVATION_THRESHOLD_PX = 1;
const EMPTY_PANEL_SIZE: PanelSize = { width: null, height: null };

export function clampDimension(value: number, min: number, max: number): number {
	const safeMax = Math.max(min, max);
	return Math.round(Math.min(safeMax, Math.max(min, value)));
}

export function parseStoredRailDimension(value: unknown, min: number, max: number): number | null {
	return typeof value === "number" && Number.isFinite(value)
		? clampDimension(value, min, max)
		: null;
}

function setBodyResizeState(edge: ResizeEdge | null): void {
	if (typeof document === "undefined") return;
	if (edge) {
		document.body.classList.add("is-panel-resizing");
		document.body.style.cursor = edge === "right" ? "nwse-resize" : "nesw-resize";
	} else {
		document.body.classList.remove("is-panel-resizing");
		document.body.style.cursor = "";
	}
}

export interface UseResizablePanelOptions<T extends HTMLElement> {
	panelRef: RefObject<T | null>;
	disabled?: boolean;
	size?: PanelSize;
	onSizeChange?: (size: PanelSize) => void;
	minWidth?: number;
	maxWidth?: number;
	minHeight?: number;
	maxHeight?: number;
	floatingPosition?: PanelPosition | null;
	onFloatingPositionChange?: (pos: PanelPosition | null) => void;
	onActivate?: () => void;
}

export function useResizablePanel<T extends HTMLElement>({
	panelRef,
	disabled = false,
	size,
	onSizeChange,
	minWidth = DEFAULT_MIN_RAIL_WIDTH,
	maxWidth = DEFAULT_MAX_DICT_RAIL_WIDTH,
	minHeight = DEFAULT_MIN_DICT_HEIGHT,
	maxHeight = DEFAULT_MAX_RAIL_HEIGHT,
	floatingPosition,
	onFloatingPositionChange,
	onActivate,
}: UseResizablePanelOptions<T>) {
	const isControlled = size !== undefined;
	const [internalSize, setInternalSize] = useState<PanelSize>(EMPTY_PANEL_SIZE);
	const currentSize = isControlled ? (size ?? EMPTY_PANEL_SIZE) : internalSize;

	const latestRef = useRef({
		currentSize,
		isControlled,
		onSizeChange,
		floatingPosition,
		onFloatingPositionChange,
		onActivate,
		disabled,
		minWidth,
		maxWidth,
		minHeight,
		maxHeight,
	});
	latestRef.current = {
		currentSize,
		isControlled,
		onSizeChange,
		floatingPosition,
		onFloatingPositionChange,
		onActivate,
		disabled,
		minWidth,
		maxWidth,
		minHeight,
		maxHeight,
	};

	const cleanupDragRef = useRef<(() => void) | null>(null);
	const [resizingEdge, setResizingEdge] = useState<ResizeEdge | null>(null);

	useEffect(() => () => cleanupDragRef.current?.(), []);

	const updateSize = useCallback((next: PanelSize) => {
		latestRef.current.currentSize = next;
		if (!latestRef.current.isControlled) {
			setInternalSize(next);
		}
		latestRef.current.onSizeChange?.(next);
	}, []);

	const resetSize = useCallback(() => {
		const { width, height } = latestRef.current.currentSize;
		if (width === null && height === null) return;
		updateSize(EMPTY_PANEL_SIZE);
	}, [updateSize]);

	const commitResize = useCallback(
		(edge: ResizeEdge, next: PanelSize, startRight: number, startTop: number) => {
			updateSize(next);
			const { floatingPosition: pos, onFloatingPositionChange: onPosChange } = latestRef.current;
			if (!pos || !onPosChange || edge !== "left" || next.width === null) return;
			const nextX = Math.max(VIEWPORT_MARGIN_PX, Math.round(startRight - next.width));
			if (nextX !== pos.x || startTop !== pos.y) {
				onPosChange({ x: nextX, y: startTop });
			}
		},
		[updateSize],
	);

	const measure = useCallback((panel: T) => {
		const { currentSize: active, floatingPosition: pos } = latestRef.current;
		const { rect, left, top } = measurePanelOrigin(panel, pos);
		const width =
			rect && rect.width > 0
				? rect.width
				: (active.width ?? panel.offsetWidth) || getDefaultRailWidth();
		const height =
			rect && rect.height > 0
				? rect.height
				: (active.height ?? panel.offsetHeight) || FALLBACK_PANEL_HEIGHT;
		return { width, height, right: left + width, top };
	}, []);

	const resolveBounds = useCallback((panel: T, currentWidth: number) => {
		const {
			minWidth: minW,
			maxWidth: maxW,
			minHeight: minH,
			maxHeight: maxH,
			floatingPosition: pos,
		} = latestRef.current;
		const vpW = typeof window !== "undefined" ? window.innerWidth : 0;
		const vpH = typeof window !== "undefined" ? window.innerHeight : 0;
		const vpWidthLimit = vpW > 0 ? Math.max(minW, vpW - VIEWPORT_MARGIN_PX * 2) : maxW;
		let upperWidth = Math.min(maxW, vpWidthLimit);

		if (pos == null) {
			const workspace = panel.closest(".reader-workspace.desktop-layout");
			if (workspace && typeof getComputedStyle === "function") {
				const cols = getComputedStyle(workspace).gridTemplateColumns.trim().split(/\s+/);
				const centerColToken = cols[1] ?? "";
				const centerWidth = Number.parseFloat(centerColToken);
				if (centerColToken.endsWith("px") && Number.isFinite(centerWidth)) {
					upperWidth = Math.min(
						upperWidth,
						currentWidth + Math.max(0, centerWidth - DESKTOP_MAIN_MIN_WIDTH),
					);
				}
			}
		}

		const vpHeightLimit =
			vpH > 0
				? pos != null
					? Math.max(minH, vpH - VIEWPORT_MARGIN_PX * 2)
					: Math.max(minH, vpH - DOCKED_RAIL_VERTICAL_CHROME_PX)
				: maxH;

		return {
			minW,
			minH,
			upperWidth: Math.max(minW, upperWidth),
			upperHeight: Math.max(minH, Math.min(maxH, vpHeightLimit)),
		};
	}, []);

	const startMouseResize = useCallback(
		(edge: ResizeEdge, e: ReactMouseEvent<HTMLElement>) => {
			if (e.button !== 0 || latestRef.current.disabled) return;
			const panel = panelRef.current;
			if (!panel) return;
			e.preventDefault();
			e.stopPropagation();
			latestRef.current.onActivate?.();

			const start = measure(panel);
			const bounds = resolveBounds(panel, start.width);
			const startX = e.clientX;
			const startY = e.clientY;
			let activeW = false;
			let activeH = false;

			const onMove = (moveEvent: MouseEvent) => {
				const rawDx = edge === "right" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
				const rawDy = moveEvent.clientY - startY;
				if (Math.abs(rawDx) >= RESIZE_ACTIVATION_THRESHOLD_PX) activeW = true;
				if (Math.abs(rawDy) >= RESIZE_ACTIVATION_THRESHOLD_PX) activeH = true;
				if (!activeW && !activeH) return;

				const existing = latestRef.current.currentSize;
				commitResize(
					edge,
					{
						width: activeW
							? clampDimension(start.width + rawDx, bounds.minW, bounds.upperWidth)
							: existing.width,
						height: activeH
							? clampDimension(start.height + rawDy, bounds.minH, bounds.upperHeight)
							: existing.height,
					},
					start.right,
					start.top,
				);
			};

			attachWindowDrag(cleanupDragRef, onMove, () => {
				setResizingEdge(null);
				setBodyResizeState(null);
			});
			setResizingEdge(edge);
			setBodyResizeState(edge);
		},
		[commitResize, measure, panelRef, resolveBounds],
	);

	const handleKeyDown = useCallback(
		(edge: ResizeEdge, e: ReactKeyboardEvent<HTMLElement>) => {
			if (latestRef.current.disabled) return;
			if (e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				resetSize();
				return;
			}
			const step = e.shiftKey ? KEYBOARD_STEP_LARGE_PX : KEYBOARD_STEP_PX;
			const sign = edge === "right" ? 1 : -1;
			let dw = 0;
			let dh = 0;
			if (e.key === "ArrowLeft") dw = -step * sign;
			else if (e.key === "ArrowRight") dw = step * sign;
			else if (e.key === "ArrowUp") dh = -step;
			else if (e.key === "ArrowDown") dh = step;
			else return;

			const panel = panelRef.current;
			if (!panel) return;
			e.preventDefault();
			e.stopPropagation();
			latestRef.current.onActivate?.();

			const start = measure(panel);
			const bounds = resolveBounds(panel, start.width);
			const existing = latestRef.current.currentSize;
			commitResize(
				edge,
				{
					width:
						dw !== 0
							? clampDimension(start.width + dw, bounds.minW, bounds.upperWidth)
							: existing.width,
					height:
						dh !== 0
							? clampDimension(start.height + dh, bounds.minH, bounds.upperHeight)
							: existing.height,
				},
				start.right,
				start.top,
			);
		},
		[commitResize, measure, panelRef, resetSize, resolveBounds],
	);

	const getHandleProps = useCallback(
		(edge: ResizeEdge, ariaLabel: string, handleId: string = edge) => ({
			role: "separator" as const,
			tabIndex: disabled ? -1 : 0,
			"aria-label": ariaLabel,
			"aria-valuemin": minWidth,
			"aria-valuemax": Math.max(minWidth, maxWidth),
			"aria-valuenow": Math.round(currentSize.width ?? getDefaultRailWidth()),
			"data-resize-handle": handleId,
			onMouseDown: (e: ReactMouseEvent<HTMLElement>) => startMouseResize(edge, e),
			onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => handleKeyDown(edge, e),
			onDoubleClick: (e: ReactMouseEvent<HTMLElement>) => {
				if (disabled) return;
				e.stopPropagation();
				resetSize();
			},
		}),
		[currentSize.width, disabled, handleKeyDown, maxWidth, minWidth, resetSize, startMouseResize],
	);

	return {
		size: currentSize,
		isResized: currentSize.width !== null || currentSize.height !== null,
		isResizing: resizingEdge !== null,
		resizingEdge,
		resetSize,
		getHandleProps,
	};
}
