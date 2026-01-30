import React, { useEffect, useState, useContext, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert, ActivityIndicator, Image, Keyboard, Linking, Platform, AppState } from 'react-native';
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
  const appState = useRef(AppState.currentState);

  // Locations & Addresses
  const [location, setLocation] = useState(null); 
  const [destination, setDestination] = useState(null);
  const [pickupAddr, setPickupAddr] = useState("My Location");
  const [dropAddr, setDropAddr] = useState("");
  const [isAddressLoading, setIsAddressLoading] = useState(false);

  // UI & Flow
  const [routeInfo, setRouteInfo] = useState({ distance: 0, fare: 0, duration: 0 });
  const [status, setStatus] = useState('IDLE'); 
  const [isPinning, setIsPinning] = useState(false); 
  const [pinType, setPinType] = useState('pickup'); // 'pickup' or 'drop'

  // Booking & Driver
  const [activeBooking, setActiveBooking] = useState(null);
  const [isDriverOnline, setIsDriverOnline] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [driverLocation, setDriverLocation] = useState(null); 
  const [loadingLocation, setLoadingLocation] = useState(true);

  // 🛠️ 1. Continuous Location Tracking
  useEffect(() => {
    let subscription = null;

    const startTracking = async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLoadingLocation(false);
        return;
      }

      let loc = await Location.getCurrentPositionAsync({});
      setLocation({ 
          latitude: loc.coords.latitude, 
          longitude: loc.coords.longitude, 
          latitudeDelta: 0.005, 
          longitudeDelta: 0.005 
      });
      setLoadingLocation(false);

      subscription = await Location.watchPositionAsync(
        { 
            accuracy: Location.Accuracy.High, 
            timeInterval: 5000, 
            distanceInterval: 10 
        }, 
        (newLoc) => {
            const { latitude, longitude } = newLoc.coords;
            
            if (userInfo.role === 'driver' && isDriverOnline && socket?.connected) {
                const dId = userInfo.driverId || userInfo.id;
                socket.emit('driverLocation', { driverId: dId, lat: latitude, lng: longitude });
            }
        }
      );
    };

    startTracking();
    return () => { if (subscription) subscription.remove(); };
  }, [isDriverOnline, userInfo, socket]);

  // 🛠️ 2. App State Listener
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        if (userInfo.role === 'driver' && isDriverOnline && socket) {
            socket.connect(); 
        }
      }
      appState.current = nextAppState;
    });
    return () => subscription.remove();
  }, [isDriverOnline, socket]);

  // 3. Socket Listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('rideAccepted', (data) => {
        setStatus('ACCEPTED');
        setActiveBooking(prev => ({ ...prev, ...data })); 
        if (userInfo.role === 'rider') Alert.alert("Ride Accepted", `${data.driverName} is on the way!`);
    });

    socket.on('driverMoved', (data) => {
        // 🔒 FIX: Only update if the moving driver is YOUR driver
        if (userInfo.role === 'rider' && activeBooking && activeBooking.driverId === data.driverId) {
             setDriverLocation({ latitude: data.lat, longitude: data.lng });
        }
    });

    socket.on('rideStarted', () => {
        setShowOtpModal(false);
        setTimeout(() => {
            setStatus('ONGOING');
            if (userInfo.role === 'rider') Alert.alert("Ride Started", "Have a safe trip!");
        }, 500); 
    });

    socket.on('rideCompleted', ({ fare }) => {
        setStatus('COMPLETED');
        if (userInfo.role === 'rider') {
            Alert.alert('Ride Completed', `Total Fare: ₹${fare}`);
            navigation.navigate('Payment', { fare, bookingId: activeBooking?.bookingId });
        } else {
            Alert.alert('Ride Ended', `Collect ₹${fare} from the rider.`);
            setStatus('IDLE'); 
        }
        setDestination(null);
        setActiveBooking(null);
        setDriverLocation(null);
    });

    socket.on('newRideRequest', (data) => setIncomingRequest(data));

    return () => socket.removeAllListeners();
  }, [socket, activeBooking, status]);

  // --- MAP PIN LOGIC (With Async Address Fix) ---
  const handleRegionChangeComplete = async (region) => {
      if (isPinning) {
          // 1. Set Coords Immediately
          if (pinType === 'pickup') {
              setLocation({ ...region, latitudeDelta: 0.005, longitudeDelta: 0.005 });
          } else {
              setDestination({ latitude: region.latitude, longitude: region.longitude });
          }

          // 2. Fetch Address (with Loading State)
          setIsAddressLoading(true); 
          try {
              let address = await Location.reverseGeocodeAsync({ latitude: region.latitude, longitude: region.longitude });
              if(address[0]) {
                  const addrStr = `${address[0].name || ''}, ${address[0].city || ''}`;
                  // Remove starting/trailing commas just in case
                  const cleanAddr = addrStr.replace(/^, |, $/g, '');
                  
                  if (pinType === 'pickup') setPickupAddr(cleanAddr);
                  else setDropAddr(cleanAddr);
              }
          } catch(e) { 
              // Keep default text on failure
          } finally {
              setIsAddressLoading(false); 
          }
      }
  };

  const confirmPinSelection = () => {
      setIsPinning(false);
      if (pinType === 'drop') setStatus('SELECTING');
  };

  // --- ACTIONS ---

  const requestRide = async (carType, calculatedFare) => {
    if (!destination || !destination.latitude || !destination.longitude) {
        return Alert.alert("Error", "Please select a valid destination.");
    }

    setStatus('SEARCHING');
    try {
        const res = await client.post('/bookings/request', {
            riderId: userInfo.id,
            pickupLat: location.latitude,
            pickupLng: location.longitude,
            dropLat: destination.latitude,
            dropLng: destination.longitude,
            pickupAddress: pickupAddr, 
            dropAddress: dropAddr,     
            fare: calculatedFare,
            carType: carType
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
        await client.post('/bookings/accept', { bookingId: incomingRequest.bookingId, driverId: dId }, 
        { headers: { Authorization: `Bearer ${userToken}` }});
        
        setStatus('ACCEPTED');
        setActiveBooking(incomingRequest);
        setIncomingRequest(null);
        
        Alert.alert("Navigate", "Open Maps to Pickup?", [
            { text: "No" },
            { text: "Yes", onPress: () => openExternalMap(incomingRequest.pickupLat, incomingRequest.pickupLng) }
        ]);
    } catch (err) { Alert.alert('Error', 'Could not accept ride.'); }
  };

  const startRide = async (otpInput) => {
      if (!activeBooking) return;
      try {
        setShowOtpModal(false); 
        await client.post('/bookings/start', { bookingId: activeBooking.bookingId, otp: otpInput }, 
        { headers: { Authorization: `Bearer ${userToken}` }});
      } catch(e) { setShowOtpModal(true); Alert.alert("Invalid OTP"); }
  };

  const endRide = async () => {
      if (!activeBooking) return;
      try {
          let endLoc = location; 
          let loc = await Location.getCurrentPositionAsync({});
          endLoc = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };

          await client.post('/bookings/end', { 
              bookingId: activeBooking.bookingId,
              dropLat: endLoc.latitude,
              dropLng: endLoc.longitude
          }, { headers: { Authorization: `Bearer ${userToken}` }});
      } catch (e) { Alert.alert("Error", "Could not end ride."); }
  };

  const openExternalMap = (lat, lng) => {
    const url = Platform.select({
      ios: `maps:0,0?q=${lat},${lng}`,
      android: `geo:0,0?q=${lat},${lng}`
    });
    Linking.openURL(url);
  };

  const onDirectionsReady = (result) => {
      const price = Math.round(50 + (result.distance * 15)); 
      setRouteInfo({ distance: result.distance.toFixed(1), fare: price, duration: result.duration.toFixed(0) });
  };

  // 🚀 REJECTION LOGIC
  const rejectRide = () => {
      if (!incomingRequest) return;
      
      const dId = userInfo.driverId || userInfo.id;
      console.log("Declining Ride...");
      
      // Emit 'declineRide' so the server can find the next driver
      socket.emit('declineRide', { 
          bookingId: incomingRequest.bookingId, 
          driverId: dId 
      });

      setIncomingRequest(null); // Hide modal locally
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
        showsUserLocation={!isPinning}
        customMapStyle={darkMapStyle}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {!isPinning && destination && <Marker coordinate={destination} pinColor={colors.primary} />}
        
        {/* 🚗 Driver Marker (Filtered) */}
        {!isPinning && driverLocation && (
            <Marker coordinate={driverLocation} title="Your Driver">
                <View style={styles.carMarker}><Ionicons name="car-sport" size={24} color="black" /></View>
            </Marker>
        )}
        
        {!isPinning && destination && GOOGLE_API_KEY && (
            <MapViewDirections origin={location} destination={destination} apikey={GOOGLE_API_KEY} strokeWidth={4} strokeColor={colors.primary} onReady={onDirectionsReady} />
        )}
      </MapView>

      {/* 📍 PIN UI */}
      {isPinning && (
          <View style={styles.centerPinContainer} pointerEvents="none">
              <Ionicons name="location" size={40} color={colors.primary} />
          </View>
      )}

      {/* --- RIDER UI --- */}
      {userInfo.role === 'rider' && (
        <>
            {status === 'IDLE' && !isPinning && (
                <View style={styles.searchContainer}>
                    <GooglePlacesAutocomplete
                        placeholder="Where to?"
                        onPress={(data, details = null) => {
                            if (!details) return;
                            setDestination({ latitude: details.geometry.location.lat, longitude: details.geometry.location.lng });
                            setDropAddr(data.description); 
                            setStatus('SELECTING');
                            Keyboard.dismiss();
                        }}
                        query={{ key: GOOGLE_API_KEY, language: 'en' }}
                        fetchDetails={true}
                        styles={{ 
                            textInput: styles.searchInput, 
                            listView: { backgroundColor: '#1a1a1a', zIndex: 1000 },
                            description: { color: 'white' }
                        }}
                        enablePoweredByContainer={false}
                    />
                    
                    <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 10}}>
                        <TouchableOpacity style={styles.pinBtn} onPress={() => { setIsPinning(true); setPinType('drop'); }}>
                            <Ionicons name="map" size={20} color="white" />
                            <Text style={styles.pinText}> Set on Map</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {isPinning && (
                <TouchableOpacity 
                    style={[styles.confirmPinBtn, { opacity: isAddressLoading ? 0.6 : 1 }]} 
                    onPress={confirmPinSelection}
                    disabled={isAddressLoading} 
                >
                    {isAddressLoading ? (
                        <ActivityIndicator color="black" />
                    ) : (
                        <Text style={styles.confirmPinText}>CONFIRM {pinType.toUpperCase()}</Text>
                    )}
                </TouchableOpacity>
            )}

            {(status === 'SELECTING' || status === 'SEARCHING') && (
                <RideRequestPanel 
                    fare={routeInfo.fare}
                    distance={routeInfo.distance}
                    duration={routeInfo.duration}
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
                            <Text style={styles.carInfo}>{activeBooking.carModel}</Text>
                            <Text style={styles.rating}>⭐ 5.0</Text>
                        </View>
                     </View>
                     <View style={styles.divider} />
                     <View style={styles.otpBox}>
                        <Text style={styles.otpLabel}>OTP PIN</Text>
                        <Text style={styles.otpCode}>{activeBooking.otp}</Text>
                     </View>
                     <Text style={styles.statusText}>
                        {status === 'ACCEPTED' ? `Driver arriving in ~${routeInfo.duration} min` : 'Ride in Progress'}
                     </Text>
                </View>
            )}
        </>
      )}

      {/* --- DRIVER UI --- */}
      {userInfo.role === 'driver' && (
        <>
            {status === 'IDLE' && (
                <View style={styles.driverControls}>
                    <TouchableOpacity style={[styles.onlineBtn, { backgroundColor: isDriverOnline ? colors.error : colors.success }]} onPress={() => setIsDriverOnline(!isDriverOnline)}>
                        <Text style={styles.onlineText}>{isDriverOnline ? 'GO OFFLINE' : 'GO ONLINE'}</Text>
                    </TouchableOpacity>
                </View>
            )}
            
            {status === 'ACCEPTED' && (
                <View style={styles.driverControls}>
                    <TouchableOpacity style={styles.navBtn} onPress={() => openExternalMap(activeBooking.pickupLat, activeBooking.pickupLng)}>
                        <Ionicons name="navigate" size={24} color="white" />
                        <Text style={styles.navText}>Pickup Nav</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => setShowOtpModal(true)}>
                        <Text style={styles.actionText}>START RIDE</Text>
                    </TouchableOpacity>
                </View>
            )}

            {status === 'ONGOING' && (
                <View style={styles.driverControls}>
                    <TouchableOpacity style={styles.navBtn} onPress={() => openExternalMap(activeBooking.dropLat, activeBooking.dropLng)}>
                        <Ionicons name="navigate" size={24} color="white" />
                        <Text style={styles.navText}>Drop Nav</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, {backgroundColor: colors.error}]} onPress={endRide}>
                        <Text style={styles.actionText}>END RIDE</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* 🚀 UPGRADE: Pass rejectRide to onReject */}
            <DriverRequestModal 
                visible={!!incomingRequest} 
                request={incomingRequest} 
                onAccept={acceptRide} 
                onReject={rejectRide} 
            />
            <OTPModal visible={showOtpModal} onSubmit={startRide} onCancel={() => setShowOtpModal(false)} />
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
  
  pinBtn: { backgroundColor: '#444', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', flex:1, marginHorizontal:5, justifyContent:'center' },
  pinText: { color: 'white', fontSize: 12, fontWeight: 'bold' },
  
  centerPinContainer: { position: 'absolute', top: '50%', left: '50%', marginTop: -35, marginLeft: -20, zIndex: 20 },
  confirmPinBtn: { position: 'absolute', bottom: 50, width: '80%', alignSelf: 'center', backgroundColor: colors.primary, padding: 15, borderRadius: 10, alignItems: 'center', zIndex:20 },
  confirmPinText: { color: 'black', fontWeight: 'bold', fontSize: 16 },

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
  
  driverControls: { position: 'absolute', bottom: 50, alignSelf: 'center', width: '100%', alignItems:'center' },
  onlineBtn: { width: 200, padding: 15, borderRadius: 30, alignItems: 'center', shadowColor:'black', elevation:5 },
  onlineText: { color: 'black', fontWeight: 'bold', fontSize: 16 },
  actionBtn: { width: '80%', backgroundColor: colors.primary, padding: 20, borderRadius: 10, alignItems: 'center', elevation: 10, marginBottom: 10 },
  actionText: { color: 'black', fontWeight: '900', fontSize: 18 },
  navBtn: { flexDirection:'row', backgroundColor: '#4285F4', padding: 12, borderRadius: 25, alignItems: 'center', justifyContent:'center', marginBottom: 15, width: 140 },
  navText: { color: 'white', fontWeight: 'bold', marginLeft: 5 },
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