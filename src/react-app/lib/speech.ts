let activeSpeechSeq = 0;

function getSpeechApis(): {
	synth: SpeechSynthesis;
	UtteranceCtor: typeof SpeechSynthesisUtterance;
} | null {
	if (typeof window === "undefined") return null;
	const win = window as {
		speechSynthesis?: SpeechSynthesis;
		SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
	};
	const synth = win.speechSynthesis;
	const UtteranceCtor = win.SpeechSynthesisUtterance ?? globalThis.SpeechSynthesisUtterance;
	if (!synth || typeof synth.speak !== "function" || typeof UtteranceCtor !== "function") {
		return null;
	}
	return { synth, UtteranceCtor };
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

export function stopKoreanSpeech(): void {
	activeSpeechSeq++;
	if (typeof window === "undefined") return;
	try {
		window.speechSynthesis?.cancel?.();
	} catch {}
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
	const apis = getSpeechApis();
	if (!trimmed || !apis) {
		options?.onError?.();
		return false;
	}

	const seq = ++activeSpeechSeq;
	try {
		apis.synth.cancel?.();
		const utterance = new apis.UtteranceCtor(trimmed);
		utterance.lang = "ko-KR";
		utterance.rate = options?.rate ?? 0.92;
		const voice = pickKoreanVoice(apis.synth);
		if (voice) utterance.voice = voice;
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
		apis.synth.speak(utterance);
		return true;
	} catch {
		if (seq === activeSpeechSeq) options?.onError?.();
		return false;
	}
}
