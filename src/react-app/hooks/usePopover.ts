import { type RefObject, useEffect, useRef } from "react";

export interface AnchorPos {
	left: number;
	top: number;
	placeBelow: boolean;
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
		const handleOutside = (event: MouseEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			const inside = refsRef.current?.some((ref) => ref.current?.contains(target));
			if (!inside) onDismissRef.current();
		};
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onDismissRef.current();
		};
		const handleViewport = () => onDismissRef.current();

		if (refsRef.current && refsRef.current.length > 0) {
			document.addEventListener("mousedown", handleOutside);
		}
		document.addEventListener("keydown", handleKey);
		if (options.onScroll) window.addEventListener("scroll", handleViewport, { passive: true });
		if (options.onResize) window.addEventListener("resize", handleViewport);

		return () => {
			if (refsRef.current && refsRef.current.length > 0) {
				document.removeEventListener("mousedown", handleOutside);
			}
			document.removeEventListener("keydown", handleKey);
			if (options.onScroll) window.removeEventListener("scroll", handleViewport);
			if (options.onResize) window.removeEventListener("resize", handleViewport);
		};
	}, [active, options.onScroll, options.onResize]);
}
