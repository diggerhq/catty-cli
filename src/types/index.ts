export interface Credentials {
  access_token: string;
  refresh_token?: string;
  user_id: string;
  email: string;
  expires_at?: string;
}

export interface CreateSessionRequest {
  agent: string;
  cmd: string[];
  region: string;
  ttl_sec: number;
}

export interface CreateSessionResponse {
  session_id: string;
  label: string;
  machine_id: string;
  connect_url: string;
  connect_token: string;
  headers: Record<string, string>;
}

export interface SessionInfo {
  session_id: string;
  label: string;
  machine_id: string;
  connect_url: string;
  connect_token?: string;
  region: string;
  status: string;
  created_at: string;
  machine_state?: string;
  last_output?: string;
}

export interface RunOptions {
  agent: string;
  cmd: string[];
  region: string;
  ttlSec: number;
  apiAddr: string;
  uploadWorkspace: boolean;
  syncBack: boolean;
}

export interface ConnectOptions {
  sessionLabel: string;
  apiAddr: string;
  syncBack: boolean;
}

export interface ListOptions {
  apiAddr: string;
}

export interface StopOptions {
  sessionID: string;
  delete: boolean;
  apiAddr: string;
}

export interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id: string;
    email: string;
  };
  pending?: boolean;
  error?: string;
}

export interface APIErrorResponse {
  error: string;
  code?: string;
  upgrade_url?: string;
}
