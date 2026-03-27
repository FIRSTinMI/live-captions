import { EventEmitter } from 'events';
import { Frame } from '../types/Frame';

export interface MicStatusPayload {
    devices: { id: number; active: boolean; }[];
}

export type DisplayControlEvent =
    | { type: 'clear' }
    | { type: 'hide'; value: boolean }
    | { type: 'config' }
    | { type: 'reload' };

class TypedEmitter<TEvents extends Record<string, any>> extends EventEmitter {
    emit<K extends keyof TEvents>(event: K & string, payload: TEvents[K]): boolean {
        return super.emit(event, payload);
    }
    on<K extends keyof TEvents>(event: K & string, listener: (payload: TEvents[K]) => void): this {
        return super.on(event, listener);
    }
    off<K extends keyof TEvents>(event: K & string, listener: (payload: TEvents[K]) => void): this {
        return super.off(event, listener);
    }
}

export const captionBus = new TypedEmitter<{ frame: Frame }>();
export const micBus = new TypedEmitter<{ status: MicStatusPayload }>();
export const displayCtrlBus = new TypedEmitter<{ event: DisplayControlEvent }>();
export const errorBus = new TypedEmitter<{ error: { message: string; context?: Record<string, unknown> } }>();
