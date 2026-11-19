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

export const Bible = makeIcon(
	<>
		<path
			d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a2.5 2.5 0 0 1 0-5H20"
			fill="var(--accent-soft)"
		/>
		<path d="M12.5 6v6.5" />
		<path d="M10 8.5h5" />
	</>,
);

export function Bookmark({
	size = 16,
	className,
	filled = false,
}: IconProps & { filled?: boolean }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill={filled ? "currentColor" : "none"}
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={className}
		>
			<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
		</svg>
	);
}

export const BookOpen = makeIcon(
	<>
		<path d="M12 7v14" />
		<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
	</>,
);

export const BookText = makeIcon(
	<>
		<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a2.5 2.5 0 0 1 0-5H20" />
		<path d="M8 11h8" />
		<path d="M8 7h6" />
	</>,
);

export const ChevronDown = makeIcon(<path d="m6 9 6 6 6-6" />);
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

export const Highlighter = makeIcon(
	<>
		<path d="m9 11-6 6v3h9l3-3" />
		<path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
	</>,
);

export const Home = makeIcon(
	<>
		<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
		<path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
	</>,
);

export const Loader2 = makeIcon(<path d="M21 12a9 9 0 1 1-6.219-8.56" />);

export const Pause = makeIcon(
	<>
		<rect x="14" y="3" width="5" height="18" rx="1" />
		<rect x="5" y="3" width="5" height="18" rx="1" />
	</>,
);

export const Pin = makeIcon(
	<>
		<path d="M12 17v5" />
		<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
	</>,
);

export const Play = makeIcon(<polygon points="6 3 20 12 6 21 6 3" />);

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

export const Settings = makeIcon(
	<>
		<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
		<circle cx="12" cy="12" r="3" />
	</>,
);

export const Volume2 = makeIcon(
	<>
		<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
		<path d="M16 9a5 5 0 0 1 0 6" />
		<path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
	</>,
);

export const X = makeIcon(
	<>
		<path d="M18 6 6 18" />
		<path d="m6 6 12 12" />
	</>,
);
