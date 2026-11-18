import type { FavoriteItem, HighlightItem } from "../../shared/types";
import { formatFavoriteLabel } from "../lib/favorites";
import { formatHighlightLabel } from "../lib/highlights";
import { Bookmark, Highlighter, X } from "./Icons";

interface FavoritesListProps {
	favorites: FavoriteItem[];
	highlights?: HighlightItem[];
	compact?: boolean;
	onSelectFavorite: (bookNumber: number, chapter: number, verse?: number) => void;
	onRemoveFavorite?: (id: string) => void;
	onRemoveHighlight?: (id: string) => void;
}

export function FavoritesList({
	favorites,
	highlights = [],
	compact = false,
	onSelectFavorite,
	onRemoveFavorite,
	onRemoveHighlight,
}: FavoritesListProps) {
	if (favorites.length === 0 && highlights.length === 0) {
		return (
			<p className="home-favorites-empty">
				No favorites yet. Click the bookmark icon on a chapter or verse, or select text and press ⌘H
				to save highlights here.
			</p>
		);
	}

	return (
		<div className={`home-favorites-groups ${compact ? "top-favorites-list" : ""}`.trim()}>
			{favorites.length > 0 && (
				<div className="home-favorites-group">
					<h3 className="home-favorites-group-title">Bookmarks ({favorites.length})</h3>
					<div className="home-favorites-list">
						{favorites.map((item) => {
							const { refEn, refKo, kind } = formatFavoriteLabel(item);
							return (
								<div key={item.id} className="home-favorite-card">
									<button
										type="button"
										className="home-favorite-open"
										onClick={() => onSelectFavorite(item.bookNumber, item.chapter, item.verse)}
									>
										<div className="home-favorite-head">
											<span className="home-favorite-ref">
												<Bookmark size={13} filled={true} className="home-favorite-icon" />
												<span>{refEn}</span>
												<span className="home-favorite-ko" lang="ko">
													· {refKo}
												</span>
											</span>
											<span className="home-favorite-kind">
												{kind === "chapter" ? "Chapter" : "Verse"}
											</span>
										</div>
										{(item.enText || item.koText) && (
											<div className="home-favorite-preview">
												{item.enText && <p className="home-favorite-preview-en">{item.enText}</p>}
												{item.koText && (
													<p className="home-favorite-preview-ko" lang="ko">
														{item.koText}
													</p>
												)}
											</div>
										)}
									</button>
									{onRemoveFavorite && (
										<button
											type="button"
											className="home-favorite-remove"
											onClick={() => onRemoveFavorite(item.id)}
											aria-label={`Remove ${refEn} from favorites`}
											title={`Remove ${refEn} from favorites`}
										>
											<X size={14} />
										</button>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{highlights.length > 0 && (
				<div className="home-favorites-group">
					<h3 className="home-favorites-group-title">Highlights ({highlights.length})</h3>
					<div className="home-favorites-list">
						{highlights.map((item) => {
							const { refEn, refKo, langLabel } = formatHighlightLabel(item);
							return (
								<div key={item.id} className="home-favorite-card home-highlight-card">
									<button
										type="button"
										className="home-favorite-open"
										onClick={() => onSelectFavorite(item.bookNumber, item.chapter, item.verse)}
									>
										<div className="home-favorite-head">
											<span className="home-favorite-ref">
												<Highlighter size={13} className="home-highlight-icon" />
												<span>{refEn}</span>
												<span className="home-favorite-ko" lang="ko">
													· {refKo}
												</span>
											</span>
											<span className="home-favorite-kind">Highlight · {langLabel}</span>
										</div>
										<div className="home-favorite-preview">
											<p
												className={
													item.lang === "ko"
														? "home-favorite-preview-ko home-highlight-line"
														: "home-favorite-preview-en home-highlight-line"
												}
												lang={item.lang === "ko" ? "ko" : undefined}
											>
												<mark className="verse-highlight home-highlight-excerpt">{item.text}</mark>
											</p>
										</div>
									</button>
									{onRemoveHighlight && (
										<button
											type="button"
											className="home-favorite-remove"
											onClick={() => onRemoveHighlight(item.id)}
											aria-label={`Remove highlight from ${refEn}`}
											title={`Remove highlight from ${refEn}`}
										>
											<X size={14} />
										</button>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
