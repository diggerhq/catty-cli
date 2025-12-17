export const MessageType = {
  RESIZE: 'resize',
  SIGNAL: 'signal',
  PING: 'ping',
  PONG: 'pong',
  READY: 'ready',
  EXIT: 'exit',
  ERROR: 'error',
  SYNC_BACK: 'sync_back',
  SYNC_BACK_ACK: 'sync_back_ack',
  FILE_CHANGE: 'file_change',
} as const;

export interface BaseMessage {
  type: string;
}

export interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

export interface SignalMessage {
  type: 'signal';
  name: string;
}

export interface PingMessage {
  type: 'ping';
}

export interface PongMessage {
  type: 'pong';
}

export interface ReadyMessage {
  type: 'ready';
}

export interface ExitMessage {
  type: 'exit';
  code: number;
  signal: string | null;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface SyncBackMessage {
  type: 'sync_back';
  enabled: boolean;
}

export interface SyncBackAckMessage {
  type: 'sync_back_ack';
  enabled: boolean;
  workspace_dir?: string;
  interval_ms?: number;
}

export interface FileChangeMessage {
  type: 'file_change';
  action: 'write' | 'delete';
  path: string;
  content?: string; // base64 encoded
  mode?: number;
}

export type Message =
  | ResizeMessage
  | SignalMessage
  | PingMessage
  | PongMessage
  | ReadyMessage
  | ExitMessage
  | ErrorMessage
  | SyncBackMessage
  | SyncBackAckMessage
  | FileChangeMessage
  | BaseMessage;

export function parseMessage(data: string): Message {
  const base = JSON.parse(data) as BaseMessage;

  switch (base.type) {
    case MessageType.RESIZE:
      return JSON.parse(data) as ResizeMessage;
    case MessageType.SIGNAL:
      return JSON.parse(data) as SignalMessage;
    case MessageType.PING:
      return { type: 'ping' } as PingMessage;
    case MessageType.PONG:
      return { type: 'pong' } as PongMessage;
    case MessageType.READY:
      return { type: 'ready' } as ReadyMessage;
    case MessageType.EXIT:
      return JSON.parse(data) as ExitMessage;
    case MessageType.ERROR:
      return JSON.parse(data) as ErrorMessage;
    case MessageType.SYNC_BACK:
      return JSON.parse(data) as SyncBackMessage;
    case MessageType.SYNC_BACK_ACK:
      return JSON.parse(data) as SyncBackAckMessage;
    case MessageType.FILE_CHANGE:
      return JSON.parse(data) as FileChangeMessage;
    default:
      return base;
  }
}

export function createResizeMessage(cols: number, rows: number): string {
  return JSON.stringify({ type: MessageType.RESIZE, cols, rows });
}

export function createSignalMessage(name: string): string {
  return JSON.stringify({ type: MessageType.SIGNAL, name });
}

export function createPingMessage(): string {
  return JSON.stringify({ type: MessageType.PING });
}

export function createPongMessage(): string {
  return JSON.stringify({ type: MessageType.PONG });
}

export function createSyncBackMessage(enabled: boolean): string {
  return JSON.stringify({ type: MessageType.SYNC_BACK, enabled });
}
