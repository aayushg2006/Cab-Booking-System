import React, { useEffect, useState, useContext, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert, ActivityIndicator, Keyboard, Linking, Platform, AppState } from 'react-native';
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
import OTPModal from '../components/OTPModal';
import RatingModal from '../components/RatingModal';

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

const MapScreen = ({ navigation, route }) => {
  const { userInfo, userToken } = useContext(AuthContext);
  const { socket } = useContext(SocketContext);
  const mapRef = useRef(null);
  const appState = useRef(AppState.currentState);

  // Locations
  const [location, setLocation] = useState(null); 
  const [destination, setDestination] = useState(null);
  const [pickupAddr, setPickupAddr] = useState("My Location");
  const [dropAddr, setDropAddr] = useState("");
  const [isAddressLoading, setIsAddressLoading] = useState(false);

  // UI & Flow
  const [routeInfo, setRouteInfo] = useState({ distance: 0, fare: 0, duration: 0 });
  const [status, setStatus] = useState('IDLE'); 
  const [isPinning, setIsPinning] = useState(false); 
  const [pinType, setPinType] = useState('pickup'); 
  const [paymentMode, setPaymentMode] = useState('cash'); 
  const [showRatingModal, setShowRatingModal] = useState(false);

  // Loading States
  const [isRouting, setIsRouting] = useState(false); 
  const [isEstimating, setIsEstimating] = useState(false);

  // Booking
  const [activeBooking, setActiveBooking] = useState(null);
  const [isDriverOnline, setIsDriverOnline] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(null);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [driverLocation, setDriverLocation] = useState(null); 
  const [loadingLocation, setLoadingLocation] = useState(true);

  // 🔄 RECONNECTION LOGIC (Fixes Driver Disconnect)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        console.log("⚡ App in Foreground: Reconnecting Socket...");
        if (socket && !socket.connected) socket.connect();
        
        // Force update driver location immediately so server knows we are back
        if (userInfo.role === 'driver' && isDriverOnline && location) {
            socket.emit('driverLocation', { 
                driverId: userInfo.driverId || userInfo.id, 
                lat: location.latitude, 
                lng: location.longitude 
            });
        }
      }
      appState.current = nextAppState;
    });
    return () => subscription.remove();
  }, [isDriverOnline, socket, location]);

  // Socket Listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('rideAccepted', (data) => {
        setStatus('ACCEPTED');
        // Store OTP and Driver info
        setActiveBooking(prev => ({ ...prev, ...data })); 
        if (userInfo.role === 'rider') Alert.alert("Ride Accepted", `${data.driverName} is on the way!`);
    });

    socket.on('driverMoved', (data) => {
        // Only update if it's OUR driver
        if (userInfo.role === 'rider' && activeBooking && activeBooking.driverId === data.driverId) {
             setDriverLocation({ latitude: data.lat, longitude: data.lng });
        }
    });

    socket.on('rideStarted', () => {
        setShowOtpModal(false);
        setStatus('ONGOING'); // UI switches to drop view
        if (userInfo.role === 'rider') Alert.alert("Ride Started", "Have a safe trip!");
    });

    socket.on('rideCompleted', ({ fare }) => {
        setStatus('COMPLETED');
        if (userInfo.role === 'rider') {
            Alert.alert('Ride Completed', `Total Fare: ₹${fare}`);
            navigation.navigate('Payment', { fare, bookingId: activeBooking?.bookingId, paymentMode: activeBooking?.paymentMode });
        } else {
            Alert.alert('Ride Ended', `Collect ₹${fare} from the rider.`);
            setStatus('IDLE'); 
        }
        setDestination(null);
        setDriverLocation(null);
    });

    socket.on('newRideRequest', (data) => setIncomingRequest(data));
    socket.on('requestTimeout', () => {
        Alert.alert("Missed", "You missed the ride request.");
        setIncomingRequest(null);
    });

    return () => socket.removeAllListeners();
  }, [socket, activeBooking, status]);

  // Location Tracking
  useEffect(() => {
    let subscription = null;
    const startTracking = async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLoadingLocation(false); return; }
      
      let loc = await Location.getCurrentPositionAsync({});
      setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 });
      setLoadingLocation(false);

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 }, 
        (newLoc) => {
            const { latitude, longitude } = newLoc.coords;
            setLocation(prev => ({ ...prev, latitude, longitude })); // Update local state
            
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

  // --- 🗺️ SMART ROUTING LOGIC ---
  const getRoutingPoints = () => {
      // 1. Waiting for Driver (Show Driver -> Pickup)
      if (status === 'ACCEPTED' && driverLocation && location) {
          return { origin: driverLocation, dest: location, mode: 'pickup' };
      }
      // 2. In Cab (Show Driver/Current -> Drop)
      if (status === 'ONGOING' && (driverLocation || location) && destination) {
          // If rider, use driverLocation (more accurate). If driver, use own location.
          const startPoint = userInfo.role === 'rider' ? driverLocation : location;
          return { origin: startPoint, dest: destination, mode: 'drop' };
      }
      // 3. Booking Phase (Show Pickup -> Drop)
      if ((status === 'SELECTING' || status === 'SEARCHING') && location && destination) {
          return { origin: location, dest: destination, mode: 'estimate' };
      }
      return null;
  };

  const dynamicRoute = getRoutingPoints();

  // Directions Ready Handler
  const onDirectionsReady = async (result) => {
      setIsRouting(false); 
      
      // Only calculate price if we are in ESTIMATE mode
      if (dynamicRoute?.mode === 'estimate') {
          setIsEstimating(true);
          try {
              const res = await client.post('/bookings/estimate', {
                  pickupLat: location.latitude, pickupLng: location.longitude,
                  dropLat: destination.latitude, dropLng: destination.longitude
              }, { headers: { Authorization: `Bearer ${userToken}` }});

              setRouteInfo({ distance: res.data.distance, fare: res.data.fare, duration: res.data.duration });
              if (res.data.surge > 1.0) Alert.alert("⚡ High Demand", `Fares are higher (${res.data.surge}x) due to traffic.`);
          } catch (err) {
              const price = Math.round(50 + (result.distance * 15)); 
              setRouteInfo({ distance: result.distance.toFixed(1), fare: price, duration: result.duration.toFixed(0) });
          } finally { setIsEstimating(false); }
      } else {
          // Just update time/dist for live tracking (No fare recalc)
          setRouteInfo(prev => ({ ...prev, distance: result.distance.toFixed(1), duration: result.duration.toFixed(0) }));
      }
  };

  // --- ACTIONS ---
  const requestRide = async (carType) => {
    if (!destination) return Alert.alert("Error", "Please select a valid destination.");
    setStatus('SEARCHING');
    try {
        const res = await client.post('/bookings/request', {
            riderId: userInfo.id, pickupLat: location.latitude, pickupLng: location.longitude,
            dropLat: destination.latitude, dropLng: destination.longitude,
            pickupAddress: pickupAddr, dropAddress: dropAddr, fare: routeInfo.fare, 
            carType: carType, paymentMode: paymentMode
        }, { headers: { Authorization: `Bearer ${userToken}` }});
        
        setActiveBooking({ bookingId: res.data.bookingId, otp: res.data.otp, paymentMode }); 
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
          await client.post('/bookings/end', { bookingId: activeBooking.bookingId, dropLat: location.latitude, dropLng: location.longitude }, { headers: { Authorization: `Bearer ${userToken}` }});
      } catch (e) { Alert.alert("Error", "Could not end ride."); }
  };

  const handleSearchSelect = (data, details = null) => {
      if (!details) return;
      setIsRouting(true); 
      setDestination({ latitude: details.geometry.location.lat, longitude: details.geometry.location.lng });
      setDropAddr(data.description); 
      setStatus('SELECTING');
      Keyboard.dismiss();
  };

  const openExternalMap = (lat, lng) => {
    const url = Platform.select({ ios: `maps:0,0?q=${lat},${lng}`, android: `geo:0,0?q=${lat},${lng}` });
    Linking.openURL(url);
  };

  const handleSOS = async () => {
      Alert.alert("🚨 EMERGENCY SOS", "Alert Police?", [
          { text: "Cancel", style: "cancel" },
          { text: "CALL POLICE", style: "destructive", onPress: async () => {
              try { await client.post('/bookings/sos', { bookingId: activeBooking.bookingId, lat: location.latitude, lng: location.longitude }, { headers: { Authorization: `Bearer ${userToken}` }}); } catch(e) {}
              Linking.openURL('tel:100'); 
          }}
      ]);
  };

  const submitRating = async (rating, review) => {
      try {
          await client.post('/bookings/rate', { bookingId: activeBooking.bookingId, rating, review }, { headers: { Authorization: `Bearer ${userToken}` }});
          setShowRatingModal(false);
          setActiveBooking(null);
          setStatus('IDLE');
          Alert.alert("Thank you!", "Your feedback helps us improve.");
      } catch(e) { Alert.alert("Error", "Could not submit rating"); }
  };

  const rejectRide = () => {
      if (!incomingRequest) return;
      const dId = userInfo.driverId || userInfo.id;
      socket.emit('declineRide', { bookingId: incomingRequest.bookingId, driverId: dId });
      setIncomingRequest(null); 
  };

  if (loadingLocation || !location) return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate('Profile')}>
        <Ionicons name="menu" size={30} color="black" />
      </TouchableOpacity>

      <MapView ref={mapRef} style={styles.map} provider={PROVIDER_GOOGLE} initialRegion={location} showsUserLocation={true} customMapStyle={darkMapStyle}>
        {destination && <Marker coordinate={destination} pinColor={colors.primary} />}
        {driverLocation && <Marker coordinate={driverLocation} title="Driver"><View style={styles.carMarker}><Ionicons name="car-sport" size={24} color="black" /></View></Marker>}
        
        {dynamicRoute && GOOGLE_API_KEY && (
            <MapViewDirections 
                origin={dynamicRoute.origin} 
                destination={dynamicRoute.dest} 
                apikey={GOOGLE_API_KEY} 
                strokeWidth={4} 
                strokeColor={colors.primary} 
                onReady={onDirectionsReady}
                onError={() => setIsRouting(false)}
            />
        )}
      </MapView>

      {/* RIDER UI */}
      {userInfo.role === 'rider' && (
        <>
            {status === 'IDLE' && (
                <View style={styles.searchContainer}>
                    <GooglePlacesAutocomplete placeholder="Where to?" onPress={handleSearchSelect} query={{ key: GOOGLE_API_KEY, language: 'en' }} fetchDetails={true} styles={{ textInput: styles.searchInput, listView: { backgroundColor: '#1a1a1a', zIndex: 1000 }, description: { color: 'white' }}} />
                </View>
            )}

            {(status === 'SELECTING' || status === 'SEARCHING') && (
                <View style={styles.bottomSheetContainer}>
                    <View style={styles.paymentSelector}>
                        <TouchableOpacity style={[styles.paymentBtn, paymentMode === 'cash' && styles.activePayment]} onPress={() => setPaymentMode('cash')}><Text style={[styles.paymentText, paymentMode === 'cash' && {color:'black'}]}>Cash</Text></TouchableOpacity>
                        <TouchableOpacity style={[styles.paymentBtn, paymentMode === 'online' && styles.activePayment]} onPress={() => setPaymentMode('online')}><Text style={[styles.paymentText, paymentMode === 'online' && {color:'black'}]}>Online</Text></TouchableOpacity>
                    </View>
                    {(isRouting || isEstimating) ? <ActivityIndicator size="large" color={colors.primary} style={{height: 150}} /> : 
                    <RideRequestPanel fare={routeInfo.fare} distance={routeInfo.distance} duration={routeInfo.duration} isSearching={status === 'SEARCHING'} onCancel={() => { setStatus('IDLE'); setDestination(null); }} onRequest={requestRide} />}
                </View>
            )}
            
            {(status === 'ACCEPTED' || status === 'ONGOING') && activeBooking && (
                <>
                    <TouchableOpacity style={styles.sosBtn} onPress={handleSOS}><Text style={styles.sosText}>SOS</Text></TouchableOpacity>
                    <View style={styles.driverInfoCard}>
                         <View style={styles.driverHeader}><View style={styles.avatar}><Text style={{fontSize:20}}>🚘</Text></View><View style={{marginLeft: 15}}><Text style={styles.driverName}>{activeBooking.driverName || 'Driver'}</Text><Text style={styles.carInfo}>{activeBooking.carModel}</Text><Text style={styles.rating}>⭐ 5.0</Text></View></View>
                         <View style={styles.divider} />
                         <View style={styles.otpBox}><Text style={styles.otpLabel}>OTP PIN</Text><Text style={styles.otpCode}>{activeBooking.otp}</Text></View>
                         <Text style={styles.statusText}>{status === 'ACCEPTED' ? `Driver arriving in ~${routeInfo.duration} min` : 'Ride in Progress'}</Text>
                    </View>
                </>
            )}
        </>
      )}

      {/* DRIVER UI */}
      {userInfo.role === 'driver' && (
        <>
            {status === 'IDLE' && (<View style={styles.driverControls}><TouchableOpacity style={[styles.onlineBtn, { backgroundColor: isDriverOnline ? colors.error : colors.success }]} onPress={() => setIsDriverOnline(!isDriverOnline)}><Text style={styles.onlineText}>{isDriverOnline ? 'GO OFFLINE' : 'GO ONLINE'}</Text></TouchableOpacity></View>)}
            {status === 'ACCEPTED' && (<View style={styles.driverControls}><TouchableOpacity style={styles.navBtn} onPress={() => openExternalMap(activeBooking.pickupLat, activeBooking.pickupLng)}><Text style={styles.navText}>Navigate to Pickup</Text></TouchableOpacity><TouchableOpacity style={styles.actionBtn} onPress={() => setShowOtpModal(true)}><Text style={styles.actionText}>START RIDE</Text></TouchableOpacity></View>)}
            {status === 'ONGOING' && (<View style={styles.driverControls}><TouchableOpacity style={styles.navBtn} onPress={() => openExternalMap(activeBooking.dropLat, activeBooking.dropLng)}><Text style={styles.navText}>Navigate to Drop</Text></TouchableOpacity><TouchableOpacity style={[styles.actionBtn, {backgroundColor: colors.error}]} onPress={endRide}><Text style={styles.actionText}>END RIDE</Text></TouchableOpacity></View>)}
            <DriverRequestModal visible={!!incomingRequest} request={incomingRequest} onAccept={acceptRide} onReject={rejectRide} />
            <OTPModal visible={showOtpModal} onSubmit={startRide} onCancel={() => setShowOtpModal(false)} />
        </>
      )}
      <RatingModal visible={showRatingModal} onSubmit={submitRating} onClose={() => setShowRatingModal(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  map: { flex: 1 },
  loading: { flex: 1, justifyContent:'center', alignItems:'center', backgroundColor:'black' },
  menuBtn: { position: 'absolute', top: 50, left: 20, zIndex: 20, backgroundColor: 'white', padding: 10, borderRadius: 25, elevation: 5 },
  sosBtn: { position: 'absolute', top: 50, right: 20, backgroundColor: 'red', width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 10, zIndex: 50, borderWidth: 2, borderColor: 'white' },
  sosText: { color: 'white', fontWeight: 'bold', fontSize: 18 },
  searchContainer: { position: 'absolute', top: 100, width: '90%', alignSelf: 'center', zIndex: 10 },
  searchInput: { backgroundColor: '#333', color: 'white', borderRadius: 10, paddingHorizontal: 10 },
  bottomSheetContainer: { position: 'absolute', bottom: 0, width: '100%' },
  paymentSelector: { flexDirection: 'row', justifyContent: 'center', marginBottom: 10, backgroundColor: '#1a1a1a', padding: 10, borderRadius: 15, width: '90%', alignSelf: 'center', borderWidth: 1, borderColor: '#333' },
  paymentBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 20, marginHorizontal: 10, borderWidth: 1, borderColor: '#444' },
  activePayment: { backgroundColor: colors.primary, borderColor: colors.primary },
  paymentText: { color: 'white', fontWeight: 'bold', marginLeft: 5 },
  driverInfoCard: { position: 'absolute', bottom: 30, width: '90%', alignSelf: 'center', backgroundColor: '#1a1a1a', padding: 20, borderRadius: 15, borderWidth: 1, borderColor: '#333', shadowColor:'#000', elevation:10 },
  driverHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center' },
  driverName: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  carInfo: { color: '#888', fontSize: 14, marginTop: 2 },
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
  carMarker: { backgroundColor: 'white', padding: 5, borderRadius: 15, elevation: 5 },
  confirmPinBtn: { position: 'absolute', bottom: 50, width: '80%', alignSelf: 'center', backgroundColor: colors.primary, padding: 15, borderRadius: 10, alignItems: 'center', zIndex:20 },
  confirmPinText: { color: 'black', fontWeight: 'bold', fontSize: 16 },
  pinBtn: { backgroundColor: '#444', padding: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', flex:1, marginHorizontal:5, justifyContent:'center' },
  pinText: { color: 'white', fontSize: 12, fontWeight: 'bold' },
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