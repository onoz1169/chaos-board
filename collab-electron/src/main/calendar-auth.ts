import { shell } from "electron";
import { google } from "googleapis";
import * as http from "node:http";
import type { AppConfig } from "./config";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const REDIRECT_PORT = 49152;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth/callback`;

export interface CalendarTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
}

export function createOAuth2Client(clientId: string, clientSecret: string) {
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

export async function startOAuthFlow(
  clientId: string,
  clientSecret: string,
): Promise<CalendarTokens> {
  const oauth2Client = createOAuth2Client(clientId, clientSecret);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  return new Promise((resolve, reject) => {
    let server: http.Server | null = null;

    const timeout = setTimeout(() => {
      server?.close();
      reject(new Error("OAuth timeout"));
    }, 5 * 60 * 1000);

    server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith("/oauth/callback")) return;

      const params = new URL(req.url, `http://localhost:${REDIRECT_PORT}`).searchParams;
      const code = params.get("code");
      const error = params.get("error");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<html><body><script>window.close()</script><p>認証完了。このタブを閉じてください。</p></body></html>`);

      clearTimeout(timeout);
      server?.close();

      if (error || !code) {
        reject(new Error(error || "No code received"));
        return;
      }

      try {
        const { tokens } = await oauth2Client.getToken(code);
        resolve(tokens as CalendarTokens);
      } catch (e) {
        reject(e);
      }
    });

    server.listen(REDIRECT_PORT, "localhost", () => {
      shell.openExternal(authUrl);
    });

    server.on("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

export function getStoredTokens(config: AppConfig): CalendarTokens | null {
  return (config.ui["google_calendar_tokens"] as CalendarTokens) ?? null;
}

export function getStoredCredentials(config: AppConfig): { clientId: string; clientSecret: string } | null {
  const clientId = config.ui["google_calendar_client_id"] as string | undefined;
  const clientSecret = config.ui["google_calendar_client_secret"] as string | undefined;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function buildAuthedClient(config: AppConfig) {
  const creds = getStoredCredentials(config);
  const tokens = getStoredTokens(config);
  if (!creds || !tokens) return null;

  const oauth2Client = createOAuth2Client(creds.clientId, creds.clientSecret);
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}
