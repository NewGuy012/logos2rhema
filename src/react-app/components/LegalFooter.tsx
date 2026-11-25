import { SUPERTONIC_LICENSE_NAME, SUPERTONIC_LICENSE_URL } from "../../shared/audio-timings";

export function LegalFooter({ className = "copyright-footer" }: { className?: string }) {
	return (
		<footer className={className}>
			<p className="copyright-footer-line">
				Korean text: 성경전서 개역한글판 (1961, 대한성서공회, 저작재산권 만료 / economic rights
				expired in Korea).
			</p>
			<p className="copyright-footer-line">
				Korean audio: <span lang="ko">AI 낭독</span> (Supertonic 3 by Supertone,{" "}
				<a href={SUPERTONIC_LICENSE_URL} target="_blank" rel="noopener noreferrer">
					{SUPERTONIC_LICENSE_NAME}
				</a>
				).
			</p>
			<p className="copyright-footer-line">
				Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), ©
				2001 by Crossway, a publishing ministry of Good News Publishers. ESV Text Edition: 2025.
				Used by permission. All rights reserved. (
				<a href="https://www.esv.org" target="_blank" rel="noopener noreferrer">
					ESV.org
				</a>
				)
			</p>
		</footer>
	);
}
