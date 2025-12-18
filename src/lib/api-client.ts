import {
  DEFAULT_API_ADDR,
  API_TIMEOUT_MS,
} from './config.js';
import {
  getAccessToken,
  getRefreshToken,
  loadCredentials,
  saveCredentials,
} from './auth.js';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionInfo,
  APIErrorResponse,
} from '../types/index.js';

export class APIError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string,
    public upgradeURL?: string
  ) {
    super(message);
    this.name = 'APIError';
  }

  isQuotaExceeded(): boolean {
    return this.statusCode === 402 && this.errorCode === 'quota_exceeded';
  }
}

export class APIClient {
  private baseURL: string;
  private authToken: string | null;

  constructor(baseURL?: string) {
    this.baseURL = baseURL || process.env.CATTY_API_ADDR || DEFAULT_API_ADDR;
    this.authToken = getAccessToken();
  }

  private async doRequest(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const response = await fetch(`${this.baseURL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async doRequestWithRefresh(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    let response = await this.doRequest(method, path, body);

    if (response.status === 401) {
      const refreshed = await this.refreshAuthToken();
      if (refreshed) {
        response = await this.doRequest(method, path, body);
      }
    }

    return response;
  }

  private async refreshAuthToken(): Promise<boolean> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await this.doRequest('POST', '/v1/auth/refresh', {
        refresh_token: refreshToken,
      });

      if (!response.ok) return false;

      const data = await response.json();
      if (!data.access_token) return false;

      // Update stored credentials
      const creds = loadCredentials();
      if (creds) {
        creds.access_token = data.access_token;
        if (data.refresh_token) {
          creds.refresh_token = data.refresh_token;
        }
        if (data.expires_in) {
          creds.expires_at = new Date(
            Date.now() + (data.expires_in - 30) * 1000
          ).toISOString();
        }
        saveCredentials(creds);
        this.authToken = data.access_token;
      }

      return true;
    } catch {
      return false;
    }
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let errorData: APIErrorResponse;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: response.statusText };
      }

      throw new APIError(
        response.status,
        errorData.code || '',
        errorData.error || response.statusText,
        errorData.upgrade_url
      );
    }

    return response.json() as Promise<T>;
  }

  async createSession(req: CreateSessionRequest): Promise<CreateSessionResponse> {
    const response = await this.doRequestWithRefresh('POST', '/v1/sessions', req);
    return this.handleResponse<CreateSessionResponse>(response);
  }

  async listSessions(): Promise<SessionInfo[]> {
    const response = await this.doRequestWithRefresh('GET', '/v1/sessions');
    return this.handleResponse<SessionInfo[]>(response);
  }

  async getSession(idOrLabel: string, live?: boolean): Promise<SessionInfo> {
    const path = live
      ? `/v1/sessions/${idOrLabel}?live=true`
      : `/v1/sessions/${idOrLabel}`;
    const response = await this.doRequestWithRefresh('GET', path);
    return this.handleResponse<SessionInfo>(response);
  }

  async stopSession(idOrLabel: string, del?: boolean): Promise<void> {
    const path = del
      ? `/v1/sessions/${idOrLabel}/stop?delete=true`
      : `/v1/sessions/${idOrLabel}/stop`;
    const response = await this.doRequestWithRefresh('POST', path);

    if (!response.ok) {
      let errorData: APIErrorResponse;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: response.statusText };
      }
      throw new APIError(
        response.status,
        errorData.code || '',
        errorData.error || response.statusText
      );
    }
  }

  async createCheckoutSession(): Promise<string> {
    const response = await this.doRequestWithRefresh('POST', '/v1/checkout');
    const data = await this.handleResponse<{ url: string }>(response);
    return data.url;
  }

  async getSessionDownload(
    idOrLabel: string
  ): Promise<{ download_url: string; size_bytes?: number }> {
    const response = await this.doRequestWithRefresh(
      'GET',
      `/v1/sessions/${idOrLabel}/download`
    );
    return this.handleResponse<{ download_url: string; size_bytes?: number }>(
      response
    );
  }
}
