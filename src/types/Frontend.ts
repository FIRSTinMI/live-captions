export interface DeviceStats {
    transcript: string,
    lastFrameWasFinal: boolean,
    currentDiv?: HTMLDivElement,
    currentTimeout?: ReturnType<typeof setTimeout>,
    color: string
}