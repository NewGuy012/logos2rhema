let activeSpeechSeq = 0;

export function isKoreanSpeechSupported(): boolean {
	if (typeof window === "undefined") return false;
	const synth = (window as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
	const UtteranceCtor =
		(window as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
			.SpeechSynthesisUtterance ?? globalThis.SpeechSynthesisUtterance;
	return Boolean(synth && typeof synth.speak === "function" && typeof UtteranceCtor === "function");
}

function pickKoreanVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
	if (typeof synth.getVoices !== "function") return null;
	const voices = synth.getVoices();
	if (!voices || voices.length === 0) return null;
	return (
		voices.find((v) => v.lang.toLowerCase() === "ko-kr" && v.localService) ??
		voices.find((v) => v.lang.toLowerCase() === "ko-kr") ??
		voices.find((v) => v.lang.toLowerCase().startsWith("ko")) ??
		null
	);
}

export function speakKoreanWord(
	text: string,
	options?: {
		rate?: number;
		onStart?: () => void;
		onEnd?: () => void;
		onError?: () => void;
	},
): boolean {
	const trimmed = text.trim();
	if (!trimmed || !isKoreanSpeechSupported()) {
		options?.onError?.();
		return false;
	}

	const synth = window.speechSynthesis;
	const UtteranceCtor =
		(window as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
			.SpeechSynthesisUtterance ?? globalThis.SpeechSynthesisUtterance;
	const seq = ++activeSpeechSeq;

	try {
		synth.cancel?.();
		const utterance = new UtteranceCtor(trimmed);
		utterance.lang = "ko-KR";
		utterance.rate = options?.rate ?? 0.92;
		const voice = pickKoreanVoice(synth);
		if (voice) {
			utterance.voice = voice;
		}
		utterance.onstart = () => {
			if (seq === activeSpeechSeq) options?.onStart?.();
		};
		utterance.onend = () => {
			if (seq === activeSpeechSeq) options?.onEnd?.();
		};
		utterance.onerror = () => {
			if (seq === activeSpeechSeq) options?.onError?.();
		};
		options?.onStart?.();
		synth.speak(utterance);
		return true;
	} catch {
		if (seq === activeSpeechSeq) options?.onError?.();
		return false;
	}
}
