// frontend/src/screens/MapScreen.js
import React, { useEffect, useState, useContext, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
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

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

const MapScreen = ({ navigation }) => {
  const { userInfo, userToken } = useContext(AuthContext);
  const { socket } = useContext(SocketContext);
  const mapRef = useRef(null);

  const [location, setLocation] = useState(null); 
  const [destination, setDestination] = useState(null);
  const [routeInfo, setRouteInfo] = useState({ distance: 0, fare: 0 });
  const [status, setStatus] = useState('IDLE'); 
  const [activeBooking, setActiveBooking] = useState(null);
  const [isDriverOnline, setIsDriverOnline] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [loadingLocation, setLoadingLocation] = useState(true);

  // 1. 📍 Get Location & Update Driver Status
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

        // 🛠 FIX: Ensure we emit the correct driverId
        if (userInfo.role === 'driver' && isDriverOnline && socket) {
            const dId = userInfo.driverId || userInfo.id; // Fallback to ID
            console.log("📡 Going Online: Driver", dId);
            socket.emit('driverLocation', { driverId: dId, ...currentLoc });
        }
      } catch (error) {
        console.log("Error getting location:", error);
        setLoadingLocation(false);
      }
    })();
  }, [isDriverOnline]);

  // 2. ⚡ Socket Listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('rideAccepted', (data) => {
        setStatus('ACCEPTED');
        setActiveBooking(prev => ({ ...prev, ...data }));
        Alert.alert("Ride Accepted", "Driver is on the way!");
    });

    socket.on('rideStarted', () => {
        setStatus('ONGOING');
        Alert.alert("Ride Started", "Have a safe trip!");
    });

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

  // --- 🛠️ TEST HELPER ---
  const simulateDestination = () => {
      if (!location) return;
      const mockDest = {
          latitude: location.latitude + 0.005, 
          longitude: location.longitude + 0.005
      };
      setDestination(mockDest);
      setStatus('SELECTING');
      setRouteInfo({ distance: '2.5', fare: '12.50' });
      mapRef.current.fitToCoordinates([location, mockDest], {
          edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
          animated: true,
      });
  };

  const handleDestinationSelect = (data, details = null) => {
    if (!details) return;
    const destLoc = { 
        latitude: details.geometry.location.lat, 
        longitude: details.geometry.location.lng 
    };
    setDestination(destLoc);
    setStatus('SELECTING');
    if(location) {
        mapRef.current.fitToCoordinates([location, destLoc], {
            edgePadding: { top: 100, right: 50, bottom: 300, left: 50 },
            animated: true,
        });
    }
  };

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
            pickupAddress: "My Location",
            dropAddress: "Destination"
        }, { headers: { Authorization: `Bearer ${userToken}` }});
        
        setActiveBooking({ bookingId: res.data.bookingId, otp: res.data.otp }); 
    } catch (err) {
        setStatus('SELECTING');
        Alert.alert('Booking Failed', err.response?.data?.message || 'No drivers available nearby.');
    }
  };

  const acceptRide = async () => {
    if (!incomingRequest) return;
    try {
        const dId = userInfo.driverId || userInfo.id;
        await client.post('/bookings/accept', {
            bookingId: incomingRequest.bookingId,
            driverId: dId
        }, { headers: { Authorization: `Bearer ${userToken}` }});
        
        setStatus('ACCEPTED');
        setActiveBooking(incomingRequest);
        setIncomingRequest(null);
    } catch (err) {
        Alert.alert('Error', 'Could not accept ride.');
    }
  };

  const startRide = () => {
     Alert.alert("Enter OTP", "Ask rider for code:", [
         { text: "Cancel", style: "cancel" },
         { text: "Submit", onPress: async () => {
             const demoOtp = activeBooking?.otp || "1234"; 
             try {
                await client.post('/bookings/start', { bookingId: activeBooking.bookingId, otp: demoOtp }, 
                { headers: { Authorization: `Bearer ${userToken}` }});
                setStatus('ONGOING');
             } catch(e) { Alert.alert("Invalid OTP"); }
         }}
     ]); 
  };

  const endRide = async () => {
      await client.post('/bookings/end', { bookingId: activeBooking.bookingId }, 
      { headers: { Authorization: `Bearer ${userToken}` }});
  };

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
      <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate('Profile')}>
        <Ionicons name="menu" size={30} color="black" />
      </TouchableOpacity>

      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={location}
        showsUserLocation={true}
        customMapStyle={darkMapStyle}
      >
        {destination && <Marker coordinate={destination} pinColor={colors.primary} />}
        {destination && GOOGLE_API_KEY ? (
            <MapViewDirections
                origin={location}
                destination={destination}
                apikey={GOOGLE_API_KEY}
                strokeWidth={4}
                strokeColor={colors.primary}
                onReady={onDirectionsReady}
            />
        ) : (
            destination && <Polyline coordinates={[location, destination]} strokeColor={colors.primary} strokeWidth={4} />
        )}
      </MapView>

      {userInfo.role === 'rider' && (
        <>
            {status === 'IDLE' && (
                <View style={styles.searchContainer}>
                    {/* Real Search */}
                    <View style={{height: 50}}>
                        <GooglePlacesAutocomplete
                            placeholder="Where to?"
                            onPress={handleDestinationSelect}
                            query={{ key: GOOGLE_API_KEY, language: 'en' }}
                            fetchDetails={true}
                            styles={{ textInput: styles.searchInput, listView: { backgroundColor: '#1a1a1a' } }}
                        />
                    </View>
                    {/* Fallback Simulation Button */}
                    <TouchableOpacity style={styles.testBtn} onPress={simulateDestination}>
                        <Text style={styles.testText}>📍 CLICK TO SIMULATE DESTINATION</Text>
                    </TouchableOpacity>
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

      {userInfo.role === 'driver' && (
        <>
            {status === 'IDLE' && (
                <View style={styles.driverControls}>
                    <TouchableOpacity 
                        style={[styles.onlineBtn, { backgroundColor: isDriverOnline ? colors.error : colors.success }]}
                        onPress={() => setIsDriverOnline(!isDriverOnline)}
                    >
                        <Text style={styles.onlineText}>{isDriverOnline ? 'GO OFFLINE' : 'GO ONLINE'}</Text>
                    </TouchableOpacity>
                </View>
            )}
            
            {status === 'ACCEPTED' && (
                <TouchableOpacity style={styles.actionBtn} onPress={startRide}>
                    <Text style={styles.actionText}>START RIDE</Text>
                </TouchableOpacity>
            )}
            {status === 'ONGOING' && (
                <TouchableOpacity style={[styles.actionBtn, {backgroundColor: colors.error}]} onPress={endRide}>
                    <Text style={styles.actionText}>END RIDE</Text>
                </TouchableOpacity>
            )}

            <DriverRequestModal 
                visible={!!incomingRequest}
                request={incomingRequest}
                onAccept={acceptRide}
                onReject={() => setIncomingRequest(null)}
            />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  map: { flex: 1 },
  loading: { flex: 1, justifyContent:'center', alignItems:'center', backgroundColor: 'black' },
  menuBtn: { position: 'absolute', top: 50, left: 20, zIndex: 20, backgroundColor: 'white', padding: 10, borderRadius: 25, elevation: 5 },
  searchContainer: { position: 'absolute', top: 100, width: '90%', alignSelf: 'center', zIndex: 10 },
  searchInput: { backgroundColor: '#333', color: 'white', borderRadius: 10, paddingHorizontal: 10 },
  testBtn: { marginTop: 10, backgroundColor: colors.primary, padding: 10, borderRadius: 8, alignItems: 'center' },
  testText: { fontWeight: 'bold', fontSize: 12 },
  infoCard: { position: 'absolute', bottom: 30, width: '90%', alignSelf: 'center', backgroundColor: '#333', padding: 20, borderRadius: 15, alignItems: 'center' },
  infoTitle: { color: colors.primary, fontSize: 18, fontWeight: 'bold' },
  otp: { color: 'white', fontSize: 24, marginTop: 10, letterSpacing: 5, fontWeight: 'bold' },
  driverControls: { position: 'absolute', bottom: 50, alignSelf: 'center' },
  onlineBtn: { width: 200, padding: 15, borderRadius: 30, alignItems: 'center', shadowColor:'black', elevation:5 },
  onlineText: { color: 'black', fontWeight: 'bold', fontSize: 16 },
  actionBtn: { position: 'absolute', bottom: 50, alignSelf: 'center', width: '90%', backgroundColor: colors.primary, padding: 20, borderRadius: 10, alignItems: 'center' },
  actionText: { color: 'black', fontWeight: '900', fontSize: 18 }
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