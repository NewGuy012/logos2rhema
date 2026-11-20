import {
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

export interface PanelPosition {
	x: number;
	y: number;
}

interface UseDraggablePanelOptions {
	enabled: boolean;
	position?: PanelPosition | null;
	onPositionChange?: (pos: PanelPosition | null) => void;
	onActivate?: () => void;
	isActive?: boolean;
	ignoreSelector?: string;
}

const DRAG_THRESHOLD_PX = 4;
const VIEWPORT_MARGIN_PX = 8;
const INTERACTIVE_SELECTOR =
	"button, a, input, select, textarea, label, [role='button'], [role='tab'], [role='switch'], [role='menuitemradio']";

function clampPosition(
	x: number,
	y: number,
	panelWidth: number,
	panelHeight: number,
): PanelPosition {
	const vw = typeof window !== "undefined" ? window.innerWidth || 0 : 0;
	const vh = typeof window !== "undefined" ? window.innerHeight || 0 : 0;
	if (vw <= 0 || vh <= 0) {
		return {
			x: Math.round(Math.max(VIEWPORT_MARGIN_PX, x)),
			y: Math.round(Math.max(VIEWPORT_MARGIN_PX, y)),
		};
	}
	const maxX = Math.max(VIEWPORT_MARGIN_PX, vw - panelWidth - VIEWPORT_MARGIN_PX);
	const clampedHeight = Math.min(panelHeight, Math.max(0, vh - VIEWPORT_MARGIN_PX * 2));
	const maxY = Math.max(VIEWPORT_MARGIN_PX, vh - clampedHeight - VIEWPORT_MARGIN_PX);
	return {
		x: Math.round(Math.min(maxX, Math.max(VIEWPORT_MARGIN_PX, x))),
		y: Math.round(Math.min(maxY, Math.max(VIEWPORT_MARGIN_PX, y))),
	};
}

export function useDraggablePanel<T extends HTMLElement>({
	enabled,
	position,
	onPositionChange,
	onActivate,
	isActive = false,
	ignoreSelector,
}: UseDraggablePanelOptions) {
	const panelRef = useRef<T | null>(null);
	const isControlled = position !== undefined;
	const [internalPosition, setInternalPosition] = useState<PanelPosition | null>(null);
	const currentPosition = isControlled ? (position ?? null) : internalPosition;
	const positionRef = useRef<PanelPosition | null>(currentPosition);
	positionRef.current = currentPosition;

	const onPositionChangeRef = useRef(onPositionChange);
	onPositionChangeRef.current = onPositionChange;

	const [isDragging, setIsDragging] = useState(false);
	const cleanupDragRef = useRef<(() => void) | null>(null);

	const commitPosition = useCallback(
		(next: PanelPosition | null) => {
			positionRef.current = next;
			if (!isControlled) {
				setInternalPosition(next);
			}
			onPositionChangeRef.current?.(next);
		},
		[isControlled],
	);

	const resetPosition = useCallback(() => {
		cleanupDragRef.current?.();
		commitPosition(null);
	}, [commitPosition]);

	useEffect(() => {
		if (!enabled) {
			cleanupDragRef.current?.();
		}
		return () => {
			cleanupDragRef.current?.();
		};
	}, [enabled]);

	const isFloating = enabled && currentPosition !== null;

	useEffect(() => {
		if (!enabled || !isFloating || typeof window === "undefined") return;
		const clampToViewport = () => {
			const pos = positionRef.current;
			if (!pos) return;
			const rect = panelRef.current?.getBoundingClientRect();
			const next = clampPosition(pos.x, pos.y, rect?.width ?? 0, rect?.height ?? 0);
			if (next.x !== pos.x || next.y !== pos.y) {
				commitPosition(next);
			}
		};
		clampToViewport();
		window.addEventListener("resize", clampToViewport);
		return () => window.removeEventListener("resize", clampToViewport);
	}, [enabled, isFloating, commitPosition]);

	const onMouseDownCapture = useCallback(() => {
		if (!enabled) return;
		if (positionRef.current) onActivate?.();
	}, [enabled, onActivate]);

	const onMouseDown = useCallback(
		(e: ReactMouseEvent<T>) => {
			if (!enabled || e.button !== 0 || typeof window === "undefined") return;
			const targetEl = e.target instanceof Element ? e.target : null;
			if (!targetEl) return;
			if (targetEl.closest(INTERACTIVE_SELECTOR)) return;
			if (ignoreSelector && targetEl.closest(ignoreSelector)) return;

			e.preventDefault();
			cleanupDragRef.current?.();

			const rect = panelRef.current?.getBoundingClientRect();
			const existingPos = positionRef.current;
			// Fall back to tracked position when synthetic DOM rect is (0, 0).
			const hasMeasuredPos = Boolean(rect && (rect.left !== 0 || rect.top !== 0 || !existingPos));
			const originLeft = hasMeasuredPos && rect ? rect.left : (existingPos?.x ?? 0);
			const originTop = hasMeasuredPos && rect ? rect.top : (existingPos?.y ?? 0);
			const panelWidth = rect?.width ?? 0;
			const panelHeight = rect?.height ?? 0;
			const startClientX = e.clientX;
			const startClientY = e.clientY;
			let started = false;

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const dx = moveEvent.clientX - startClientX;
				const dy = moveEvent.clientY - startClientY;
				if (!started) {
					if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
					started = true;
					setIsDragging(true);
					onActivate?.();
					window.getSelection?.()?.removeAllRanges?.();
				}
				commitPosition(clampPosition(originLeft + dx, originTop + dy, panelWidth, panelHeight));
			};

			const cleanup = () => {
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", cleanup);
				window.removeEventListener("blur", cleanup);
				if (cleanupDragRef.current === cleanup) {
					cleanupDragRef.current = null;
				}
				setIsDragging(false);
			};

			cleanupDragRef.current = cleanup;
			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", cleanup);
			window.addEventListener("blur", cleanup);
		},
		[enabled, ignoreSelector, onActivate, commitPosition],
	);

	const floatingStyle =
		isFloating && currentPosition
			? ({
					left: `${currentPosition.x}px`,
					top: `${currentPosition.y}px`,
					zIndex: isActive ? 46 : 45,
					"--floating-max-height": `calc(100vh - ${Math.max(VIEWPORT_MARGIN_PX, currentPosition.y)}px - ${VIEWPORT_MARGIN_PX}px)`,
				} as CSSProperties)
			: undefined;

	return {
		panelProps: {
			ref: panelRef,
			style: floatingStyle,
			...(enabled ? { onMouseDown, onMouseDownCapture } : {}),
		},
		position: currentPosition,
		isFloating,
		isDragging,
		resetPosition,
	};
}
