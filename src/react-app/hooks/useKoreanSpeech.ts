import { useCallback, useState } from "react";

import { speakKoreanWord } from "../lib/speech";

/**
 * Tracks active Korean pronunciation playback target and speech availability errors.
 */
export function useKoreanSpeech<T extends string = string>() {
	const [speakingKey, setSpeakingKey] = useState<T | null>(null);
	const [speechErrorKey, setSpeechErrorKey] = useState<T | null>(null);

	const speak = useCallback((text: string, key: T) => {
		setSpeechErrorKey(null);
		const started = speakKoreanWord(text, {
			onStart: () => setSpeakingKey(key),
			onEnd: () => setSpeakingKey((cur) => (cur === key ? null : cur)),
			onError: () => {
				setSpeakingKey((cur) => (cur === key ? null : cur));
				setSpeechErrorKey(key);
			},
		});
		if (!started) {
			setSpeakingKey(null);
			setSpeechErrorKey(key);
		}
	}, []);

	const clearSpeechError = useCallback(() => {
		setSpeechErrorKey(null);
	}, []);

	return { speakingKey, speechErrorKey, speak, clearSpeechError };
}
