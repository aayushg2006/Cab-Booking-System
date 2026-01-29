import React, { createContext, useState, useEffect, useContext } from 'react';
import io from 'socket.io-client';
import { AuthContext } from './AuthContext';

export const SocketContext = createContext();

// Use the same URL as the API
const SOCKET_URL = process.env.EXPO_PUBLIC_SERVER_URL || 'http://192.168.1.109:3000';

export const SocketProvider = ({ children }) => {
  const { userToken, userInfo } = useContext(AuthContext);
  const [socket, setSocket] = useState(null);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    if (userToken && userInfo) {
      console.log(`🔌 Connecting to Socket at: ${SOCKET_URL}`);

      // 1. Initialize Socket
      const newSocket = io(SOCKET_URL, {
        transports: ['websocket'], // ⚠️ CRITICAL for Android
        reconnection: true,
        reconnectionAttempts: 5,
      });

      newSocket.on('connect', () => {
        console.log('✅ Socket Connected! ID:', newSocket.id);
        setOnline(true);
        
        // 2. Identify User Type immediately
        if (userInfo.role === 'rider') {
           newSocket.emit('joinRider', userInfo.id);
        }
      });

      newSocket.on('connect_error', (err) => {
        console.log('❌ Socket Connection Error:', err.message);
      });

      newSocket.on('disconnect', () => {
        console.log('❌ Socket Disconnected');
        setOnline(false);
      });

      setSocket(newSocket);

      return () => newSocket.close();
    }
  }, [userToken, userInfo]);

  return (
    <SocketContext.Provider value={{ socket, online }}>
      {children}
    </SocketContext.Provider>
  );
};