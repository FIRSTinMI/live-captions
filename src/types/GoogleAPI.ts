export interface SpeechResultData {
    results: SpeechResult[]
}

export interface SpeechResult extends SpeechRecognitionResult {
    alternatives: SpeechRecognitionAlternative[]
}

export interface APIError extends Error {
    code: number
}