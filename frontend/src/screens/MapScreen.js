import React, { useEffect, useState, useContext, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert, Keyboard, Linking } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete'; // Use this for real search
import { Ionicons } from '@expo/vector-icons';

import { AuthContext } from '../context/AuthContext';
import { SocketContext } from '../context/SocketContext';
import client from '../api/client';
import { colors } from '../theme/colors';

// Components
import RideRequestPanel from '../components/RideRequestPanel';
import DriverRequestModal from '../components/DriverRequestModal';

const darkMapStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#212121" }] },
  { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#212121" }] },
  { "featureType": "administrative", "elementType": "geometry", "stylers": [{ "color": "#757575" }] },
  { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#2c2c2c" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#000000" }] }
];

const MapScreen = ({ navigation }) => {
  const { userInfo, userToken } = useContext(AuthContext);
  const { socket } = useContext(SocketContext);
  const mapRef = useRef(null);

  // --- STATE ---
  const [location, setLocation] = useState(null); // User's current location
  const [destination, setDestination] = useState(null); // Drop location
  const [routeInfo, setRouteInfo] = useState({ distance: 0, fare: 0 });
  
  // App States: 'IDLE', 'SELECTING', 'SEARCHING', 'ACCEPTED', 'ONGOING', 'COMPLETED'
  const [status, setStatus] = useState('IDLE'); 
  const [activeBooking, setActiveBooking] = useState(null);

  // Driver Specific
  const [isDriverOnline, setIsDriverOnline] = useState(false);
  const [incomingRequest, setIncomingRequest] = useState(null);

  // 1. 📍 Get Current Location
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Allow location access to use the app.');
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

      // If Driver & Online -> Emit Location Loop
      if (userInfo.role === 'driver' && isDriverOnline) {
          socket.emit('driverLocation', {
             driverId: userInfo.driverId,
             lat: currentLoc.latitude,
             lng: currentLoc.longitude
          });
      }
    })();
  }, [isDriverOnline]);

  // 2. ⚡ Socket Listeners (The Real-Time Magic)
  useEffect(() => {
    if (!socket) return;

    // RIDER: Driver Accepted
    socket.on('rideAccepted', (data) => {
        Alert.alert('Ride Accepted!', `Driver is on the way.`);
        setStatus('ACCEPTED');
        setActiveBooking(prev => ({ ...prev, ...data }));
    });

    // RIDER: Driver Started Ride
    socket.on('rideStarted', () => {
        setStatus('ONGOING');
        Alert.alert('Ride Started', 'Enjoy your trip!');
    });

    // RIDER: Ride Completed
    socket.on('rideCompleted', ({ fare }) => {
        setStatus('COMPLETED');
        Alert.alert('Ride Completed', `Please pay $${fare}`);
        // Reset after 3 seconds
        setTimeout(() => {
            setStatus('IDLE');
            setDestination(null);
            setActiveBooking(null);
        }, 3000);
    });

    // DRIVER: New Request
    socket.on('newRideRequest', (data) => {
        setIncomingRequest(data); // Shows the Modal
    });

    return () => {
        socket.off('rideAccepted');
        socket.off('rideStarted');
        socket.off('rideCompleted');
        socket.off('newRideRequest');
    };
  }, [socket]);


  // --- 🚕 RIDER FUNCTIONS ---

  const handleDestinationSelect = (data, details = null) => {
    // NOTE: In a real app with API Key, use 'details.geometry.location'
    // For Demo: We mock a destination slightly north of the user
    const mockDest = {
        latitude: location.latitude + 0.01, 
        longitude: location.longitude + 0.005
    };
    
    setDestination(mockDest);
    setStatus('SELECTING');

    // Fit map to show both points
    mapRef.current.fitToCoordinates([location, mockDest], {
        edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
        animated: true,
    });

    // Calc Dummy Fare
    setRouteInfo({ distance: '2.5', fare: '12.50' });
    Keyboard.dismiss();
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
        
        setActiveBooking({ 
            bookingId: res.data.bookingId, 
            otp: res.data.otp // Show this to rider!
        }); 

    } catch (err) {
        setStatus('SELECTING');
        Alert.alert('Error', 'No drivers found nearby.');
    }
  };

  // --- 🚘 DRIVER FUNCTIONS ---

  const acceptRide = async () => {
    if (!incomingRequest) return;
    try {
        await client.post('/bookings/accept', {
            bookingId: incomingRequest.bookingId,
            driverId: userInfo.driverId // Needs to be in your userInfo!
        }, { headers: { Authorization: `Bearer ${userToken}` }});
        
        setStatus('ACCEPTED');
        setActiveBooking(incomingRequest);
        setIncomingRequest(null);
        
        // Open Navigation (Google Maps)
        const url = `google.navigation:q=${incomingRequest.pickupLat},${incomingRequest.pickupLng}`;
        // Linking.openURL(url); // Uncomment to auto-open maps

    } catch (err) {
        Alert.alert('Error', 'Could not accept ride.');
    }
  };

  const startRide = async () => {
      // For PoC, prompt for OTP. In real app, build a custom keypad.
      Alert.prompt('Enter OTP', 'Ask rider for 4-digit OTP', async (otp) => {
          try {
              await client.post('/bookings/start', {
                  bookingId: activeBooking.bookingId,
                  otp: otp
              }, { headers: { Authorization: `Bearer ${userToken}` }});
              setStatus('ONGOING');
          } catch (err) {
              Alert.alert('Invalid OTP');
          }
      });
  };

  const endRide = async () => {
      try {
          await client.post('/bookings/end', {
              bookingId: activeBooking.bookingId
          }, { headers: { Authorization: `Bearer ${userToken}` }});
          setStatus('IDLE');
          setActiveBooking(null);
          Alert.alert('Success', 'Ride Completed & Payment Processed.');
      } catch (err) {
          Alert.alert('Error', 'Could not end ride');
      }
  };

  // --- RENDER ---

  if (!location) return <View style={styles.loading}><Text>Loading Map...</Text></View>;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        customMapStyle={darkMapStyle}
        provider={PROVIDER_GOOGLE}
        initialRegion={location}
        showsUserLocation={true}
      >
        {/* Render Destination Marker */}
        {destination && <Marker coordinate={destination} pinColor={colors.primary} />}

        {/* Draw Route Line (Simple Polyline for PoC) */}
        {destination && (
            <Polyline 
                coordinates={[
                    { latitude: location.latitude, longitude: location.longitude },
                    destination
                ]}
                strokeColor={colors.primary}
                strokeWidth={4}
            />
        )}
      </MapView>

      {/* --- RIDER UI --- */}
      {userInfo.role === 'rider' && (
        <>
            {/* 1. Search Bar (Only when IDLE) */}
            {status === 'IDLE' && (
                <View style={styles.searchContainer}>
                    <GooglePlacesAutocomplete
                        placeholder="Where to?"
                        onPress={handleDestinationSelect}
                        query={{ key: 'YOUR_API_KEY_HERE', language: 'en' }} // Replace if you have one
                        styles={{
                            textInput: styles.searchInput,
                            listView: { backgroundColor: '#1a1a1a' } // Dark mode list
                        }}
                        enablePoweredByContainer={false}
                        fetchDetails={true}
                        // Mock Functionality for PoC:
                        textInputProps={{
                             onEndEditing: handleDestinationSelect 
                        }}
                    />
                </View>
            )}

            {/* 2. Request Panel (When Selecting) */}
            {(status === 'SELECTING' || status === 'SEARCHING') && (
                <RideRequestPanel 
                    fare={routeInfo.fare}
                    distance={routeInfo.distance}
                    isSearching={status === 'SEARCHING'}
                    onCancel={() => { setStatus('IDLE'); setDestination(null); }}
                    onRequest={requestRide}
                />
            )}

            {/* 3. Waiting / On Ride UI */}
            {(status === 'ACCEPTED' || status === 'ONGOING') && activeBooking && (
                <View style={styles.infoCard}>
                    <Text style={styles.infoTitle}>
                        {status === 'ACCEPTED' ? 'Driver is coming!' : 'Ride in Progress'}
                    </Text>
                    {status === 'ACCEPTED' && (
                        <Text style={styles.otp}>OTP: {activeBooking.otp}</Text>
                    )}
                </View>
            )}
        </>
      )}

      {/* --- DRIVER UI --- */}
      {userInfo.role === 'driver' && (
        <>
            {/* Go Online Button */}
            {status === 'IDLE' && (
                <TouchableOpacity 
                    style={[styles.onlineBtn, { backgroundColor: isDriverOnline ? colors.error : colors.success }]}
                    onPress={() => setIsDriverOnline(!isDriverOnline)}
                >
                    <Text style={styles.onlineText}>{isDriverOnline ? 'GO OFFLINE' : 'GO ONLINE'}</Text>
                </TouchableOpacity>
            )}

            {/* Trip Controls */}
            {status === 'ACCEPTED' && (
                <TouchableOpacity style={styles.actionBtn} onPress={startRide}>
                    <Text style={styles.actionText}>START RIDE (Verify OTP)</Text>
                </TouchableOpacity>
            )}
            {status === 'ONGOING' && (
                <TouchableOpacity style={[styles.actionBtn, {backgroundColor: colors.error}]} onPress={endRide}>
                    <Text style={styles.actionText}>END RIDE</Text>
                </TouchableOpacity>
            )}

            {/* Request Modal */}
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
  loading: { flex: 1, justifyContent:'center', alignItems:'center', backgroundColor:'black' },
  
  // Rider Styles
  searchContainer: { 
      position: 'absolute', top: 50, width: '90%', alignSelf: 'center',
      backgroundColor: 'transparent', zIndex: 10 
  },
  searchInput: {
      backgroundColor: colors.inputBg, borderRadius: 10, color: 'white',
      borderWidth: 1, borderColor: '#333'
  },
  infoCard: {
      position: 'absolute', bottom: 30, alignSelf: 'center', width: '90%',
      backgroundColor: colors.secondary, padding: 20, borderRadius: 15, alignItems: 'center'
  },
  infoTitle: { color: colors.primary, fontSize: 18, fontWeight: 'bold' },
  otp: { color: 'white', fontSize: 24, fontWeight: '900', marginTop: 10, letterSpacing: 5 },

  // Driver Styles
  onlineBtn: {
      position: 'absolute', bottom: 50, alignSelf: 'center',
      width: 200, padding: 15, borderRadius: 30, alignItems: 'center'
  },
  onlineText: { color: 'black', fontWeight: 'bold', fontSize: 16 },
  actionBtn: {
      position: 'absolute', bottom: 50, alignSelf: 'center',
      width: '90%', backgroundColor: colors.primary, padding: 20, borderRadius: 10, alignItems: 'center'
  },
  actionText: { color: 'black', fontWeight: '900', fontSize: 18 }
});

export default MapScreen;