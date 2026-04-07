import React, { createContext, useState, useEffect, useContext } from 'react';
import socketIOClient from 'socket.io-client';
import { AuthContext } from './AuthContext';
import { SERVER_URL } from '../api/client';

export const SocketContext = createContext();

export const SocketProvider = ({ children }) => {
  const { userToken, userInfo } = useContext(AuthContext);
  const [socket, setSocket] = useState(null);
  const [online, setOnline] = useState(false);
  const riderId = userInfo?.id;
  const driverId = userInfo?.driverId;
  const role = userInfo?.role;
  const hasSession = Boolean(userToken && riderId);

  useEffect(() => {
    if (hasSession) {
      console.log(`[SOCKET] Connecting to: ${SERVER_URL}`);

      const newSocket = socketIOClient(SERVER_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 6000,
        timeout: 20000,
        auth: { token: userToken },
      });

      const registerSocketIdentity = () => {
        if (role === 'rider' && riderId) {
          newSocket.emit('joinRider', riderId);
        }
        if (role === 'driver' && driverId) {
          newSocket.emit('joinDriver', driverId);
        }
      };

      newSocket.on('connect', () => {
        console.log('Socket connected:', newSocket.id);
        setOnline(true);
        registerSocketIdentity();
      });

      newSocket.on('connect_error', (err) => {
        console.log('Socket connection error:', err.message);
      });

      newSocket.on('reconnect', () => {
        registerSocketIdentity();
      });

      newSocket.on('disconnect', () => {
        console.log('Socket disconnected');
        setOnline(false);
      });

      setSocket(newSocket);

      return () => {
        newSocket.removeAllListeners();
        newSocket.disconnect();
        setSocket(null);
        setOnline(false);
      };
    }
  }, [hasSession, userToken, riderId, driverId, role]);

  return (
    <SocketContext.Provider value={{ socket, online }}>
      {children}
    </SocketContext.Provider>
  );
};
