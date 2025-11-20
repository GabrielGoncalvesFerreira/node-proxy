import axios from 'axios';
import { config } from '../config/env.js';

// Instância dedicada para chamadas ao Backend Laravel
export const httpClient = axios.create({
  baseURL: config.api.baseUrl,
  timeout: config.api.timeout,
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  },
});

// Interceptor opcional: Log de erros para facilitar debug em dev
httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (config.app.isDev) {
      console.error(`[HTTP Error] ${error.config?.url}:`, error.message);
    }
    return Promise.reject(error);
  }
);