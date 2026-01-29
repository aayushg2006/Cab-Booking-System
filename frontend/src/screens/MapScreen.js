import React, { useEffect, useState, useContext, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert, Keyboard, Dimensions, ActivityIndicator } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import MapViewDirections from 'react-native-maps-directions'; 
import * as Location from 'expo-location';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import { Ionicons } from '@expo/vector-icons';

import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';
import client from '../api/client';
import { colors } from '../theme/colors';

import RideRequestPanel from '../components/RideRequestPanel';
import DriverRequestModal from '../components/DriverRequestModal';

// ⚠️ REPLACE WITH YOUR REAL KEY
const GOOGLE_API_KEY = 'AIzaSy...YOUR_KEY_HERE'; 

const { width, height } = Dimensions.get('window');

const MapScreen = ({ navigation }) => {
  const { userInfo, userToken } = useContext(AuthContext);
  const { socket } = useContext(SocketContext);
  const mapRef = useRef(null);

  // 1. Initialize with a SAFE default (prevent null crash)
  const [location, setLocation] = useState(null); 
  const [destination, setDestination] = useState(null);
  const [routeInfo, setRouteInfo] = useState({ distance: 0, fare: 0 });
  const [status, setStatus] = useState('IDLE'); 
  const [activeBooking, setActiveBooking] = useState(null);
  const [isDriverOnline, setIsDriverOnline] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [loadingLocation, setLoadingLocation] = useState(true);

  // 📍 Get Current Location
  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Allow location access to use the app.');
          setLoadingLocation(false);
          return;
        }

        let loc = await Location.getCurrentPositionAsync({});
        const currentLoc = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.015,
          longitudeDelta: 0.0121,
        };
        setLocation(currentLoc);
        setLoadingLocation(false);

        // Emit driver location if online
        if (userInfo.role === 'driver' && isDriverOnline && socket) {
            socket.emit('driverLocation', { driverId: userInfo.driverId, ...currentLoc });
        }
      } catch (error) {
        console.log("Error getting location:", error);
        Alert.alert("Error", "Could not fetch location.");
        setLoadingLocation(false);
      }
    })();
  }, [isDriverOnline]);

  // ⚡ Socket Listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('rideAccepted', (data) => {
        setStatus('ACCEPTED');
        setActiveBooking(prev => ({ ...prev, ...data }));
    });

    socket.on('rideStarted', () => setStatus('ONGOING'));

    socket.on('rideCompleted', ({ fare }) => {
        setStatus('COMPLETED');
        Alert.alert('Ride Completed', `Total Fare: $${fare}`);
        navigation.navigate('Payment', { fare, bookingId: activeBooking?.bookingId });
        setStatus('IDLE');
        setDestination(null);
        setActiveBooking(null);
    });

    socket.on('newRideRequest', (data) => setIncomingRequest(data));

    return () => socket.offAll();
  }, [socket, activeBooking]);

  // --- 🗺️ REAL SEARCH HANDLER ---
  const handleDestinationSelect = (data, details = null) => {
    if (!details) return;
    const lat = details.geometry.location.lat;
    const lng = details.geometry.location.lng;
    const destLoc = { latitude: lat, longitude: lng };

    setDestination(destLoc);
    setStatus('SELECTING');

    // Fit map to route
    if (location) {
      mapRef.current.fitToCoordinates([location, destLoc], {
          edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
          animated: true,
      });
    }
  };

  // --- 🛣️ CALCULATE FARE ---
  const onDirectionsReady = (result) => {
      const distKm = result.distance;
      const price = (2.5 + (distKm * 1.5)).toFixed(2);
      setRouteInfo({ distance: distKm.toFixed(1), fare: price });
  };

  const requestRide = async () => {
    setStatus('SEARCHING');
    try {
        const res = await client.post('/bookings/request', {
            riderId: userInfo.id,
            pickupLat: location.latitude,
            pickupLng: location.longitude,
            dropLat: destination.latitude,
            dropLng: destination.longitude,
            pickupAddress: "Current Location",
            dropAddress: "Selected Destination"
        }, { headers: { Authorization: `Bearer ${userToken}` }});
        
        setActiveBooking({ bookingId: res.data.bookingId, otp: res.data.otp }); 
    } catch (err) {
        setStatus('SELECTING');
        Alert.alert('Error', 'No drivers available.');
    }
  };

  // 🛑 PREVENT NULL CRASH: Don't render MapView until location is ready
  if (loadingLocation || !location) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{color: 'white', marginTop: 10}}>Acquiring GPS...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 🟢 MENU BUTTON */}
      <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate('Profile')}>
        <Ionicons name="menu" size={30} color="black" />
      </TouchableOpacity>

      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={location} // Safe because we checked !location above
        showsUserLocation={true}
        customMapStyle={darkMapStyle}
      >
        {destination && <Marker coordinate={destination} pinColor={colors.primary} />}
        
        {/* 🛣️ DIRECTIONS */}
        {location && destination && (
            <MapViewDirections
                origin={location}
                destination={destination}
                apikey={GOOGLE_API_KEY}
                strokeWidth={4}
                strokeColor={colors.primary}
                onReady={onDirectionsReady}
                mode="DRIVING"
            />
        )}
      </MapView>

      {/* RIDER UI */}
      {userInfo.role === 'rider' && (
        <>
            {status === 'IDLE' && (
                <View style={styles.searchContainer}>
                    <GooglePlacesAutocomplete
                        placeholder="Where to?"
                        onPress={handleDestinationSelect}
                        query={{ key: GOOGLE_API_KEY, language: 'en' }}
                        fetchDetails={true}
                        styles={{
                            textInput: styles.searchInput,
                            listView: { backgroundColor: '#1a1a1a' }
                        }}
                    />
                </View>
            )}

            {(status === 'SELECTING' || status === 'SEARCHING') && (
                <RideRequestPanel 
                    fare={routeInfo.fare}
                    distance={routeInfo.distance}
                    isSearching={status === 'SEARCHING'}
                    onCancel={() => { setStatus('IDLE'); setDestination(null); }}
                    onRequest={requestRide}
                />
            )}
            
            {(status === 'ACCEPTED' || status === 'ONGOING') && activeBooking && (
                <View style={styles.infoCard}>
                     <Text style={styles.infoTitle}>{status === 'ACCEPTED' ? 'Driver Arriving' : 'On Trip'}</Text>
                     {activeBooking.otp && <Text style={styles.otp}>OTP: {activeBooking.otp}</Text>}
                </View>
            )}
        </>
      )}

      {/* DRIVER UI */}
      {userInfo.role === 'driver' && (
        <View style={styles.driverControls}>
            {status === 'IDLE' && (
                <TouchableOpacity 
                    style={[styles.onlineBtn, { backgroundColor: isDriverOnline ? colors.error : colors.success }]}
                    onPress={() => setIsDriverOnline(!isDriverOnline)}
                >
                    <Text style={styles.onlineText}>{isDriverOnline ? 'GO OFFLINE' : 'GO ONLINE'}</Text>
                </TouchableOpacity>
            )}
        </View>
      )}

      <DriverRequestModal 
        visible={!!incomingRequest}
        request={incomingRequest}
        onAccept={() => {/* Call accept API */}}
        onReject={() => setIncomingRequest(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  map: { flex: 1 },
  loading: { flex: 1, justifyContent:'center', alignItems:'center', backgroundColor: 'black' },
  menuBtn: {
      position: 'absolute', top: 50, left: 20, zIndex: 20,
      backgroundColor: 'white', padding: 10, borderRadius: 25, elevation: 5
  },
  searchContainer: { position: 'absolute', top: 100, width: '90%', alignSelf: 'center', zIndex: 10 },
  searchInput: { backgroundColor: '#333', color: 'white', borderRadius: 10 },
  infoCard: { position: 'absolute', bottom: 30, width: '90%', alignSelf: 'center', backgroundColor: '#333', padding: 20, borderRadius: 15 },
  infoTitle: { color: colors.primary, fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  otp: { color: 'white', fontSize: 24, textAlign: 'center', marginTop: 10, letterSpacing: 5 },
  driverControls: { position: 'absolute', bottom: 50, alignSelf: 'center' },
  onlineBtn: { width: 200, padding: 15, borderRadius: 30, alignItems: 'center' },
  onlineText: { color: 'black', fontWeight: 'bold', fontSize: 16 }
});

const darkMapStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#212121" }] },
  { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#212121" }] },
  { "featureType": "administrative", "elementType": "geometry", "stylers": [{ "color": "#757575" }] },
  { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#2c2c2c" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#000000" }] }
];

export default MapScreen;