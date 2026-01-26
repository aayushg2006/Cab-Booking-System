// src/api/client.js
import axios from 'axios';

// ⚠️ REPLACE THIS with your PC's Local IP Address (Run 'ipconfig' or 'ifconfig')
// Example: 'http://192.168.29.183:3000/api'
const BASE_URL = 'http://192.168.0.235:3000/api'; 

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default client;