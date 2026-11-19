import { useEffect, useState } from "react";

function useMediaQuery(query: string, defaultMatches = true): boolean {
	const [matches, setMatches] = useState(() =>
		typeof window !== "undefined" && typeof window.matchMedia === "function"
			? window.matchMedia(query).matches
			: defaultMatches,
	);

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
		const mql = window.matchMedia(query);
		const update = () => setMatches(mql.matches);
		update();
		mql.addEventListener("change", update);
		return () => mql.removeEventListener("change", update);
	}, [query]);

	return matches;
}

export function useIsDesktopLayout(): boolean {
	return useMediaQuery("(min-width: 1024px)");
}
