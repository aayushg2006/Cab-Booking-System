import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import io from 'socket.io-client';

export default function App() {
  const [status, setStatus] = useState('🔴 Connecting to Server...');

  useEffect(() => {
    // 1. Connect to your Backend
    // IMPORTANT: Replace '192.168.1.X' with your actual PC IP address.
    // Run 'ipconfig' in your terminal to find it.
    // Do NOT use 'localhost' if testing on a real phone.
    const socket = io('http://192.168.1.5:3000'); 

    socket.on('connect', () => {
      console.log('Connected to server!');
      setStatus('🟢 Connected to Cab Server!');
    });

    socket.on('connect_error', (err) => {
      console.log('Connection Failed:', err);
      setStatus('🔴 Connection Failed. Check IP.');
    });

    return () => socket.disconnect();
  }, []);

  return (
    <View style={styles.container}>
      {/* Status Bar */}
      <View style={styles.statusBar}>
         <Text style={styles.statusText}>{status}</Text>
      </View>

      {/* The Map */}
      <MapView 
        style={styles.map} 
        initialRegion={{
          latitude: 19.0760,
          longitude: 72.8777,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {/* Test Marker in Mumbai */}
        <Marker coordinate={{ latitude: 19.0760, longitude: 72.8777 }} title="Test Driver" />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBar: {
    position: 'absolute',
    top: 50,
    zIndex: 10,
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },
  statusText: {
    fontWeight: 'bold',
  },
  map: {
    width: '100%',
    height: '100%',
  },
});