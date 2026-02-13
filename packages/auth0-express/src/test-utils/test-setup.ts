import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { generateToken } from './tokens.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createAuth0 } from '../index.js';
import { encrypt } from './encryption.js';

export const domain = 'auth0.local';
export let accessToken: string;
export let idToken: string;
export let mockOpenIdConfiguration = {
  issuer: `https://${domain}/`,
  authorization_endpoint: `https://${domain}/authorize`,
  backchannel_authentication_endpoint: `https://${domain}/custom-authorize`,
  token_endpoint: `https://${domain}/custom/token`,
  end_session_endpoint: `https://${domain}/logout`,
};

export const restHandlers = [
  http.get(`https://${domain}/.well-known/openid-configuration`, () => {
    return HttpResponse.json(mockOpenIdConfiguration);
  }),
  http.post(mockOpenIdConfiguration.backchannel_authentication_endpoint, () => {
    return HttpResponse.json({
      auth_req_id: 'auth_req_123',
      expires_in: 60,
    });
  }),
  http.post(mockOpenIdConfiguration.token_endpoint, async () => {
    return HttpResponse.json({
      access_token: accessToken,
      id_token: idToken,
      expires_in: 60,
      token_type: 'Bearer',
    });
  }),
];

export const server = setupServer(...restHandlers);

export async function setupTests() {
  accessToken = await generateToken(domain, 'user_123');
  idToken = await generateToken(domain, 'user_123', '<client_id>');
}

export function resetMockConfig() {
  mockOpenIdConfiguration = {
    issuer: `https://${domain}/`,
    authorization_endpoint: `https://${domain}/authorize`,
    backchannel_authentication_endpoint: `https://${domain}/custom-authorize`,
    token_endpoint: `https://${domain}/custom/token`,
    end_session_endpoint: `https://${domain}/logout`,
  };
}

export function parseCookies(setCookieHeader: string | string[] | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!setCookieHeader) return cookies;

  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  headers.forEach((header) => {
    const parts = header.split(';')[0]!.split('=');
    if (parts.length >= 2) {
      const name = parts[0]!.trim();
      const value = parts.slice(1).join('=').trim();
      cookies[name] = value;
    }
  });
  return cookies;
}

export function createConfiguredApp(options: Parameters<typeof createAuth0>[0]) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(createAuth0(options));
  return app;
}

export async function authenticateUser(app: express.Application, claims?: Record<string, unknown>) {
  if (claims) {
    accessToken = await generateToken(domain, 'user_123', '<client_id>', undefined, undefined, undefined, claims);
    idToken = await generateToken(domain, 'user_123', '<client_id>', undefined, undefined, undefined, claims);
  }

  const cookieName = '__a0_tx';
  const txCookieValue = await encrypt({}, '<secret>', cookieName, Date.now() + 1000);
  const callbackRes = await request(app)
    .get('/auth/callback')
    .query({ code: '123' })
    .set('cookie', `${cookieName}=${txCookieValue}`);

  const cookies = parseCookies(callbackRes.headers['set-cookie']);
  const sessionCookieHeader = Object.entries(cookies)
    .filter(([name]) => name.startsWith('__a0_session'))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

  return sessionCookieHeader;
}

// Update module-level variables
export function setAccessToken(token: string) {
  accessToken = token;
}

export function setIdToken(token: string) {
  idToken = token;
}
