import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { type PanelPosition, VIEWPORT_MARGIN_PX } from "./useDraggablePanel";

export type ResizeEdge = "left" | "right";

export interface PanelSize {
	width: number | null;
	height: number | null;
}

export const DEFAULT_MIN_RAIL_WIDTH = 200;
export const DEFAULT_MAX_AUDIO_RAIL_WIDTH = 480;
export const DEFAULT_MAX_DICT_RAIL_WIDTH = 640;
export const DEFAULT_FALLBACK_RAIL_WIDTH = 236;
export const DEFAULT_MIN_AUDIO_HEIGHT = 200;
export const DEFAULT_MIN_DICT_HEIGHT = 280;
export const DEFAULT_MAX_RAIL_HEIGHT = 1200;
export const DEFAULT_FALLBACK_RAIL_HEIGHT = 320;
export const DOCKED_RAIL_VERTICAL_CHROME_PX = 136;
export const DESKTOP_MAIN_MIN_WIDTH = 430;

const KEYBOARD_RESIZE_STEP_PX = 16;
const KEYBOARD_RESIZE_LARGE_STEP_PX = 32;
const RESIZING_NWSE_BODY_CLASS = "is-panel-resizing-nwse";
const RESIZING_NESW_BODY_CLASS = "is-panel-resizing-nesw";

export function clampDimension(value: number, min: number, max: number): number {
	const safeMax = Math.max(min, max);
	return Math.round(Math.min(safeMax, Math.max(min, value)));
}

export function parseStoredRailDimension(value: unknown, min: number, max: number): number | null {
	return typeof value === "number" && Number.isFinite(value)
		? clampDimension(value, min, max)
		: null;
}

export function getDefaultRailWidthPx(viewportWidth: number): number {
	if (viewportWidth <= 0) return DEFAULT_FALLBACK_RAIL_WIDTH;
	return Math.round(Math.min(250, Math.max(216, viewportWidth * 0.16)));
}

export function computeMaxDockedRailHeight(
	viewportHeight: number,
	minHeight: number,
	maxHeight = DEFAULT_MAX_RAIL_HEIGHT,
): number {
	if (viewportHeight <= 0) return Math.max(minHeight, maxHeight);
	return Math.max(minHeight, Math.min(maxHeight, viewportHeight - DOCKED_RAIL_VERTICAL_CHROME_PX));
}

function parseCssPx(raw: string | undefined): number {
	if (!raw) return 0;
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Computes the combined pixel budget available for both desktop side rails
 * while keeping the center Scripture column at least `DESKTOP_MAIN_MIN_WIDTH`.
 */
export function computeWorkspaceAvailableRailBudget(
	workspaceEl: Element | null,
	viewportWidth: number,
): number {
	if (workspaceEl) {
		const rectWidth = workspaceEl.getBoundingClientRect().width;
		const clientWidth = workspaceEl instanceof HTMLElement ? workspaceEl.clientWidth : 0;
		const width = rectWidth > 0 ? rectWidth : clientWidth;
		if (width > 0 && typeof window !== "undefined") {
			const cs = window.getComputedStyle(workspaceEl);
			const padL = parseCssPx(cs.paddingLeft);
			const padR = parseCssPx(cs.paddingRight);
			const gap = parseCssPx(cs.columnGap);
			return Math.max(0, width - padL - padR - gap * 2 - DESKTOP_MAIN_MIN_WIDTH);
		}
		if (viewportWidth > 0) {
			// Fallback matching .reader-workspace.desktop-layout CSS clamp() padding & gap.
			const padding = Math.min(40, Math.max(18.4, viewportWidth * 0.02));
			const gap = Math.min(64, Math.max(26.4, viewportWidth * 0.03));
			return Math.max(0, viewportWidth - padding * 2 - gap * 2 - DESKTOP_MAIN_MIN_WIDTH);
		}
	}
	return viewportWidth > 0
		? Math.max(0, viewportWidth - VIEWPORT_MARGIN_PX * 2)
		: Number.POSITIVE_INFINITY;
}

export interface DockedRailLayoutInput {
	audioWidth: number | null;
	dictWidth: number | null;
	audioDockedOpen: boolean;
	dictDockedOpen: boolean;
	budget: number;
	defaultRailWidth: number;
	minWidth?: number;
	maxAudioWidth?: number;
	maxDictWidth?: number;
}

export interface DockedRailLayoutResult {
	audioWidth: number | null;
	dictWidth: number | null;
	maxAudioWidth: number;
	maxDictWidth: number;
}

export function resolveDockedRailWidths({
	audioWidth,
	dictWidth,
	audioDockedOpen,
	dictDockedOpen,
	budget,
	defaultRailWidth,
	minWidth = DEFAULT_MIN_RAIL_WIDTH,
	maxAudioWidth = DEFAULT_MAX_AUDIO_RAIL_WIDTH,
	maxDictWidth = DEFAULT_MAX_DICT_RAIL_WIDTH,
}: DockedRailLayoutInput): DockedRailLayoutResult {
	const hasFiniteBudget = Number.isFinite(budget);
	const audioTarget =
		audioDockedOpen && audioWidth !== null
			? clampDimension(audioWidth, minWidth, maxAudioWidth)
			: null;
	const dictTarget =
		dictDockedOpen && dictWidth !== null ? clampDimension(dictWidth, minWidth, maxDictWidth) : null;

	if (!hasFiniteBudget) {
		return {
			audioWidth: audioTarget,
			dictWidth: dictTarget,
			maxAudioWidth,
			maxDictWidth,
		};
	}

	let resolvedAudio = audioTarget;
	let resolvedDict = dictTarget;

	if (audioDockedOpen && dictDockedOpen) {
		const desiredAudio = resolvedAudio ?? defaultRailWidth;
		const desiredDict = resolvedDict ?? defaultRailWidth;
		if (desiredAudio + desiredDict > budget) {
			if (resolvedAudio === null && resolvedDict !== null) {
				resolvedDict = clampDimension(
					resolvedDict,
					minWidth,
					Math.min(maxDictWidth, Math.floor(budget - defaultRailWidth)),
				);
			} else if (resolvedDict === null && resolvedAudio !== null) {
				resolvedAudio = clampDimension(
					resolvedAudio,
					minWidth,
					Math.min(maxAudioWidth, Math.floor(budget - defaultRailWidth)),
				);
			} else if (resolvedAudio !== null && resolvedDict !== null) {
				const excessBudget = Math.max(0, Math.floor(budget) - minWidth * 2);
				const excessAudio = Math.max(0, resolvedAudio - minWidth);
				const excessDict = Math.max(0, resolvedDict - minWidth);
				const totalExcess = excessAudio + excessDict;
				const scale = totalExcess > 0 ? excessBudget / totalExcess : 0;
				resolvedAudio = Math.round(minWidth + excessAudio * scale);
				resolvedDict = Math.max(
					minWidth,
					Math.min(resolvedDict, Math.floor(budget) - resolvedAudio),
				);
			}
		}
	} else if (audioDockedOpen && resolvedAudio !== null) {
		resolvedAudio = clampDimension(
			resolvedAudio,
			minWidth,
			Math.min(maxAudioWidth, Math.floor(budget - defaultRailWidth)),
		);
	} else if (dictDockedOpen && resolvedDict !== null) {
		resolvedDict = clampDimension(
			resolvedDict,
			minWidth,
			Math.min(maxDictWidth, Math.floor(budget - defaultRailWidth)),
		);
	}

	const effectiveAudioCol = audioDockedOpen
		? (resolvedAudio ?? defaultRailWidth)
		: defaultRailWidth;
	const effectiveDictCol = dictDockedOpen ? (resolvedDict ?? defaultRailWidth) : defaultRailWidth;

	return {
		audioWidth: resolvedAudio,
		dictWidth: resolvedDict,
		maxAudioWidth: Math.max(
			minWidth,
			Math.min(maxAudioWidth, Math.floor(budget - effectiveDictCol)),
		),
		maxDictWidth: Math.max(
			minWidth,
			Math.min(maxDictWidth, Math.floor(budget - effectiveAudioCol)),
		),
	};
}

interface UseResizablePanelOptions<T extends HTMLElement> {
	enabled: boolean;
	panelRef: RefObject<T | null>;
	size?: PanelSize;
	onSizeChange?: (size: PanelSize) => void;
	minWidth?: number;
	maxWidth?: number;
	minHeight?: number;
	maxHeight?: number;
	isFloating?: boolean;
	position?: PanelPosition | null;
	onPositionChange?: (pos: PanelPosition | null) => void;
	onActivate?: () => void;
}

const EMPTY_PANEL_SIZE: PanelSize = { width: null, height: null };

export function useResizablePanel<T extends HTMLElement>({
	enabled,
	panelRef,
	size,
	onSizeChange,
	minWidth = DEFAULT_MIN_RAIL_WIDTH,
	maxWidth = DEFAULT_MAX_DICT_RAIL_WIDTH,
	minHeight = DEFAULT_MIN_DICT_HEIGHT,
	maxHeight = DEFAULT_MAX_RAIL_HEIGHT,
	isFloating = false,
	position,
	onPositionChange,
	onActivate,
}: UseResizablePanelOptions<T>) {
	const isControlled = size !== undefined;
	const [internalSize, setInternalSize] = useState<PanelSize>(EMPTY_PANEL_SIZE);
	const currentSize = isControlled ? size : internalSize;

	const sizeRef = useRef<PanelSize>(currentSize);
	sizeRef.current = currentSize;
	const minWidthRef = useRef(minWidth);
	minWidthRef.current = minWidth;
	const maxWidthRef = useRef(maxWidth);
	maxWidthRef.current = maxWidth;
	const minHeightRef = useRef(minHeight);
	minHeightRef.current = minHeight;
	const maxHeightRef = useRef(maxHeight);
	maxHeightRef.current = maxHeight;
	const isFloatingRef = useRef(isFloating);
	isFloatingRef.current = isFloating;
	const positionRef = useRef<PanelPosition | null>(position ?? null);
	positionRef.current = position ?? null;

	const onSizeChangeRef = useRef(onSizeChange);
	onSizeChangeRef.current = onSizeChange;
	const onPositionChangeRef = useRef(onPositionChange);
	onPositionChangeRef.current = onPositionChange;
	const onActivateRef = useRef(onActivate);
	onActivateRef.current = onActivate;

	const [resizingEdge, setResizingEdge] = useState<ResizeEdge | null>(null);
	const cleanupResizeRef = useRef<(() => void) | null>(null);

	const commitSize = useCallback(
		(next: PanelSize) => {
			sizeRef.current = next;
			if (!isControlled) {
				setInternalSize(next);
			}
			onSizeChangeRef.current?.(next);
		},
		[isControlled],
	);

	const resetSize = useCallback(() => {
		cleanupResizeRef.current?.();
		commitSize(EMPTY_PANEL_SIZE);
	}, [commitSize]);

	useEffect(() => {
		if (!enabled) {
			cleanupResizeRef.current?.();
		}
		return () => {
			cleanupResizeRef.current?.();
		};
	}, [enabled]);

	const resolveBounds = useCallback(
		(
			edge: ResizeEdge,
			startLeft: number,
			startTop: number,
			startRight: number,
			vw: number,
			vh: number,
			minW: number,
			maxW: number,
			minH: number,
			maxH: number,
		) => {
			const clampedMaxW = Math.max(minW, maxW);
			const clampedMaxH = Math.max(minH, maxH);
			let upperWidth = clampedMaxW;
			let upperHeight = clampedMaxH;

			if (isFloatingRef.current) {
				if (vw > 0) {
					upperWidth =
						edge === "left"
							? Math.min(clampedMaxW, Math.max(minW, startRight - VIEWPORT_MARGIN_PX))
							: Math.min(clampedMaxW, Math.max(minW, vw - VIEWPORT_MARGIN_PX - startLeft));
				}
				if (vh > 0) {
					upperHeight = Math.min(clampedMaxH, Math.max(minH, vh - VIEWPORT_MARGIN_PX - startTop));
				}
			} else {
				const workspaceEl = panelRef.current?.closest(".reader-workspace") ?? null;
				if (!workspaceEl && vw > 0) {
					upperWidth = Math.min(clampedMaxW, Math.max(minW, vw - VIEWPORT_MARGIN_PX * 2));
				}
				if (vh > 0) {
					upperHeight = computeMaxDockedRailHeight(vh, minH, clampedMaxH);
				}
			}

			return { upperWidth, upperHeight };
		},
		[panelRef],
	);

	const measurePanel = useCallback(() => {
		const rect = panelRef.current?.getBoundingClientRect();
		const vw = typeof window !== "undefined" ? window.innerWidth || 0 : 0;
		const vh = typeof window !== "undefined" ? window.innerHeight || 0 : 0;
		const existing = sizeRef.current;
		const startWidth =
			rect && rect.width > 0 ? rect.width : (existing.width ?? getDefaultRailWidthPx(vw));
		const startHeight =
			rect && rect.height > 0 ? rect.height : (existing.height ?? DEFAULT_FALLBACK_RAIL_HEIGHT);
		const existingPos = positionRef.current;
		const hasMeasuredPos = Boolean(rect && (rect.left !== 0 || rect.top !== 0 || !existingPos));
		const startLeft = hasMeasuredPos && rect ? rect.left : (existingPos?.x ?? 0);
		const startTop = hasMeasuredPos && rect ? rect.top : (existingPos?.y ?? 0);
		return {
			vw,
			vh,
			startWidth,
			startHeight,
			startLeft,
			startTop,
			startRight: startLeft + startWidth,
		};
	}, [panelRef]);

	const commitResizeStep = useCallback(
		(edge: ResizeEdge, nextSize: PanelSize, startRight: number, startTop: number) => {
			if (nextSize.width !== sizeRef.current.width || nextSize.height !== sizeRef.current.height) {
				commitSize(nextSize);
			}
			if (isFloatingRef.current && edge === "left" && nextSize.width !== null) {
				const nextLeft = Math.max(VIEWPORT_MARGIN_PX, Math.round(startRight - nextSize.width));
				if (nextLeft !== positionRef.current?.x) {
					onPositionChangeRef.current?.({
						x: nextLeft,
						y: Math.round(startTop),
					});
				}
			}
		},
		[commitSize],
	);

	const applyStepResize = useCallback(
		(edge: ResizeEdge, deltaWidth: number, deltaHeight: number) => {
			const minW = minWidthRef.current;
			const maxW = maxWidthRef.current;
			const minH = minHeightRef.current;
			const maxH = maxHeightRef.current;
			const { vw, vh, startWidth, startHeight, startLeft, startTop, startRight } = measurePanel();
			const { upperWidth, upperHeight } = resolveBounds(
				edge,
				startLeft,
				startTop,
				startRight,
				vw,
				vh,
				minW,
				maxW,
				minH,
				maxH,
			);
			const nextWidth =
				deltaWidth !== 0
					? clampDimension(startWidth + deltaWidth, minW, upperWidth)
					: sizeRef.current.width;
			const nextHeight =
				deltaHeight !== 0
					? clampDimension(startHeight + deltaHeight, minH, upperHeight)
					: sizeRef.current.height;
			commitResizeStep(edge, { width: nextWidth, height: nextHeight }, startRight, startTop);
		},
		[commitResizeStep, measurePanel, resolveBounds],
	);

	const startMouseResize = useCallback(
		(edge: ResizeEdge, e: ReactMouseEvent<HTMLElement>) => {
			if (!enabled || e.button !== 0 || typeof window === "undefined") return;
			e.preventDefault();
			e.stopPropagation();
			cleanupResizeRef.current?.();
			if (isFloatingRef.current) onActivateRef.current?.();

			const minW = minWidthRef.current;
			const maxW = maxWidthRef.current;
			const minH = minHeightRef.current;
			const maxH = maxHeightRef.current;
			const { vw, vh, startWidth, startHeight, startLeft, startTop, startRight } = measurePanel();
			const { upperWidth, upperHeight } = resolveBounds(
				edge,
				startLeft,
				startTop,
				startRight,
				vw,
				vh,
				minW,
				maxW,
				minH,
				maxH,
			);
			const startClientX = e.clientX;
			const startClientY = e.clientY;
			const bodyCursorClass =
				edge === "right" ? RESIZING_NWSE_BODY_CLASS : RESIZING_NESW_BODY_CLASS;
			let started = false;
			let widthActive = false;
			let heightActive = false;

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const dx = moveEvent.clientX - startClientX;
				const dy = moveEvent.clientY - startClientY;
				if (!widthActive && Math.abs(dx) >= 1) widthActive = true;
				if (!heightActive && Math.abs(dy) >= 1) heightActive = true;
				if (!widthActive && !heightActive) return;

				if (!started) {
					started = true;
					setResizingEdge(edge);
					document.body?.classList.add(bodyCursorClass);
					window.getSelection?.()?.removeAllRanges?.();
				}

				const nextWidth = widthActive
					? clampDimension(edge === "right" ? startWidth + dx : startWidth - dx, minW, upperWidth)
					: sizeRef.current.width;
				const nextHeight = heightActive
					? clampDimension(startHeight + dy, minH, upperHeight)
					: sizeRef.current.height;
				commitResizeStep(edge, { width: nextWidth, height: nextHeight }, startRight, startTop);
			};

			const cleanup = () => {
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", cleanup);
				window.removeEventListener("blur", cleanup);
				document.body?.classList.remove(RESIZING_NWSE_BODY_CLASS, RESIZING_NESW_BODY_CLASS);
				if (cleanupResizeRef.current === cleanup) {
					cleanupResizeRef.current = null;
				}
				setResizingEdge(null);
			};

			cleanupResizeRef.current = cleanup;
			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", cleanup);
			window.addEventListener("blur", cleanup);
		},
		[enabled, measurePanel, resolveBounds, commitResizeStep],
	);

	const handleSeparatorKeyDown = useCallback(
		(edge: ResizeEdge, e: ReactKeyboardEvent<HTMLElement>) => {
			if (!enabled) return;
			const step = e.shiftKey ? KEYBOARD_RESIZE_LARGE_STEP_PX : KEYBOARD_RESIZE_STEP_PX;
			if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
				e.preventDefault();
				e.stopPropagation();
				const growsOnRightArrow = edge === "right";
				const delta = (e.key === "ArrowRight") === growsOnRightArrow ? step : -step;
				applyStepResize(edge, delta, 0);
			} else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
				e.preventDefault();
				e.stopPropagation();
				applyStepResize(edge, 0, e.key === "ArrowDown" ? step : -step);
			} else if (e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				resetSize();
			}
		},
		[enabled, applyStepResize, resetSize],
	);

	const vw = typeof window !== "undefined" ? window.innerWidth || 0 : 0;
	const valueNow = Math.round(currentSize.width ?? getDefaultRailWidthPx(vw));

	const getHandleProps = useCallback(
		(edge: ResizeEdge, ariaLabel: string, handleId: string = edge) => ({
			"data-resize-handle": handleId,
			role: "separator" as const,
			"aria-orientation": "vertical" as const,
			"aria-label": ariaLabel,
			"aria-valuemin": minWidth,
			"aria-valuemax": Math.max(minWidth, Math.round(maxWidth)),
			"aria-valuenow": valueNow,
			tabIndex: 0,
			title: "Drag to resize · Double-click to reset",
			onMouseDown: (e: ReactMouseEvent<HTMLElement>) => startMouseResize(edge, e),
			onDoubleClick: (e: ReactMouseEvent<HTMLElement>) => {
				e.preventDefault();
				e.stopPropagation();
				resetSize();
			},
			onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => handleSeparatorKeyDown(edge, e),
		}),
		[minWidth, maxWidth, valueNow, startMouseResize, resetSize, handleSeparatorKeyDown],
	);

	return {
		currentSize,
		isResizing: resizingEdge !== null,
		resizingEdge,
		getHandleProps,
		resetSize,
	};
}
