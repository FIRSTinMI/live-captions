export type DeviceConfig = {
    name: string,
    id: number,
    channel: number,
    driver: number,
    color: string
}

export type DisplayConfig = {
    position: string,
    size: string,
    lines: string,
    chromaKey: string,
    timeout: string,
    align: string
}

export type ServerConfig = {
    port: number,
    devices: DeviceConfig[],
    filter: string[]
}

export type GoogleConfig = {
    projectId: string,
    scopes: string,
    credentials: {
        client_email: string,
        private_key: string
    }
}

type Config = {
    display: DisplayConfig,
    server: ServerConfig,
    google: GoogleConfig
}

export default Config;