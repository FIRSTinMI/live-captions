export interface Frame {
    type: 'words';
    device: number;
    isFinal: boolean;
    text: string;
    confidence: number;
    speaker?: string;
    skip?: number;
}

export interface DisplayConfig {
    position: number;
    size: number;
    lines: number;
    chromaKey: string;
    timeout: number;
    align: 'left' | 'center' | 'right';
    hidden: boolean;
}

export interface ServerConfig {
    port: number;
    google: object;
}

export interface InputConfig {
    id: number;
    device: number;
    deviceName?: string;
    speaker?: string;
    channel: number;
    sampleRate: number;
    color: string;
    driver: number;
    threshold: number;
    autoThreshold?: boolean;
    thresholdLastSet?: number;
    languages: string[];
}

export interface TranscriptionConfig {
    filter: string[];
    streamingTimeout: number;
    inputs: InputConfig[];
    phraseSets: string[];
    engine: 'googlev1' | 'googlev2' | 'april';
}

export interface AppConfig {
    display: DisplayConfig;
    server: ServerConfig;
    transcription: TranscriptionConfig;
}

export type DisplayControlEvent =
    | { type: 'clear' }
    | { type: 'hide'; value: boolean }
    | { type: 'config' }
    | { type: 'reload' };

export interface MicStatusPayload {
    devices: { id: number; active: boolean }[];
}

export interface PhysicalDevice {
    id: number;
    name: string;
    inputChannels: number;
    outputChannels: number;
}
