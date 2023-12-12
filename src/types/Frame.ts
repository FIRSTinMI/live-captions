export interface WebSocketMessage {
    type: string
}

export interface Frame extends WebSocketMessage {
    device: number,
    type: 'words',
    isFinal: boolean,
    text: string,
    confidence: number,
    speaker?: string,
    skip?: number
}