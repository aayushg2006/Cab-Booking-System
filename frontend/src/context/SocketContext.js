import React, { createContext, useState, useEffect, useContext } from 'react';
import io from 'socket.io-client';
import { AuthContext } from './AuthContext';
import { SERVER_URL } from '../api/client';

export const SocketContext = createContext();

export const SocketProvider = ({ children }) => {
  const { userToken, userInfo } = useContext(AuthContext);
  const [socket, setSocket] = useState(null);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    if (userToken && userInfo) {
      console.log(`[SOCKET] Connecting to: ${SERVER_URL}`);

      const newSocket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
      });

      newSocket.on('connect', () => {
        console.log('Socket connected:', newSocket.id);
        setOnline(true);

        if (userInfo.role === 'rider') {
          newSocket.emit('joinRider', userInfo.id);
        }
      });

      newSocket.on('connect_error', (err) => {
        console.log('Socket connection error:', err.message);
      });

      newSocket.on('disconnect', () => {
        console.log('Socket disconnected');
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
