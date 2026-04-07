import React, { useEffect, useState, useContext, useRef, useCallback } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Alert, ActivityIndicator, Keyboard, Linking, Platform, AppState, Share, Animated, ScrollView } from 'react-native';
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
import RideChatPanel from '../components/RideChatPanel';
import LiveDriverMarker from '../components/LiveDriverMarker';
import CancelRideModal from '../components/CancelRideModal';
import {
  ensureBackgroundDriverTracking,
  setBackgroundDriverTrackingState,
  stopBackgroundDriverTracking,
} from '../utils/driverLocationBackgroundTask';

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

const MapScreen = ({ navigation, route }) => {
  const { userInfo, userToken } = useContext(AuthContext);
  const { socket } = useContext(SocketContext);
  const mapRef = useRef(null);
  const appState = useRef(AppState.currentState);
  const locationWatchRef = useRef(null);
  const activeBookingRef = useRef(null);

  // Locations
  const [location, setLocation] = useState(null); 
  const [destination, setDestination] = useState(null);
  const [pickupAddr, setPickupAddr] = useState("My Location");
  const [dropAddr, setDropAddr] = useState("");
  const [mapRegion, setMapRegion] = useState(null);

  // UI & Flow
  const [routeInfo, setRouteInfo] = useState({ distance: 0, fare: 0, duration: 0, pickupETA: 0 });
  const [status, setStatus] = useState('IDLE'); 
  const [isPinning, setIsPinning] = useState(false); 
  const [paymentMode, setPaymentMode] = useState('cash'); 
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [savingPlace, setSavingPlace] = useState(false);

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
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [sharingTrip, setSharingTrip] = useState(false);
  const [showCancelRideModal, setShowCancelRideModal] = useState(false);
  const [cancelRideLoading, setCancelRideLoading] = useState(false);
  const currentDriverId = userInfo.driverId || null;
  const rideCardAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    activeBookingRef.current = activeBooking;
  }, [activeBooking]);

  useEffect(() => {
    if (!activeBooking?.bookingId) {
      setChatMessages([]);
      setChatDraft('');
      setShowChatPanel(false);
      setShowCancelRideModal(false);
      setCancelRideLoading(false);
    }
  }, [activeBooking?.bookingId]);

  useEffect(() => {
    const shouldShow = status === 'ACCEPTED' || status === 'ONGOING';
    Animated.spring(rideCardAnim, {
      toValue: shouldShow ? 1 : 0,
      useNativeDriver: true,
      friction: 8,
      tension: 65,
    }).start();
  }, [status, rideCardAnim]);

  const fetchSavedPlaces = useCallback(async () => {
    if (userInfo.role !== 'rider') return;
    try {
      const response = await client.get('/bookings/saved-places', {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      setSavedPlaces(Array.isArray(response.data) ? response.data : []);
    } catch (_error) {
      // Ignore non-critical failures for saved places.
    }
  }, [userInfo.role, userToken]);

  useEffect(() => {
    fetchSavedPlaces();
  }, [fetchSavedPlaces]);

  const chooseSavedPlace = useCallback((place) => {
    if (!place) return;
    setDestination({
      latitude: Number(place.lat),
      longitude: Number(place.lng),
    });
    setDropAddr(place.address || place.label || 'Saved Place');
    setStatus('SELECTING');
    setIsPinning(false);
    setIsRouting(true);
    mapRef.current?.animateToRegion(
      {
        latitude: Number(place.lat),
        longitude: Number(place.lng),
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      500
    );
  }, []);

  const saveCurrentDestinationAs = useCallback(
    async (label) => {
      if (!destination || savingPlace) return;
      try {
        setSavingPlace(true);
        await client.post(
          '/bookings/saved-places',
          {
            label,
            address: dropAddr || 'Saved Place',
            lat: destination.latitude,
            lng: destination.longitude,
          },
          { headers: { Authorization: `Bearer ${userToken}` } }
        );
        await fetchSavedPlaces();
        Alert.alert('Saved', `${label.toUpperCase()} saved successfully.`);
      } catch (error) {
        Alert.alert('Save Failed', error?.response?.data?.error || 'Could not save this place.');
      } finally {
        setSavingPlace(false);
      }
    },
    [destination, dropAddr, fetchSavedPlaces, savingPlace, userToken]
  );

  const removeSavedPlace = useCallback(
    async (placeId) => {
      try {
        await client.delete(`/bookings/saved-places/${placeId}`, {
          headers: { Authorization: `Bearer ${userToken}` },
        });
        await fetchSavedPlaces();
      } catch (_error) {
        Alert.alert('Delete Failed', 'Could not remove saved place.');
      }
    },
    [fetchSavedPlaces, userToken]
  );

  const applyPromoForRoute = useCallback(
    async (promoCode, carType) => {
      if (!location || !destination) return null;
      try {
        const response = await client.post(
          '/bookings/apply-promo',
          {
            promoCode,
            carType,
            pickupLat: location.latitude,
            pickupLng: location.longitude,
            dropLat: destination.latitude,
            dropLng: destination.longitude,
          },
          { headers: { Authorization: `Bearer ${userToken}` } }
        );
        return response.data;
      } catch (error) {
        Alert.alert('Promo Invalid', error?.response?.data?.error || 'Promo code is not applicable.');
        return null;
      }
    },
    [destination, location, userToken]
  );

  const syncDriverAvailability = useCallback(async (nextOnline, coords = null) => {
    try {
      if (userInfo.role !== 'driver') return null;
      const payload = {
        isOnline: nextOnline,
        lat: coords?.latitude,
        lng: coords?.longitude,
      };
      const res = await client.post('/bookings/driver/availability', payload, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      return res.data;
    } catch (error) {
      throw error;
    }
  }, [userInfo.role, userToken]);

  const updateDriverLocationViaApi = useCallback(async (latitude, longitude) => {
    try {
      if (userInfo.role !== 'driver' || !isDriverOnline) return;
      await client.post(
        '/bookings/driver-location',
        { driverId: currentDriverId, lat: latitude, lng: longitude },
        { headers: { Authorization: `Bearer ${userToken}` } }
      );
    } catch (_error) {
      // Keep silent: foreground socket emits are the primary channel.
    }
  }, [userInfo.role, isDriverOnline, currentDriverId, userToken]);

  const configureBackgroundTracking = useCallback(async (enabled) => {
    if (userInfo.role !== 'driver') return;

    await setBackgroundDriverTrackingState({
      enabled,
      driverId: currentDriverId,
      token: userToken,
    });

    if (!enabled) {
      await stopBackgroundDriverTracking();
      return;
    }

    try {
      const permission = await Location.requestBackgroundPermissionsAsync();
      if (permission.status !== 'granted') {
        console.log('[BG-LOCATION] Background permission not granted');
        return;
      }
      await ensureBackgroundDriverTracking();
    } catch (e) {
      console.log('[BG-LOCATION] Could not start background tracking:', e?.message || e);
    }
  }, [userInfo.role, currentDriverId, userToken]);

  const toggleDriverAvailability = async () => {
    if (userInfo.role === 'driver' && !currentDriverId) {
      Alert.alert('Driver Profile Missing', 'Driver identity is missing. Please log out and log in again.');
      return;
    }

    const nextOnline = !isDriverOnline;
    try {
      await syncDriverAvailability(nextOnline, location);
      setIsDriverOnline(nextOnline);
      await configureBackgroundTracking(nextOnline);

      if (nextOnline && socket?.connected && location) {
        socket.emit('joinDriver', currentDriverId);
        socket.emit('driverLocation', {
          driverId: currentDriverId,
          lat: location.latitude,
          lng: location.longitude,
        });
      }
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        (nextOnline ? 'Could not go online right now.' : 'Could not go offline right now.');
      Alert.alert('Status Update Failed', msg);
    }
  };

  const appendChatMessage = useCallback((message) => {
    if (!message?.messageId) return;
    setChatMessages((prev) => {
      if (prev.some((item) => item.messageId === message.messageId)) return prev;
      return [...prev, message];
    });
  }, []);

  const sendRideChat = useCallback(() => {
    const bookingId = activeBookingRef.current?.bookingId;
    const text = String(chatDraft || '').trim();
    if (!bookingId || !text) return;
    if (userInfo.role === 'driver' && !currentDriverId) return;

    if (!socket?.connected) {
      Alert.alert('Chat Offline', 'Socket disconnected. Please try again in a moment.');
      return;
    }

    const payload = {
      bookingId,
      senderRole: userInfo.role,
      senderId: userInfo.role === 'driver' ? currentDriverId : userInfo.id,
      text,
      messageId: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sentAt: new Date().toISOString(),
    };

    appendChatMessage(payload);
    setChatDraft('');
    socket.emit('rideChatMessage', payload);
  }, [appendChatMessage, chatDraft, currentDriverId, socket, userInfo.id, userInfo.role]);

  const shareLiveTrip = useCallback(async () => {
    const bookingId = activeBookingRef.current?.bookingId;
    if (!bookingId || sharingTrip) return;

    try {
      setSharingTrip(true);
      const res = await client.post(
        '/bookings/share-link',
        { bookingId },
        { headers: { Authorization: `Bearer ${userToken}` } }
      );

      const trackingUrl = res?.data?.trackingUrl;
      if (!trackingUrl) throw new Error('Tracking URL not available');

      await Share.share({
        message: `Track this trip live: ${trackingUrl}`,
        url: trackingUrl,
        title: 'Live Trip Tracking',
      });
    } catch (err) {
      Alert.alert('Share Failed', err?.response?.data?.error || 'Could not generate tracking link.');
    } finally {
      setSharingTrip(false);
    }
  }, [sharingTrip, userToken]);

  const resetRideSession = useCallback(() => {
    setShowOtpModal(false);
    setShowChatPanel(false);
    setChatDraft('');
    setChatMessages([]);
    setIncomingRequest(null);
    setDriverLocation(null);
    setDestination(null);
    setActiveBooking(null);
    setShowCancelRideModal(false);
    setStatus('IDLE');
  }, []);

  const applyRideCancelledState = useCallback((payload, initiatedBySelf = false) => {
    const reason = String(payload?.reason || '').trim();
    const cancelledByRole = payload?.cancelledByRole === 'driver' ? 'Driver' : 'Rider';
    const reasonLine = reason ? `\n\nReason: ${reason}` : '';

    if (initiatedBySelf) {
      Alert.alert('Ride Cancelled', `Your ride has been cancelled.${reasonLine}`);
    } else {
      Alert.alert('Ride Cancelled', `${cancelledByRole} cancelled the ride.${reasonLine}`);
    }

    resetRideSession();
  }, [resetRideSession]);

  const submitRideCancellation = useCallback(async (reason) => {
    const bookingId = activeBookingRef.current?.bookingId;
    if (!bookingId) return;

    try {
      setCancelRideLoading(true);
      const response = await client.post(
        '/bookings/cancel',
        { bookingId, reason },
        { headers: { Authorization: `Bearer ${userToken}` } }
      );
      setShowCancelRideModal(false);
      applyRideCancelledState(response?.data || { reason, cancelledByRole: userInfo.role }, true);
    } catch (error) {
      Alert.alert('Cancellation Failed', error?.response?.data?.error || 'Could not cancel this ride.');
    } finally {
      setCancelRideLoading(false);
    }
  }, [applyRideCancelledState, userInfo.role, userToken]);

  const centerOnCurrentLocation = useCallback(async () => {
    try {
      let current = location;
      if (!current) {
        const latest = await Location.getCurrentPositionAsync({});
        current = {
          latitude: latest.coords.latitude,
          longitude: latest.coords.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        };
        setLocation(current);
      }

      mapRef.current?.animateToRegion(
        {
          latitude: current.latitude,
          longitude: current.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        },
        450
      );
    } catch (_e) {
      Alert.alert('Location Error', 'Could not center map to your location.');
    }
  }, [location]);

  // 🔄 RECONNECTION LOGIC
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        console.log("⚡ App in Foreground: Reconnecting Socket...");
        if (socket && !socket.connected) socket.connect();
        
        if (userInfo.role === 'driver' && isDriverOnline && location) {
            syncDriverAvailability(true, location).catch(() => {});
            if (socket?.connected) {
              socket.emit('joinDriver', currentDriverId);
              socket.emit('driverLocation', { 
                  driverId: currentDriverId, 
                  lat: location.latitude, 
                  lng: location.longitude 
              });
            } else {
              updateDriverLocationViaApi(location.latitude, location.longitude);
            }
        }
      }
      appState.current = nextAppState;
    });
    return () => subscription.remove();
  }, [isDriverOnline, socket, location, userInfo.role, currentDriverId, syncDriverAvailability, updateDriverLocationViaApi]);

  // Socket Listeners
  useEffect(() => {
    if (!socket) return;

    const handleRideAccepted = (data) => {
      const trackedBooking = activeBookingRef.current;

      if (userInfo.role === 'rider') {
        if (Number(data?.riderId) !== Number(userInfo.id)) return;
        if (trackedBooking?.bookingId && Number(trackedBooking.bookingId) !== Number(data.bookingId)) return;
      } else if (Number(data?.driverId) !== Number(currentDriverId)) {
        return;
      }

      setStatus('ACCEPTED');
      setActiveBooking((prev) => ({ ...(prev || {}), ...data }));

      if (data.eta) {
        setRouteInfo((prev) => ({ ...prev, pickupETA: data.eta }));
      }

      if (userInfo.role === 'rider') {
        Alert.alert("Ride Accepted", `${data.driverName} is arriving in ${data.eta || 5} mins!`);
      }
    };

    const handleDriverMoved = (data) => {
      if (userInfo.role !== 'rider') return;
      const trackedBooking = activeBookingRef.current;
      if (!trackedBooking) return;

      if (data?.bookingId && Number(data.bookingId) !== Number(trackedBooking.bookingId)) return;
      if (Number(data?.driverId) !== Number(trackedBooking.driverId)) return;

      setDriverLocation({ latitude: data.lat, longitude: data.lng });
    };

    const handleRideStarted = (data) => {
      const trackedBooking = activeBookingRef.current;
      if (!trackedBooking || Number(data?.bookingId) !== Number(trackedBooking.bookingId)) return;

      if (userInfo.role === 'driver' && Number(data?.driverId) !== Number(currentDriverId)) return;

      setShowOtpModal(false);
      setStatus('ONGOING');
      if (userInfo.role === 'rider') Alert.alert("Ride Started", "Have a safe trip!");
    };

    const handleRideCompleted = ({ fare, bookingId, driverId }) => {
      const trackedBooking = activeBookingRef.current;
      if (!trackedBooking || Number(bookingId) !== Number(trackedBooking.bookingId)) return;
      if (userInfo.role === 'driver' && Number(driverId) !== Number(currentDriverId)) return;

      setStatus('COMPLETED');

      if (userInfo.role === 'rider') {
        setActiveBooking((prev) => ({
          ...(prev || {}),
          finalFare: fare,
          bookingId: bookingId || prev?.bookingId,
          needsPayment: true,
        }));
        setShowRatingModal(true);
      } else {
        Alert.alert('Ride Ended', `Collect ₹${fare} from the rider.`);
        setStatus('IDLE');
        setActiveBooking(null);
      }

      setDestination(null);
      setDriverLocation(null);
    };

    const handleNewRideRequest = (data) => {
      if (userInfo.role !== 'driver') return;
      setIncomingRequest(data);
    };

    const handleRequestTimeout = () => {
      if (userInfo.role !== 'driver') return;
      Alert.alert("Missed", "You missed the ride request.");
      setIncomingRequest(null);
    };

    const handleRideUnavailable = (data) => {
      if (userInfo.role !== 'rider') return;
      const trackedBooking = activeBookingRef.current;
      if (!trackedBooking || Number(data?.bookingId) !== Number(trackedBooking.bookingId)) return;

      Alert.alert('No Drivers Found', data?.message || 'No driver available nearby.');
      setActiveBooking(null);
      setStatus(destination ? 'SELECTING' : 'IDLE');
    };

    const handleScheduledRideDelayed = (data) => {
      if (userInfo.role !== 'rider') return;
      Alert.alert('Scheduled Ride Update', data?.message || 'We are still trying to find a nearby driver.');
    };

    const handleRideChatMessage = (data) => {
      const trackedBooking = activeBookingRef.current;
      if (!trackedBooking || Number(data?.bookingId) !== Number(trackedBooking.bookingId)) return;
      appendChatMessage({
        ...data,
        sentAt: data?.sentAt || new Date().toISOString(),
      });
    };

    const handleRideChatAck = (data) => {
      const trackedBooking = activeBookingRef.current;
      if (!trackedBooking || Number(data?.bookingId) !== Number(trackedBooking.bookingId)) return;
      appendChatMessage({
        ...data,
        sentAt: data?.sentAt || new Date().toISOString(),
      });
    };

    const handleRideCancelled = (data) => {
      const trackedBooking = activeBookingRef.current;
      if (!trackedBooking || Number(data?.bookingId) !== Number(trackedBooking.bookingId)) return;

      setCancelRideLoading(false);
      setShowCancelRideModal(false);
      applyRideCancelledState(data, false);
    };

    socket.on('rideAccepted', handleRideAccepted);
    socket.on('driverMoved', handleDriverMoved);
    socket.on('rideStarted', handleRideStarted);
    socket.on('rideCompleted', handleRideCompleted);
    socket.on('newRideRequest', handleNewRideRequest);
    socket.on('requestTimeout', handleRequestTimeout);
    socket.on('rideUnavailable', handleRideUnavailable);
    socket.on('scheduledRideDelayed', handleScheduledRideDelayed);
    socket.on('rideChatMessage', handleRideChatMessage);
    socket.on('rideChatAck', handleRideChatAck);
    socket.on('rideCancelled', handleRideCancelled);

    return () => {
      socket.off('rideAccepted', handleRideAccepted);
      socket.off('driverMoved', handleDriverMoved);
      socket.off('rideStarted', handleRideStarted);
      socket.off('rideCompleted', handleRideCompleted);
      socket.off('newRideRequest', handleNewRideRequest);
      socket.off('requestTimeout', handleRequestTimeout);
      socket.off('rideUnavailable', handleRideUnavailable);
      socket.off('scheduledRideDelayed', handleScheduledRideDelayed);
      socket.off('rideChatMessage', handleRideChatMessage);
      socket.off('rideChatAck', handleRideChatAck);
      socket.off('rideCancelled', handleRideCancelled);
    };
  }, [socket, userInfo.role, userInfo.id, currentDriverId, destination, appendChatMessage, applyRideCancelledState]);

  // Location Tracking
  useEffect(() => {
    const startTracking = async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { 
        setLoadingLocation(false); 
        return; 
      }
      
      let loc = await Location.getCurrentPositionAsync({});
      const region = { 
        latitude: loc.coords.latitude, 
        longitude: loc.coords.longitude, 
        latitudeDelta: 0.005, 
        longitudeDelta: 0.005 
      };
      setLocation(region);
      setMapRegion(region);
      setLoadingLocation(false);

      Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      })
        .then((addresses) => {
          if (addresses?.length) {
            const addr = addresses[0];
            const fullAddress = [addr.name, addr.street, addr.city, addr.region]
              .filter(Boolean)
              .join(', ');
            if (fullAddress) setPickupAddr(fullAddress);
          }
        })
        .catch(() => {});

      const subscription = await Location.watchPositionAsync(
        { 
          accuracy: Location.Accuracy.High, 
          timeInterval: 5000, 
          distanceInterval: 10 
        }, 
        (newLoc) => {
            const { latitude, longitude } = newLoc.coords;
            setLocation(prev => ({ ...prev, latitude, longitude })); 
            
            if (userInfo.role === 'driver' && isDriverOnline) {
                if (socket?.connected) {
                  socket.emit('joinDriver', currentDriverId);
                  socket.emit('driverLocation', { driverId: currentDriverId, lat: latitude, lng: longitude });
                } else {
                  updateDriverLocationViaApi(latitude, longitude);
                }
            }
        }
      );
      
      locationWatchRef.current = subscription;
    };
    
    startTracking();
    
    return () => { 
      if (locationWatchRef.current) {
        console.log("🛑 Stopping location tracking (component unmount)");
        locationWatchRef.current.remove(); 
      }
    };
  }, [isDriverOnline, userInfo.role, currentDriverId, socket, updateDriverLocationViaApi]);

  useEffect(() => {
    if (userInfo.role !== 'driver') return;
    configureBackgroundTracking(isDriverOnline).catch(() => {});
  }, [isDriverOnline, userInfo.role, currentDriverId, userToken, configureBackgroundTracking]);

  useEffect(() => {
    return () => {
      setBackgroundDriverTrackingState({
        enabled: false,
        driverId: currentDriverId,
        token: userToken,
      }).catch(() => {});
      stopBackgroundDriverTracking().catch(() => {});
    };
  }, [currentDriverId, userToken]);

  // --- 🗺️ SMART ROUTING ---
  const getRoutingPoints = () => {
      if (status === 'ACCEPTED' && driverLocation && location) {
          return { origin: driverLocation, dest: location, mode: 'pickup' };
      }
      
      if (status === 'ONGOING' && (driverLocation || location) && destination) {
          const startPoint = userInfo.role === 'rider' ? driverLocation : location;
          return { origin: startPoint, dest: destination, mode: 'drop' };
      }
      
      if ((status === 'SELECTING' || status === 'SEARCHING') && location && destination) {
          return { origin: location, dest: destination, mode: 'estimate' };
      }
      
      return null;
  };

  const dynamicRoute = getRoutingPoints();

  const onDirectionsReady = async (result) => {
      setIsRouting(false); 
      
      if (dynamicRoute?.mode === 'pickup') {
          const pickupETA = Math.round(result.duration);
          setRouteInfo(prev => ({ ...prev, pickupETA }));
          return;
      }
      
      if (dynamicRoute?.mode === 'estimate') {
          setIsEstimating(true);
          try {
              const res = await client.post('/bookings/estimate', {
                  pickupLat: location.latitude, 
                  pickupLng: location.longitude,
                  dropLat: destination.latitude, 
                  dropLng: destination.longitude
              }, { headers: { Authorization: `Bearer ${userToken}` }});

              setRouteInfo({ 
                  distance: res.data.distance, 
                  fare: res.data.fare, 
                  duration: res.data.duration,
                  pickupETA: 0
              });
              
              if (res.data.surge > 1.0) {
                  Alert.alert("⚡ High Demand", `Fares are higher (${res.data.surge}x) due to traffic.`);
              }
          } catch (_err) {
              const price = Math.round(50 + (result.distance * 15)); 
              setRouteInfo({ 
                  distance: result.distance.toFixed(1), 
                  fare: price, 
                  duration: result.duration.toFixed(0),
                  pickupETA: 0
              });
          } finally { 
              setIsEstimating(false); 
          }
      } else if (dynamicRoute?.mode === 'drop') {
          setRouteInfo(prev => ({ 
              ...prev, 
              distance: result.distance.toFixed(1), 
              duration: result.duration.toFixed(0) 
          }));
      }
  };

  // --- ACTIONS ---
  const requestRide = async (carType, selectedFare, options = {}) => {
    if (!destination) return Alert.alert("Error", "Please select a valid destination.");
    setStatus('SEARCHING');
    try {
        const scheduleOffsetMinutes = Math.max(0, Number(options?.scheduleOffsetMinutes || 0));
        const scheduledFor =
          scheduleOffsetMinutes > 0
            ? new Date(Date.now() + scheduleOffsetMinutes * 60 * 1000).toISOString()
            : null;

        const res = await client.post('/bookings/request', {
            pickupLat: location.latitude, 
            pickupLng: location.longitude,
            dropLat: destination.latitude, 
            dropLng: destination.longitude,
            pickupAddress: pickupAddr, 
            dropAddress: dropAddr, 
            carType: carType, 
            paymentMode: paymentMode,
            promoCode: options?.promoCode || null,
            ridePreferences: options?.ridePreferences || [],
            specialInstructions: options?.specialInstructions || '',
            scheduledFor,
        }, { headers: { Authorization: `Bearer ${userToken}` }});

        if (res?.data?.isScheduled) {
          setStatus('IDLE');
          setDestination(null);
          Alert.alert(
            'Ride Scheduled',
            `Your ride is set for ${new Date(res.data.scheduledFor).toLocaleString()}`
          );
          return;
        }

        setActiveBooking({
            bookingId: res.data.bookingId,
            otp: res.data.otp,
            carType: res.data.carType || carType,
            fare: res.data.fare || selectedFare,
            originalFare: res.data.originalFare || selectedFare,
            discountAmount: res.data.discountAmount || 0,
            promoCode: res.data.promoCode || null,
            paymentMode,
            dropAddress: dropAddr,
            ridePreferences: options?.ridePreferences || [],
            specialInstructions: options?.specialInstructions || '',
        });
    } catch (err) {
        setStatus('SELECTING');
        Alert.alert('Booking Failed', err.response?.data?.error || err.response?.data?.message || 'No drivers available.');
    }
  };

  const acceptRide = async () => {
    if (!incomingRequest) return;
    try {
        await client.post('/bookings/accept', { 
            bookingId: incomingRequest.bookingId
        }, { headers: { Authorization: `Bearer ${userToken}` }});
        
        setStatus('ACCEPTED');
        setActiveBooking({ ...incomingRequest, driverId: currentDriverId });
        setIncomingRequest(null);
        
        Alert.alert("Navigate", "Open Maps?", [
            { text: "No" }, 
            { 
                text: "Yes", 
                onPress: () => openExternalMap(incomingRequest.pickupLat, incomingRequest.pickupLng) 
            }
        ]);
    } catch (_err) { 
        Alert.alert('Error', 'Could not accept ride.'); 
    }
  };

  const startRide = async (otpInput) => {
      if (!activeBooking) return;
      try {
        setShowOtpModal(false); 
        await client.post('/bookings/start', { 
            bookingId: activeBooking.bookingId, 
            otp: otpInput 
        }, { headers: { Authorization: `Bearer ${userToken}` }});
      } catch(_e) { 
        setShowOtpModal(true); 
        Alert.alert("Invalid OTP"); 
      }
  };

  const endRide = async () => {
      if (!activeBooking) return;
      try { 
        await client.post('/bookings/end', { 
            bookingId: activeBooking.bookingId, 
            dropLat: location.latitude, 
            dropLng: location.longitude 
        }, { headers: { Authorization: `Bearer ${userToken}` }}); 
      } catch (_e) { 
        Alert.alert("Error", "Could not end ride."); 
      }
  };

  const handleSearchSelect = (data, details = null) => {
      if (!details) return;
      setIsRouting(true); 
      setDestination({ 
          latitude: details.geometry.location.lat, 
          longitude: details.geometry.location.lng 
      });
      setDropAddr(data.description); 
      setStatus('SELECTING');
      setIsPinning(false);
      Keyboard.dismiss();
  };

  const startPinning = () => {
      setIsPinning(true);
      setStatus('IDLE');
      setMapRegion(destination || location);
  };

  const confirmPinLocation = async () => {
      if (!mapRegion) return;
      
      setDestination({ latitude: mapRegion.latitude, longitude: mapRegion.longitude });
      
      try {
          const addresses = await Location.reverseGeocodeAsync({
              latitude: mapRegion.latitude,
              longitude: mapRegion.longitude
          });
          
          if (addresses && addresses.length > 0) {
              const addr = addresses[0];
              const fullAddress = [
                  addr.name,
                  addr.street,
                  addr.city,
                  addr.region
              ].filter(Boolean).join(', ');
              
              setDropAddr(fullAddress || "Selected Location");
          } else {
              setDropAddr("Selected Location");
          }
      } catch (error) {
          console.log("Reverse geocoding failed:", error);
          setDropAddr("Selected Location");
      }
      
      setIsPinning(false);
      setIsRouting(true);
      setStatus('SELECTING');
  };

  const openExternalMap = (lat, lng) => {
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    const nativeUrl = Platform.select({
      ios: `maps:0,0?q=${lat},${lng}`,
      android: `google.navigation:q=${lat},${lng}&mode=d`,
      default: webUrl,
    });

    Linking.canOpenURL(nativeUrl)
      .then((supported) => Linking.openURL(supported ? nativeUrl : webUrl))
      .catch(() => Linking.openURL(webUrl));
  };

  const handleSOS = async () => {
      Alert.alert("🚨 EMERGENCY SOS", "Alert Police?", [
          { text: "Cancel", style: "cancel" },
          { 
              text: "CALL POLICE", 
              style: "destructive", 
              onPress: async () => {
                  try { 
                      await client.post('/bookings/sos', { 
                          bookingId: activeBooking.bookingId, 
                          lat: location.latitude, 
                          lng: location.longitude 
                      }, { headers: { Authorization: `Bearer ${userToken}` }}); 
                  } catch(_e) {}
                  Linking.openURL('tel:100'); 
              }
          }
      ]);
  };

  // 🟢 FIX: Modified submitRating to navigate AFTER rating
  const submitRating = async (rating, review) => {
      try {
          await client.post('/bookings/rate', { 
              bookingId: activeBooking.bookingId, 
              rating, 
              review 
          }, { headers: { Authorization: `Bearer ${userToken}` }});
          
          setShowRatingModal(false);
          
          // 🟢 Navigate to payment AFTER rating is submitted
          if (activeBooking?.needsPayment) {
              setTimeout(() => {
                  navigation.navigate('Payment', { 
                      fare: activeBooking.finalFare, 
                      bookingId: activeBooking.bookingId, 
                      paymentMode: activeBooking.paymentMode 
                  });
              }, 300);
          }
          
          setActiveBooking(null);
          setStatus('IDLE');
          
      } catch(e) { 
          console.error("Rating error:", e);
          Alert.alert("Error", "Could not submit rating. Please try again.");
          // Don't close modal on error - let user retry
      }
  };
  
  // 🟢 NEW: Handle rating skip/close
  const handleRatingClose = () => {
      setShowRatingModal(false);
      
      // Still navigate to payment even if rating is skipped
      if (activeBooking?.needsPayment) {
          setTimeout(() => {
              navigation.navigate('Payment', { 
                  fare: activeBooking.finalFare, 
                  bookingId: activeBooking.bookingId, 
                  paymentMode: activeBooking.paymentMode 
              });
          }, 300);
      }
      
      setActiveBooking(null);
      setStatus('IDLE');
  };

  const rejectRide = () => {
      if (!incomingRequest) return;
      if (!currentDriverId) {
          Alert.alert('Driver Profile Missing', 'Could not identify driver profile.');
          return;
      }
      socket.emit('declineRide', { 
          bookingId: incomingRequest.bookingId, 
          driverId: currentDriverId 
      });
      setIncomingRequest(null); 
  };

  if (loadingLocation || !location) {
      return (
          <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
          </View>
      );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate('Profile')}>
        <Ionicons name="menu" size={30} color="black" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.locateBtn} onPress={centerOnCurrentLocation}>
        <Ionicons name="locate" size={22} color="white" />
      </TouchableOpacity>

      <MapView 
        ref={mapRef} 
        style={styles.map} 
        provider={PROVIDER_GOOGLE} 
        initialRegion={location} 
        showsUserLocation={!isPinning} 
        showsMyLocationButton={false}
        customMapStyle={darkMapStyle}
        onRegionChangeComplete={(region) => setMapRegion(region)}
      >
        {destination && !isPinning && (
            <Marker coordinate={destination} pinColor={colors.primary} />
        )}
        
        {driverLocation && (
            <Marker coordinate={driverLocation} title="Driver Live" anchor={{ x: 0.5, y: 0.5 }}>
                <LiveDriverMarker />
            </Marker>
        )}
        
        {dynamicRoute && GOOGLE_API_KEY && !isPinning && (
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

      {isPinning && (
          <View style={styles.centerMarker}>
              <Ionicons name="location" size={40} color={colors.primary} />
          </View>
      )}

      {/* RIDER UI */}
      {userInfo.role === 'rider' && (
        <>
            {status === 'IDLE' && !isPinning && (
                <View style={styles.searchContainer}>
                    <GooglePlacesAutocomplete 
                        placeholder="Where to?" 
                        onPress={handleSearchSelect} 
                        query={{ key: GOOGLE_API_KEY, language: 'en' }} 
                        fetchDetails={true} 
                        keyboardShouldPersistTaps='handled'
                        enablePoweredByContainer={false}
                        listUnderlayColor="#333"
                        textInputProps={{
                            placeholderTextColor: '#888'
                        }}
                        styles={{ 
                            textInputContainer: {
                                backgroundColor: '#333',
                                borderRadius: 10,
                                paddingHorizontal: 10
                            },
                            textInput: {
                                backgroundColor: '#333',
                                color: 'white',
                                fontSize: 16,
                                height: 50
                            },
                            listView: { 
                                backgroundColor: '#1a1a1a', 
                                zIndex: 1000,
                                borderRadius: 10,
                                marginTop: 5,
                                elevation: 5
                            }, 
                            row: {
                                backgroundColor: '#1a1a1a',
                                padding: 13,
                                height: 60,
                                flexDirection: 'row'
                            },
                            separator: {
                                height: 0.5,
                                backgroundColor: '#333'
                            },
                            description: { 
                                color: 'white',
                                fontSize: 14
                            }, 
                            predefinedPlacesDescription: { 
                                color: '#888' 
                            }
                        }} 
                    />
                    <TouchableOpacity style={styles.pinBtn} onPress={startPinning}>
                        <Ionicons name="map" size={20} color="white" />
                        <Text style={styles.pinText}> Choose on Map</Text>
                    </TouchableOpacity>
                    {savedPlaces.length > 0 && (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.savedPlacesRow}
                      >
                        {savedPlaces.map((place) => (
                          <TouchableOpacity
                            key={place.id}
                            style={styles.savedPlaceChip}
                            onPress={() => chooseSavedPlace(place)}
                            onLongPress={() =>
                              Alert.alert(
                                'Remove Saved Place',
                                `Remove ${String(place.label || 'this place').toUpperCase()}?`,
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  { text: 'Remove', style: 'destructive', onPress: () => removeSavedPlace(place.id) },
                                ]
                              )
                            }
                          >
                            <Ionicons
                              name={place.label === 'home' ? 'home' : place.label === 'work' ? 'briefcase' : 'bookmark'}
                              size={14}
                              color="#D6E0F4"
                            />
                            <Text style={styles.savedPlaceText}>{place.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                </View>
            )}

            {isPinning && (
                <TouchableOpacity style={styles.confirmPinBtn} onPress={confirmPinLocation}>
                    <Text style={styles.confirmPinText}>CONFIRM LOCATION</Text>
                </TouchableOpacity>
            )}

            {(status === 'SELECTING' || status === 'SEARCHING') && !isPinning && (
                <View style={styles.bottomSheetContainer}>
                    <View style={styles.paymentSelector}>
                        <TouchableOpacity 
                            style={[styles.paymentBtn, paymentMode === 'cash' && styles.activePayment]} 
                            onPress={() => setPaymentMode('cash')}
                        >
                            <Text style={[styles.paymentText, paymentMode === 'cash' && {color:'black'}]}>
                                Cash
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                            style={[styles.paymentBtn, paymentMode === 'online' && styles.activePayment]} 
                            onPress={() => setPaymentMode('online')}
                        >
                            <Text style={[styles.paymentText, paymentMode === 'online' && {color:'black'}]}>
                                Online
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {!!destination && (
                      <View style={styles.savedActionsRow}>
                        <TouchableOpacity
                          style={[styles.savedActionBtn, savingPlace && styles.savedActionBtnDisabled]}
                          disabled={savingPlace}
                          onPress={() => saveCurrentDestinationAs('home')}
                        >
                          <Ionicons name="home" size={15} color="white" />
                          <Text style={styles.savedActionText}>Save Home</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.savedActionBtn, savingPlace && styles.savedActionBtnDisabled]}
                          disabled={savingPlace}
                          onPress={() => saveCurrentDestinationAs('work')}
                        >
                          <Ionicons name="briefcase" size={15} color="white" />
                          <Text style={styles.savedActionText}>Save Work</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    
                    {(isRouting || isEstimating) ? (
                        <ActivityIndicator size="large" color={colors.primary} style={{height: 150}} />
                    ) : (
                        <RideRequestPanel 
                            fare={routeInfo.fare} 
                            distance={routeInfo.distance} 
                            duration={routeInfo.duration} 
                            onApplyPromo={applyPromoForRoute}
                            isSearching={status === 'SEARCHING'} 
                            onCancel={() => { 
                                setStatus('IDLE'); 
                                setDestination(null); 
                            }} 
                            onRequest={requestRide} 
                        />
                    )}
                </View>
            )}
            
            {(status === 'ACCEPTED' || status === 'ONGOING') && activeBooking && (
                <>
                    <TouchableOpacity style={styles.sosBtn} onPress={handleSOS}>
                        <Text style={styles.sosText}>SOS</Text>
                    </TouchableOpacity>
                    
                    <Animated.View
                         style={[
                           styles.driverInfoCard,
                           {
                             transform: [
                               {
                                 translateY: rideCardAnim.interpolate({
                                   inputRange: [0, 1],
                                   outputRange: [60, 0],
                                 }),
                               },
                             ],
                             opacity: rideCardAnim,
                           },
                         ]}
                    >
                         <View style={styles.driverHeader}>
                             <View style={styles.avatar}>
                                 <Text style={{fontSize:20}}>🚘</Text>
                             </View>
                             <View style={{marginLeft: 15}}>
                                 <Text style={styles.driverName}>
                                     {activeBooking.driverName || 'Driver'}
                                 </Text>
                                 <Text style={styles.carInfo}>
                                     {activeBooking.carModel}
                                 </Text>
                                 <Text style={styles.rating}>⭐ 5.0</Text>
                             </View>
                         </View>
                         <View style={styles.divider} />
                         <View style={styles.otpBox}>
                             <Text style={styles.otpLabel}>OTP PIN</Text>
                             <Text style={styles.otpCode}>{activeBooking.otp}</Text>
                         </View>
                         
                         <Text style={styles.statusText}>
                             {status === 'ACCEPTED' 
                                 ? `Driver arriving in ~${routeInfo.pickupETA || 5} min` 
                                 : `En route to ${activeBooking.dropAddress || 'destination'}`
                             }
                         </Text>
                         <View style={styles.rideUtilityRow}>
                            <TouchableOpacity
                              style={styles.utilityBtn}
                              onPress={shareLiveTrip}
                              disabled={sharingTrip}
                            >
                              <Ionicons name="share-social" size={16} color="white" />
                              <Text style={styles.utilityText}>{sharingTrip ? 'Sharing...' : 'Share Trip'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.utilityBtn}
                              onPress={() => setShowChatPanel((prev) => !prev)}
                            >
                              <Ionicons name="chatbubble-ellipses" size={16} color="white" />
                              <Text style={styles.utilityText}>Chat</Text>
                            </TouchableOpacity>
                         </View>
                         <TouchableOpacity
                           style={styles.cancelRideBtn}
                           onPress={() => setShowCancelRideModal(true)}
                         >
                           <Ionicons name="close-circle-outline" size={16} color="white" />
                           <Text style={styles.cancelRideText}>Cancel Ride</Text>
                         </TouchableOpacity>
                    </Animated.View>
                </>
            )}
        </>
      )}

      {/* DRIVER UI */}
      {userInfo.role === 'driver' && (
        <>
            {status === 'IDLE' && (
                <View style={styles.driverControls}>
                    <TouchableOpacity 
                        style={[styles.onlineBtn, { 
                            backgroundColor: isDriverOnline ? colors.error : colors.success 
                        }]} 
                        onPress={toggleDriverAvailability}
                    >
                        <Text style={styles.onlineText}>
                            {isDriverOnline ? 'GO OFFLINE' : 'GO ONLINE'}
                        </Text>
                    </TouchableOpacity>
                </View>
            )}
            
            {status === 'ACCEPTED' && (
                <View style={styles.driverControls}>
                    <TouchableOpacity 
                        style={styles.navBtn} 
                        onPress={() => openExternalMap(activeBooking.pickupLat, activeBooking.pickupLng)}
                    >
                        <Text style={styles.navText}>Navigate to Pickup</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={styles.actionBtn} 
                        onPress={() => setShowOtpModal(true)}
                    >
                        <Text style={styles.actionText}>START RIDE</Text>
                    </TouchableOpacity>
                    <View style={styles.driverUtilityRow}>
                      <TouchableOpacity style={styles.utilityBtn} onPress={shareLiveTrip} disabled={sharingTrip}>
                        <Ionicons name="share-social" size={16} color="white" />
                        <Text style={styles.utilityText}>{sharingTrip ? 'Sharing...' : 'Share Trip'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.utilityBtn} onPress={() => setShowChatPanel((prev) => !prev)}>
                        <Ionicons name="chatbubble-ellipses" size={16} color="white" />
                        <Text style={styles.utilityText}>Chat</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={[styles.cancelRideBtn, { width: '80%', marginTop: 10 }]}
                      onPress={() => setShowCancelRideModal(true)}
                    >
                      <Ionicons name="close-circle-outline" size={16} color="white" />
                      <Text style={styles.cancelRideText}>Cancel Ride</Text>
                    </TouchableOpacity>
                </View>
            )}
            
            {status === 'ONGOING' && (
                <View style={styles.driverControls}>
                    <TouchableOpacity 
                        style={styles.navBtn} 
                        onPress={() => openExternalMap(activeBooking.dropLat, activeBooking.dropLng)}
                    >
                        <Text style={styles.navText}>Navigate to Drop</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                        style={[styles.actionBtn, {backgroundColor: colors.error}]} 
                        onPress={endRide}
                    >
                        <Text style={styles.actionText}>END RIDE</Text>
                    </TouchableOpacity>
                    <View style={styles.driverUtilityRow}>
                      <TouchableOpacity style={styles.utilityBtn} onPress={shareLiveTrip} disabled={sharingTrip}>
                        <Ionicons name="share-social" size={16} color="white" />
                        <Text style={styles.utilityText}>{sharingTrip ? 'Sharing...' : 'Share Trip'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.utilityBtn} onPress={() => setShowChatPanel((prev) => !prev)}>
                        <Ionicons name="chatbubble-ellipses" size={16} color="white" />
                        <Text style={styles.utilityText}>Chat</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={[styles.cancelRideBtn, { width: '80%', marginTop: 10 }]}
                      onPress={() => setShowCancelRideModal(true)}
                    >
                      <Ionicons name="close-circle-outline" size={16} color="white" />
                      <Text style={styles.cancelRideText}>Cancel Ride</Text>
                    </TouchableOpacity>
                </View>
            )}
            
            <DriverRequestModal 
                visible={!!incomingRequest} 
                request={incomingRequest} 
                onAccept={acceptRide} 
                onReject={rejectRide} 
            />
            <OTPModal 
                visible={showOtpModal} 
                onSubmit={startRide} 
                onCancel={() => setShowOtpModal(false)} 
            />
        </>
      )}

      {(status === 'ACCEPTED' || status === 'ONGOING') && activeBooking && (
        <>
          <TouchableOpacity
            style={styles.chatFab}
            onPress={() => setShowChatPanel((prev) => !prev)}
          >
            <Ionicons name={showChatPanel ? 'close' : 'chatbubble-ellipses'} size={22} color="white" />
          </TouchableOpacity>

          <RideChatPanel
            visible={showChatPanel}
            messages={chatMessages}
            draft={chatDraft}
            onDraftChange={setChatDraft}
            onSend={sendRideChat}
            onClose={() => setShowChatPanel(false)}
            currentRole={userInfo.role}
          />
        </>
      )}
      
      <CancelRideModal 
          visible={showCancelRideModal}
          role={userInfo.role}
          loading={cancelRideLoading}
          onClose={() => setShowCancelRideModal(false)}
          onSubmit={submitRideCancellation}
      />
      
      {/* 🟢 FIX: Modified RatingModal with proper close handler */}
      <RatingModal 
          visible={showRatingModal} 
          onSubmit={submitRating} 
          onClose={handleRatingClose}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  map: { flex: 1 },
  loading: { 
      flex: 1, 
      justifyContent:'center', 
      alignItems:'center', 
      backgroundColor:'black' 
  },
  menuBtn: { 
      position: 'absolute', 
      top: 50, 
      left: 20, 
      zIndex: 20, 
      backgroundColor: 'white', 
      padding: 10, 
      borderRadius: 25, 
      elevation: 5 
  },
  locateBtn: {
      position: 'absolute',
      top: 120,
      right: 20,
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(15, 24, 35, 0.9)',
      borderWidth: 1,
      borderColor: '#2A364B',
      zIndex: 25,
  },
  sosBtn: { 
      position: 'absolute', 
      top: 50, 
      right: 20, 
      backgroundColor: 'red', 
      width: 60, 
      height: 60, 
      borderRadius: 30, 
      justifyContent: 'center', 
      alignItems: 'center', 
      elevation: 10, 
      zIndex: 50, 
      borderWidth: 2, 
      borderColor: 'white' 
  },
  sosText: { color: 'white', fontWeight: 'bold', fontSize: 18 },
  searchContainer: { 
      position: 'absolute', 
      top: 100, 
      width: '90%', 
      alignSelf: 'center', 
      zIndex: 10 
  },
  savedPlacesRow: {
      marginTop: 10,
      paddingBottom: 2,
      gap: 8,
  },
  savedPlaceChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(32, 45, 68, 0.92)',
      borderColor: '#3A4A66',
      borderWidth: 1,
      borderRadius: 18,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginRight: 8,
  },
  savedPlaceText: {
      color: '#D6E0F4',
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'capitalize',
  },
  bottomSheetContainer: { 
      position: 'absolute', 
      bottom: 0, 
      width: '100%' 
  },
  paymentSelector: { 
      flexDirection: 'row', 
      justifyContent: 'center', 
      marginBottom: 10, 
      backgroundColor: '#1a1a1a', 
      padding: 10, 
      borderRadius: 15, 
      width: '90%', 
      alignSelf: 'center', 
      borderWidth: 1, 
      borderColor: '#333' 
  },
  savedActionsRow: {
      width: '90%',
      alignSelf: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
      gap: 10,
  },
  savedActionBtn: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 6,
      backgroundColor: '#2A3550',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: '#3D4A6B',
      paddingVertical: 9,
  },
  savedActionBtnDisabled: {
      opacity: 0.6,
  },
  savedActionText: {
      color: 'white',
      fontWeight: '700',
      fontSize: 12,
  },
  paymentBtn: { 
      flexDirection: 'row', 
      alignItems: 'center', 
      paddingVertical: 8, 
      paddingHorizontal: 20, 
      borderRadius: 20, 
      marginHorizontal: 10, 
      borderWidth: 1, 
      borderColor: '#444' 
  },
  activePayment: { 
      backgroundColor: colors.primary, 
      borderColor: colors.primary 
  },
  paymentText: { 
      color: 'white', 
      fontWeight: 'bold', 
      marginLeft: 5 
  },
  driverInfoCard: { 
      position: 'absolute', 
      bottom: 30, 
      width: '90%', 
      alignSelf: 'center', 
      backgroundColor: '#1a1a1a', 
      padding: 20, 
      borderRadius: 15, 
      borderWidth: 1, 
      borderColor: '#333', 
      shadowColor:'#000', 
      elevation:10 
  },
  driverHeader: { 
      flexDirection: 'row', 
      alignItems: 'center' 
  },
  avatar: { 
      width: 50, 
      height: 50, 
      borderRadius: 25, 
      backgroundColor: '#333', 
      justifyContent: 'center', 
      alignItems: 'center' 
  },
  driverName: { 
      color: 'white', 
      fontSize: 18, 
      fontWeight: 'bold' 
  },
  carInfo: { 
      color: '#888', 
      fontSize: 14, 
      marginTop: 2 
  },
  rating: { 
      color: colors.success, 
      fontSize: 12, 
      marginTop: 2 
  },
  divider: { 
      width: '100%', 
      height: 1, 
      backgroundColor: '#333', 
      marginVertical: 15 
  },
  otpBox: { 
      flexDirection: 'row', 
      justifyContent: 'space-between', 
      alignItems: 'center', 
      backgroundColor: '#333', 
      padding: 10, 
      borderRadius: 8 
  },
  otpLabel: { 
      color: '#888', 
      fontWeight: 'bold' 
  },
  otpCode: { 
      color: colors.primary, 
      fontSize: 24, 
      fontWeight: 'bold', 
      letterSpacing: 5 
  },
  statusText: { 
      color: colors.success, 
      textAlign: 'center', 
      marginTop: 15, 
      fontStyle: 'italic' 
  },
  rideUtilityRow: {
      flexDirection: 'row',
      marginTop: 14,
      justifyContent: 'space-between',
      gap: 10,
  },
  driverUtilityRow: {
      width: '80%',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
  },
  utilityBtn: {
      flex: 1,
      backgroundColor: '#263044',
      borderRadius: 9,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: '#31405E',
  },
  utilityText: {
      color: 'white',
      fontWeight: '700',
      fontSize: 12,
  },
  cancelRideBtn: {
      marginTop: 12,
      backgroundColor: '#B12531',
      borderRadius: 10,
      paddingVertical: 11,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: '#D94857',
  },
  cancelRideText: {
      color: 'white',
      fontWeight: '800',
      fontSize: 12,
      letterSpacing: 0.3,
  },
  driverControls: { 
      position: 'absolute', 
      bottom: 50, 
      alignSelf: 'center', 
      width: '100%', 
      alignItems:'center' 
  },
  onlineBtn: { 
      width: 200, 
      padding: 15, 
      borderRadius: 30, 
      alignItems: 'center', 
      shadowColor:'black', 
      elevation:5 
  },
  onlineText: { 
      color: 'black', 
      fontWeight: 'bold', 
      fontSize: 16 
  },
  actionBtn: { 
      width: '80%', 
      backgroundColor: colors.primary, 
      padding: 20, 
      borderRadius: 10, 
      alignItems: 'center', 
      elevation: 10, 
      marginBottom: 10 
  },
  actionText: { 
      color: 'black', 
      fontWeight: '900', 
      fontSize: 18 
  },
  navBtn: { 
      flexDirection:'row', 
      backgroundColor: '#4285F4', 
      padding: 12, 
      borderRadius: 25, 
      alignItems: 'center', 
      justifyContent:'center', 
      marginBottom: 15, 
      width: 140 
  },
  navText: { 
      color: 'white', 
      fontWeight: 'bold', 
      marginLeft: 5 
  },
  chatFab: {
      position: 'absolute',
      right: 20,
      bottom: 140,
      width: 54,
      height: 54,
      borderRadius: 27,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#2683FF',
      elevation: 14,
      zIndex: 150,
  },
  centerMarker: { 
      position: 'absolute', 
      top: '50%', 
      left: '50%', 
      marginTop: -35, 
      marginLeft: -20, 
      zIndex: 100 
  },
  confirmPinBtn: { 
      position: 'absolute', 
      bottom: 50, 
      width: '80%', 
      alignSelf: 'center', 
      backgroundColor: colors.primary, 
      padding: 15, 
      borderRadius: 10, 
      alignItems: 'center', 
      zIndex:20 
  },
  confirmPinText: { 
      color: 'black', 
      fontWeight: 'bold', 
      fontSize: 16 
  },
  pinBtn: { 
      backgroundColor: '#444', 
      padding: 12, 
      borderRadius: 8, 
      flexDirection: 'row', 
      alignItems: 'center', 
      justifyContent:'center', 
      marginTop: 10 
  },
  pinText: { 
      color: 'white', 
      fontSize: 14, 
      fontWeight: 'bold' 
  },
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
