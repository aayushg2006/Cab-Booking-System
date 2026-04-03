import axios from 'axios';
import Constants from 'expo-constants';

const DEFAULT_BACKEND_PORT = process.env.EXPO_PUBLIC_SERVER_PORT || '4000';

const stripApiSuffix = (url) => {
  if (!url) return null;
  return url.trim().replace(/\/+$/, '').replace(/\/api$/i, '');
};

const deriveServerUrlFromExpoHost = () => {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.hostUri ||
    Constants.manifest2?.extra?.expoClient?.hostUri ||
    Constants.manifest?.debuggerHost ||
    null;

  if (!hostUri) return null;

  const host = hostUri.split(':')[0];
  if (!host) return null;git 

  return `http://${host}:${DEFAULT_BACKEND_PORT}`;
};

export const SERVER_URL =
  stripApiSuffix(process.env.EXPO_PUBLIC_SERVER_URL) ||
  deriveServerUrlFromExpoHost() ||
  `http://localhost:${DEFAULT_BACKEND_PORT}`;

export const API_BASE_URL = `${SERVER_URL}/api`;

if (__DEV__) {
  console.log(`[API] Base URL: ${API_BASE_URL}`);
}

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

export default client;
