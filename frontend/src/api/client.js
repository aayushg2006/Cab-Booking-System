import axios from 'axios';

// Load from .env or fallback to localhost (which won't work on Android but is safe default)
const BASE_URL = process.env.EXPO_PUBLIC_SERVER_URL 
  ? `${process.env.EXPO_PUBLIC_SERVER_URL}/api`
  : 'http://192.168.1.110:3000/api'; 

console.log(`🚀 API Configured for: ${BASE_URL}`);

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

export default client;