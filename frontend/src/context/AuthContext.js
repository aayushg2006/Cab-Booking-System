// frontend/src/context/AuthContext.js
import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../api/client';
import { Alert } from 'react-native';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [userToken, setUserToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const isLoggedIn = async () => {
    try {
      setIsLoading(true);
      const storedToken = await AsyncStorage.getItem('userToken');
      const storedUser = await AsyncStorage.getItem('userInfo');

      if (storedToken && storedUser) {
        setUserToken(storedToken);
        setUserInfo(JSON.parse(storedUser));
      }
    } catch (e) {
      console.log('Auth bootstrap error:', e?.message || e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    isLoggedIn();
  }, []);

  const login = async (email, password) => {
    setIsLoading(true);
    try {
      const res = await client.post('/auth/login', { email, password });

      const user = res.data.user;
      if (user.role === 'driver' && !user.driverId) {
        user.driverId = user.id;
      }

      setUserInfo(user);
      setUserToken(res.data.token);

      await AsyncStorage.setItem('userToken', res.data.token);
      await AsyncStorage.setItem('userInfo', JSON.stringify(user));
    } catch (e) {
      console.log('Login failed:', e?.response?.data || e?.message || e);
      Alert.alert('Login Failed', e?.response?.data?.error || 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData) => {
    setIsLoading(true);
    try {
      const res = await client.post('/auth/register', userData);

      const user = res.data.user;
      if (user.role === 'driver' && !user.driverId) {
        user.driverId = user.id;
      }

      setUserInfo(user);
      setUserToken(res.data.token);

      await AsyncStorage.setItem('userToken', res.data.token);
      await AsyncStorage.setItem('userInfo', JSON.stringify(user));
    } catch (e) {
      console.log('Registration failed:', e?.response?.data || e?.message || e);
      Alert.alert('Registration Failed', e?.response?.data?.error || 'Error');
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      setUserToken(null);
      setUserInfo(null);
      await AsyncStorage.removeItem('userToken');
      await AsyncStorage.removeItem('userInfo');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ login, register, logout, isLoading, userToken, userInfo }}>
      {children}
    </AuthContext.Provider>
  );
};
