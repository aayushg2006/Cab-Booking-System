import React, { useEffect, useState, useContext, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert, ActivityIndicator, Image, Keyboard } from 'react-native';
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
import OTPModal from '../components/OTPModal';

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
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [driverLocation, setDriverLocation] = useState(null);
  const [loadingLocation, setLoadingLocation] = useState(true);

  // 1. 📍 Get My Location
  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setLoadingLocation(false);
          return;
        }
        
        let loc = await Location.getCurrentPositionAsync({});
        const currentLoc = { 
            latitude: loc.coords.latitude, 
            longitude: loc.coords.longitude, 
            latitudeDelta: 0.015, 
            longitudeDelta: 0.0121 
        };
        setLocation(currentLoc);
        setLoadingLocation(false);

        if (userInfo.role === 'driver' && isDriverOnline && socket && socket.connected) {
            const dId = userInfo.driverId || userInfo.id;
            socket.emit('driverLocation', { driverId: dId, lat: loc.coords.latitude, lng: loc.coords.longitude });
        }
      } catch (err) {
          console.log("Loc Error:", err);
          setLoadingLocation(false);
      }
    })();
  }, [isDriverOnline, userInfo, socket]);

  // 2. ⚡ Socket Listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('rideAccepted', (data) => {
        setStatus('ACCEPTED');
        setActiveBooking(prev => ({ ...prev, ...data })); 
        if (userInfo.role === 'rider') {
             Alert.alert("Ride Accepted", `${data.driverName || 'Driver'} is on the way!`);
        }
    });

    socket.on('driverMoved', (data) => {
        if (activeBooking && activeBooking.driverId == data.driverId) {
            setDriverLocation({ latitude: data.lat, longitude: data.lng });
        }
    });

    socket.on('rideStarted', () => {
        console.log("⚡ Socket: Ride Started");
        setShowOtpModal(false);
        // Delay status update slightly to let modal close
        setTimeout(() => {
            setStatus('ONGOING');
            Alert.alert("Ride Started", "Have a safe trip!");
        }, 300);
    });

    socket.on('rideCompleted', ({ fare }) => {
        setStatus('COMPLETED');
        Alert.alert('Ride Completed', `Total Fare: ₹${fare}`);
        navigation.navigate('Payment', { fare, bookingId: activeBooking?.bookingId });
        setStatus('IDLE');
        setDestination(null);
        setActiveBooking(null);
        setDriverLocation(null);
    });

    socket.on('newRideRequest', (data) => {
        setIncomingRequest(data);
    });

    return () => socket.removeAllListeners();
  }, [socket, activeBooking]);

  // --- ACTIONS ---

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
            dropAddress: "Destination",
            fare: routeInfo.fare
        }, { headers: { Authorization: `Bearer ${userToken}` }});
        
        setActiveBooking({ bookingId: res.data.bookingId, otp: res.data.otp }); 
    } catch (err) {
        setStatus('SELECTING');
        Alert.alert('Booking Failed', err.response?.data?.message || 'No drivers available.');
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

  const startRide = async (otpInput) => {
      // 🛡️ CRASH FIX: Ensure activeBooking exists
      if (!activeBooking || !activeBooking.bookingId) {
          Alert.alert("Error", "Booking information missing.");
          return;
      }

      try {
        console.log("🚀 Calling API to Start Ride...");
        await client.post('/bookings/start', { 
            bookingId: activeBooking.bookingId, 
            otp: otpInput 
        }, { headers: { Authorization: `Bearer ${userToken}` }});
        
        // Success! Wait for socket to update status
      } catch(e) { 
          console.log("❌ Start Error:", e.response?.data);
          const msg = e.response?.data?.error || "Connection Error";
          Alert.alert("Start Failed", msg);
          throw e; // Rethrow to keep modal open/loading state correct
      }
  };

  const endRide = async () => {
      if (!activeBooking) return;
      try {
          await client.post('/bookings/end', { bookingId: activeBooking.bookingId }, 
          { headers: { Authorization: `Bearer ${userToken}` }});
      } catch (e) {
          Alert.alert("Error", "Could not end ride.");
      }
  };

  const onDirectionsReady = (result) => {
      const price = Math.round(50 + (result.distance * 15)); 
      setRouteInfo({ distance: result.distance.toFixed(1), fare: price });
  };

  if (loadingLocation || !location) return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;

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
        {driverLocation && (
            <Marker coordinate={driverLocation} title="Your Driver">
                <View style={styles.carMarker}><Ionicons name="car-sport" size={24} color="black" /></View>
            </Marker>
        )}
        {destination && GOOGLE_API_KEY && (
            <MapViewDirections
                origin={location}
                destination={destination}
                apikey={GOOGLE_API_KEY}
                strokeWidth={4}
                strokeColor={colors.primary}
                onReady={onDirectionsReady}
                onError={() => {}}
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
                        onPress={(data, details = null) => {
                            if (!details) return;
                            setDestination({ latitude: details.geometry.location.lat, longitude: details.geometry.location.lng });
                            setStatus('SELECTING');
                            Keyboard.dismiss();
                        }}
                        query={{ key: GOOGLE_API_KEY, language: 'en' }}
                        fetchDetails={true}
                        styles={{ 
                            textInput: styles.searchInput, 
                            container: { flex: 0 },
                            listView: { backgroundColor: '#1a1a1a', zIndex: 1000 },
                            row: { backgroundColor: '#1a1a1a' },
                            description: { color: 'white' },
                            predefinedPlacesDescription: { color: '#1faadb' },
                        }}
                        enablePoweredByContainer={false}
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
                <View style={styles.driverInfoCard}>
                     <View style={styles.driverHeader}>
                        <View style={styles.avatar}><Text style={{fontSize:20}}>🚘</Text></View>
                        <View style={{marginLeft: 15}}>
                            <Text style={styles.driverName}>{activeBooking.driverName || 'Driver'}</Text>
                            <Text style={styles.carInfo}>{activeBooking.carModel || 'Car'} • {activeBooking.carPlate || '...'}</Text>
                            <Text style={styles.rating}>⭐ {activeBooking.rating || '5.0'}</Text>
                        </View>
                     </View>
                     <View style={styles.divider} />
                     <View style={styles.otpBox}>
                        <Text style={styles.otpLabel}>OTP PIN</Text>
                        <Text style={styles.otpCode}>{activeBooking.otp}</Text>
                     </View>
                     <Text style={styles.statusText}>{status === 'ACCEPTED' ? 'Driver is arriving...' : 'Ride in Progress'}</Text>
                </View>
            )}
        </>
      )}

      {/* DRIVER UI */}
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
                <TouchableOpacity style={styles.actionBtn} onPress={() => setShowOtpModal(true)}>
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

            <OTPModal 
                visible={showOtpModal}
                onSubmit={startRide}
                onCancel={() => setShowOtpModal(false)}
            />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  map: { flex: 1 },
  loading: { flex: 1, justifyContent:'center', alignItems:'center', backgroundColor:'black' },
  menuBtn: { position: 'absolute', top: 50, left: 20, zIndex: 20, backgroundColor: 'white', padding: 10, borderRadius: 25, elevation: 5 },
  searchContainer: { position: 'absolute', top: 100, width: '90%', alignSelf: 'center', zIndex: 10 },
  searchInput: { backgroundColor: '#333', color: 'white', borderRadius: 10, paddingHorizontal: 10 },
  driverInfoCard: { position: 'absolute', bottom: 30, width: '90%', alignSelf: 'center', backgroundColor: '#1a1a1a', padding: 20, borderRadius: 15, borderWidth: 1, borderColor: '#333', shadowColor:'#000', elevation:10 },
  driverHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center' },
  driverName: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  carInfo: { color: '#888', fontSize: 14, marginTop: 2 },
  rating: { color: '#FFD700', fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: '#333', marginVertical: 15 },
  otpBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#333', padding: 10, borderRadius: 8 },
  otpLabel: { color: '#888', fontWeight: 'bold' },
  otpCode: { color: colors.primary, fontSize: 24, fontWeight: 'bold', letterSpacing: 5 },
  statusText: { color: colors.success, textAlign: 'center', marginTop: 15, fontStyle: 'italic' },
  driverControls: { position: 'absolute', bottom: 50, alignSelf: 'center' },
  onlineBtn: { width: 200, padding: 15, borderRadius: 30, alignItems: 'center', shadowColor:'black', elevation:5 },
  onlineText: { color: 'black', fontWeight: 'bold', fontSize: 16 },
  actionBtn: { position: 'absolute', bottom: 50, alignSelf: 'center', width: '90%', backgroundColor: colors.primary, padding: 20, borderRadius: 10, alignItems: 'center', elevation: 10 },
  actionText: { color: 'black', fontWeight: '900', fontSize: 18 },
  carMarker: { backgroundColor: 'white', padding: 5, borderRadius: 15, elevation: 5 }
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