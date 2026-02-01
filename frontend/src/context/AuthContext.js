// frontend/src/context/AuthContext.js
import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../api/client';
import { Alert } from 'react-native';
import { registerForPushNotificationsAsync } from '../api/notificationHelper';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [userToken, setUserToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const isLoggedIn = async () => {
    try {
      setIsLoading(true);
      let userToken = await AsyncStorage.getItem('userToken');
      let userInfo = await AsyncStorage.getItem('userInfo');
      
      if (userToken) {
        setUserToken(userToken);
        setUserInfo(JSON.parse(userInfo));
      }
      setIsLoading(false);
    } catch (e) {
      console.log(`Log in error ${e}`);
    }
  };

  useEffect(() => {
    isLoggedIn();
  }, []);

const login = async (email, password) => {
    setIsLoading(true);
    try {
      // 🔔 1. Get Push Token
      const pushToken = await registerForPushNotificationsAsync();

      // 🔔 2. Send token with credentials
      const res = await client.post('/auth/login', { 
          email, 
          password,
          pushToken // <--- Sending to Backend
      });
      
      let user = res.data.user;
      if (user.role === 'driver' && !user.driverId) user.driverId = user.id;

      setUserInfo(user);
      setUserToken(res.data.token);

      AsyncStorage.setItem('userToken', res.data.token);
      AsyncStorage.setItem('userInfo', JSON.stringify(user));

    } catch (e) {
      console.log('Login Failed:', e);
      Alert.alert('Login Failed', e.response?.data?.error || 'Something went wrong');
    }
    setIsLoading(false);
  };

const register = async (userData) => {
    setIsLoading(true);
    try {
        // 🔔 1. Get Push Token
        const pushToken = await registerForPushNotificationsAsync();

        // 🔔 2. Send token with registration data
        const res = await client.post('/auth/register', {
            ...userData,
            pushToken // <--- Sending to Backend
        });

        let user = res.data.user;
        if (user.role === 'driver' && !user.driverId) user.driverId = user.id;

        setUserInfo(user);
        setUserToken(res.data.token);
        AsyncStorage.setItem('userToken', res.data.token);
        AsyncStorage.setItem('userInfo', JSON.stringify(user));
    } catch (e) {
        Alert.alert('Registration Failed', e.response?.data?.error || 'Error');
    }
    setIsLoading(false);
  };

  const logout = () => {
    setIsLoading(true);
    setUserToken(null);
    AsyncStorage.removeItem('userToken');
    AsyncStorage.removeItem('userInfo');
    setIsLoading(false);
  };

  return (
    <AuthContext.Provider value={{ login, register, logout, isLoading, userToken, userInfo }}>
      {children}
    </AuthContext.Provider>
  );
};