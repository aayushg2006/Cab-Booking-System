import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../api/client';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [userToken, setUserToken] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Check if user is logged in when app opens
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
      const res = await client.post('/auth/login', { email, password });
      
      if (res.data.token) {
        console.log('Login Success:', res.data.user.email);
        setUserInfo(res.data.user);
        setUserToken(res.data.token);
        AsyncStorage.setItem('userToken', res.data.token);
        AsyncStorage.setItem('userInfo', JSON.stringify(res.data.user));
      }
    } catch (e) {
      console.log('Login Failed:', e.response?.data?.error);
      alert(e.response?.data?.error || 'Invalid Credentials');
    }
    setIsLoading(false);
  };

  const register = async (userData) => {
    setIsLoading(true);
    try {
        // Correct endpoint matching your backend route
        const res = await client.post('/auth/register', userData);
        
        if (res.data.token) {
            setUserInfo(res.data.user);
            setUserToken(res.data.token);
            AsyncStorage.setItem('userToken', res.data.token);
            AsyncStorage.setItem('userInfo', JSON.stringify(res.data.user));
        }
    } catch (e) {
        console.log('Register Failed:', e.response?.data?.error);
        alert(e.response?.data?.error || 'Registration Failed');
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