import React, { createContext, useState, useEffect, useContext } from 'react';
import io from 'socket.io-client';
import { AuthContext } from './AuthContext';

export const SocketContext = createContext();

// ⚠️ REPLACE WITH YOUR PC IP (Same as api/client.js)
const SOCKET_URL = 'http://192.168.0.235:3000'; 

export const SocketProvider = ({ children }) => {
  const { userToken, userInfo } = useContext(AuthContext);
  const [socket, setSocket] = useState(null);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    if (userToken && userInfo) {
      // 1. Initialize Socket
      const newSocket = io(SOCKET_URL, {
        transports: ['websocket'], // Force WebSocket for speed
        query: { token: userToken } // Optional: Send token if needed
      });

      console.log('🔌 Initializing Socket...');

      newSocket.on('connect', () => {
        console.log('✅ Socket Connected:', newSocket.id);
        setOnline(true);
        
        // 2. Identify User Type
        if (userInfo.role === 'rider') {
           newSocket.emit('joinRider', userInfo.id);
        } else if (userInfo.role === 'driver') {
           // Drivers go online manually usually, but we can register them
           // newSocket.emit('driverLocation', ...); 
        }
      });

      newSocket.on('disconnect', () => {
        console.log('❌ Socket Disconnected');
        setOnline(false);
      });

      setSocket(newSocket);

      // Cleanup on logout
      return () => newSocket.close();
    }
  }, [userToken, userInfo]);

  return (
    <SocketContext.Provider value={{ socket, online }}>
      {children}
    </SocketContext.Provider>
  );
};