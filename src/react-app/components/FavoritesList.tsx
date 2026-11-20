import type { ReactNode } from "react";

import type { FavoriteItem, HighlightItem } from "../../shared/types";
import { formatFavoriteLabel } from "../lib/favorites";
import { formatHighlightLabel } from "../lib/highlights";
import { Bookmark, Highlighter, X } from "./Icons";

export interface SavedItemsProps {
	favorites?: FavoriteItem[];
	highlights?: HighlightItem[];
	onRemoveFavorite?: (id: string) => void;
	onRemoveHighlight?: (id: string) => void;
	onClearFavorites?: () => void;
	onClearHighlights?: () => void;
}

interface FavoritesListProps extends SavedItemsProps {
	favorites: FavoriteItem[];
	compact?: boolean;
	onSelectFavorite: (bookNumber: number, chapter: number, verse?: number) => void;
}

function SavedItemCard({
	icon,
	refEn,
	refKo,
	kindLabel,
	preview,
	removeLabel,
	onOpen,
	onRemove,
}: {
	icon: ReactNode;
	refEn: string;
	refKo: string;
	kindLabel: string;
	preview: ReactNode;
	removeLabel: string;
	onOpen: () => void;
	onRemove?: () => void;
}) {
	return (
		<div className="home-favorite-card">
			<button type="button" className="home-favorite-open" onClick={onOpen}>
				<div className="home-favorite-head">
					<span className="home-favorite-ref">
						{icon}
						<span>{refEn}</span>
						<span className="home-favorite-ko" lang="ko">
							· {refKo}
						</span>
					</span>
					<span className="home-favorite-kind">{kindLabel}</span>
				</div>
				{preview}
			</button>
			{onRemove && (
				<button
					type="button"
					className="home-favorite-remove"
					onClick={onRemove}
					aria-label={removeLabel}
					title={removeLabel}
				>
					<X size={14} />
				</button>
			)}
		</div>
	);
}

function SavedGroup({
	title,
	clearLabel,
	clearAriaLabel,
	onClear,
	children,
}: {
	title: string;
	clearLabel: string;
	clearAriaLabel: string;
	onClear?: () => void;
	children: ReactNode;
}) {
	return (
		<div className="home-favorites-group">
			<div className="home-favorites-group-head">
				<h3 className="home-favorites-group-title">{title}</h3>
				{onClear && (
					<button
						type="button"
						className="home-clear-btn"
						onClick={onClear}
						aria-label={clearAriaLabel}
					>
						{clearLabel}
					</button>
				)}
			</div>
			<div className="home-favorites-list">{children}</div>
		</div>
	);
}

export function FavoritesList({
	favorites,
	highlights = [],
	compact = false,
	onSelectFavorite,
	onRemoveFavorite,
	onRemoveHighlight,
	onClearFavorites,
	onClearHighlights,
}: FavoritesListProps) {
	if (favorites.length === 0 && highlights.length === 0) {
		return (
			<p className="home-favorites-empty">
				No favorites yet. Click the bookmark icon on a chapter or verse, or select text and press ⌘H
				to save highlights here.
			</p>
		);
	}

	const canClearBoth =
		favorites.length > 0 && highlights.length > 0 && Boolean(onClearFavorites && onClearHighlights);

	return (
		<div className={`home-favorites-groups ${compact ? "top-favorites-list" : ""}`.trim()}>
			{canClearBoth && (
				<div className="home-favorites-toolbar">
					<button
						type="button"
						className="home-clear-btn home-clear-all-btn"
						onClick={() => {
							onClearFavorites?.();
							onClearHighlights?.();
						}}
						aria-label="Clear all bookmarks and highlights"
					>
						Clear all
					</button>
				</div>
			)}

			{favorites.length > 0 && (
				<SavedGroup
					title={`Bookmarks (${favorites.length})`}
					clearLabel="Clear bookmarks"
					clearAriaLabel="Clear all bookmarks"
					onClear={onClearFavorites}
				>
					{favorites.map((item) => {
						const { refEn, refKo, kind } = formatFavoriteLabel(item);
						return (
							<SavedItemCard
								key={item.id}
								icon={<Bookmark size={13} filled={true} className="home-favorite-icon" />}
								refEn={refEn}
								refKo={refKo}
								kindLabel={kind === "chapter" ? "Chapter" : "Verse"}
								onOpen={() => onSelectFavorite(item.bookNumber, item.chapter, item.verse)}
								removeLabel={`Remove ${refEn} from favorites`}
								onRemove={onRemoveFavorite ? () => onRemoveFavorite(item.id) : undefined}
								preview={
									item.koText && (
										<div className="home-favorite-preview">
											<p className="home-favorite-preview-ko" lang="ko">
												{item.koText}
											</p>
										</div>
									)
								}
							/>
						);
					})}
				</SavedGroup>
			)}

			{highlights.length > 0 && (
				<SavedGroup
					title={`Highlights (${highlights.length})`}
					clearLabel="Clear highlights"
					clearAriaLabel="Clear all highlights"
					onClear={onClearHighlights}
				>
					{highlights.map((item) => {
						const { refEn, refKo, langLabel } = formatHighlightLabel(item);
						return (
							<SavedItemCard
								key={item.id}
								icon={<Highlighter size={13} className="home-highlight-icon" />}
								refEn={refEn}
								refKo={refKo}
								kindLabel={`Highlight · ${langLabel}`}
								onOpen={() => onSelectFavorite(item.bookNumber, item.chapter, item.verse)}
								removeLabel={`Remove highlight from ${refEn}`}
								onRemove={onRemoveHighlight ? () => onRemoveHighlight(item.id) : undefined}
								preview={
									<div className="home-favorite-preview">
										<p
											className={
												item.lang === "ko" ? "home-favorite-preview-ko" : "home-favorite-preview-en"
											}
											lang={item.lang === "ko" ? "ko" : undefined}
										>
											<mark className="verse-highlight home-highlight-excerpt">{item.text}</mark>
										</p>
									</div>
								}
							/>
						);
					})}
				</SavedGroup>
			)}
		</div>
	);
}
