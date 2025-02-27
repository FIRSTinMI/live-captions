import { RtAudioApi } from "audify";

export interface DisplayConfig {
    position: number,
    size: number,
    lines: number,
    chromaKey: string,
    timeout: number,
    align: 'left' | 'center' | 'right',
    hidden: boolean;
}

export interface ServerConfig {
    port: number;
    google: {
        projectId: string,
        scopes: string,
        credentials: {
            client_email: string,
            private_key: string;
        };
    };
}

export interface TranscriptionConfig {
    filter: string[],
    streamingTimeout: number,
    inputs: InputConfig[],
    phraseSets: string[],
    engine: 'googlev1' | 'googlev2' | 'april' | 'whisper';
}

export type TransformationsConfig = { regex: RegExp, replacement: string; }[];

export interface InputConfig {
    id: number,
    device: number,
    speaker?: string,
    channel: number,
    sampleRate: number,
    color: string,
    driver: RtAudioApi.WINDOWS_ASIO | RtAudioApi.WINDOWS_DS | RtAudioApi.WINDOWS_WASAPI,
    threshold: number;
}

export interface JSONConfig {
    display: DisplayConfig,
    server: ServerConfig,
    transcription: TranscriptionConfig,
    transformations: TransformationsConfig;
}