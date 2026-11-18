import type { ReactNode } from "react";

interface IconProps {
	size?: number;
	className?: string;
}

function makeIcon(children: ReactNode) {
	return function Icon({ size = 16, className }: IconProps) {
		return (
			<svg
				width={size}
				height={size}
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={2}
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
				className={className}
			>
				{children}
			</svg>
		);
	};
}

export const ArrowLeft = makeIcon(
	<>
		<path d="m12 19-7-7 7-7" />
		<path d="M19 12H5" />
	</>,
);

export const ArrowRight = makeIcon(
	<>
		<path d="M5 12h14" />
		<path d="m12 5 7 7-7 7" />
	</>,
);

export const ArrowUpDown = makeIcon(
	<>
		<path d="m21 16-4 4-4-4" />
		<path d="M17 20V4" />
		<path d="m3 8 4-4 4 4" />
		<path d="M7 4v16" />
	</>,
);

export const BookOpen = makeIcon(
	<>
		<path d="M12 7v14" />
		<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
	</>,
);

export const ChevronLeft = makeIcon(<path d="m15 18-6-6 6-6" />);
export const ChevronRight = makeIcon(<path d="m9 18 6-6-6-6" />);

export const Crosshair = makeIcon(
	<>
		<circle cx="12" cy="12" r="10" />
		<line x1="22" x2="18" y1="12" y2="12" />
		<line x1="6" x2="2" y1="12" y2="12" />
		<line x1="12" x2="12" y1="6" y2="2" />
		<line x1="12" x2="12" y1="22" y2="18" />
	</>,
);

export const Headphones = makeIcon(
	<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />,
);

export const Loader2 = makeIcon(<path d="M21 12a9 9 0 1 1-6.219-8.56" />);

export const Pause = makeIcon(
	<>
		<rect x="14" y="3" width="5" height="18" rx="1" />
		<rect x="5" y="3" width="5" height="18" rx="1" />
	</>,
);

export const RefreshCw = makeIcon(
	<>
		<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
		<path d="M21 3v5h-5" />
		<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
		<path d="M8 16H3v5" />
	</>,
);

export const RotateCcw = makeIcon(
	<>
		<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
		<path d="M3 3v5h5" />
	</>,
);

export const RotateCw = makeIcon(
	<>
		<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
		<path d="M21 3v5h-5" />
	</>,
);

export const Search = makeIcon(
	<>
		<path d="m21 21-4.34-4.34" />
		<circle cx="11" cy="11" r="8" />
	</>,
);

export const Type = makeIcon(
	<>
		<path d="M12 4v16" />
		<path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
		<path d="M9 20h6" />
	</>,
);

export const X = makeIcon(
	<>
		<path d="M18 6 6 18" />
		<path d="m6 6 12 12" />
	</>,
);
