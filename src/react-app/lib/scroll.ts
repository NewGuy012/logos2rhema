/**
 * Scrolls `targetEl` inside `container` without scrolling the outer document viewport.
 */
export function scrollChildIntoContainer(container: HTMLElement, targetEl: HTMLElement): void {
	const containerRect = container.getBoundingClientRect();
	const targetRect = targetEl.getBoundingClientRect();
	if (containerRect.height > 0) {
		const topOffset = Math.max(12, Math.round(containerRect.height * 0.2));
		const nextTop = container.scrollTop + (targetRect.top - containerRect.top) - topOffset;
		if (typeof container.scrollTo === "function") {
			container.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
		} else {
			container.scrollTop = Math.max(0, nextTop);
		}
	} else if (typeof targetEl.scrollIntoView === "function") {
		targetEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}
}
