import {
	type CSSProperties,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

export interface AnchorPos {
	left: number;
	top: number;
	placeBelow: boolean;
}

export function anchorPosStyle(pos: AnchorPos): CSSProperties {
	return {
		left: `${pos.left}px`,
		top: `${pos.top}px`,
		transform: pos.placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
	};
}

export function computeAnchorPos(
	rect: DOMRect,
	options: {
		minSpace: number;
		halfWidth: number;
		gap: number;
		prefer?: "below" | "above";
	},
): AnchorPos {
	const spaceBelow = window.innerHeight - rect.bottom;
	const placeBelow =
		options.prefer === "above"
			? rect.top < options.minSpace
			: spaceBelow >= options.minSpace || spaceBelow >= rect.top;
	const minHalf = Math.min(options.halfWidth, window.innerWidth / 2 - 8);
	const centerX = rect.left + rect.width / 2;
	return {
		left: Math.max(minHalf, Math.min(window.innerWidth - minHalf, centerX)),
		top: placeBelow ? rect.bottom + options.gap : rect.top - options.gap,
		placeBelow,
	};
}

export function useDismissListeners(
	active: boolean,
	options: {
		refs?: ReadonlyArray<RefObject<HTMLElement | null>>;
		onDismiss: () => void;
		onScroll?: boolean;
		onResize?: boolean;
	},
): void {
	const onDismissRef = useRef(options.onDismiss);
	onDismissRef.current = options.onDismiss;
	const refsRef = useRef(options.refs);
	refsRef.current = options.refs;

	useEffect(() => {
		if (!active) return;
		const hasRefs = Boolean(refsRef.current && refsRef.current.length > 0);
		const handleOutside = (event: Event) => {
			const target = event.target as Node | null;
			if (!target) return;
			const inside = refsRef.current?.some((ref) => ref.current?.contains(target));
			if (!inside) onDismissRef.current();
		};
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onDismissRef.current();
		};
		const handleViewport = (event: Event) => {
			const target = event.target as Node | null;
			if (target && refsRef.current?.some((ref) => ref.current?.contains(target))) return;
			onDismissRef.current();
		};

		if (hasRefs) {
			document.addEventListener("mousedown", handleOutside);
			document.addEventListener("touchstart", handleOutside, { passive: true });
		}
		document.addEventListener("keydown", handleKey);
		if (options.onScroll)
			window.addEventListener("scroll", handleViewport, { capture: true, passive: true });
		if (options.onResize) window.addEventListener("resize", handleViewport);

		return () => {
			if (hasRefs) {
				document.removeEventListener("mousedown", handleOutside);
				document.removeEventListener("touchstart", handleOutside);
			}
			document.removeEventListener("keydown", handleKey);
			if (options.onScroll) window.removeEventListener("scroll", handleViewport, { capture: true });
			if (options.onResize) window.removeEventListener("resize", handleViewport);
		};
	}, [active, options.onScroll, options.onResize]);
}

export function useAnchoredPopover<TTrigger extends HTMLElement = HTMLButtonElement>(
	isOpen: boolean,
	options: {
		minSpace: number;
		halfWidth: number;
		gap: number;
		prefer?: "below" | "above";
		onDismiss: () => void;
		onScroll?: boolean;
		onResize?: boolean;
	},
) {
	const triggerRef = useRef<TTrigger | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [pos, setPos] = useState<AnchorPos | null>(null);

	const updatePosition = useCallback(() => {
		if (!triggerRef.current) return;
		setPos(
			computeAnchorPos(triggerRef.current.getBoundingClientRect(), {
				minSpace: options.minSpace,
				halfWidth: options.halfWidth,
				gap: options.gap,
				prefer: options.prefer,
			}),
		);
	}, [options.minSpace, options.halfWidth, options.gap, options.prefer]);

	useDismissListeners(isOpen, {
		refs: [triggerRef, menuRef],
		onDismiss: options.onDismiss,
		onScroll: options.onScroll,
		onResize: options.onResize,
	});

	return { triggerRef, menuRef, pos, updatePosition };
}
