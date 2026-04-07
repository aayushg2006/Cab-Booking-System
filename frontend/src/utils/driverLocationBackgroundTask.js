import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SERVER_URL } from '../api/client';

export const DRIVER_BACKGROUND_LOCATION_TASK = 'driver-background-location-task';
const DRIVER_BG_STATE_KEY = 'driver_bg_tracking_state';

if (!TaskManager.isTaskDefined(DRIVER_BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(DRIVER_BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.log('[BG-LOCATION] Task error:', error.message);
      return;
    }

    const locations = data?.locations;
    if (!locations || locations.length === 0) return;

    try {
      const stateRaw = await AsyncStorage.getItem(DRIVER_BG_STATE_KEY);
      if (!stateRaw) return;

      const state = JSON.parse(stateRaw);
      if (!state?.enabled || !state?.token || !state?.driverId) return;

      const latest = locations[locations.length - 1];
      const latitude = latest?.coords?.latitude;
      const longitude = latest?.coords?.longitude;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') return;

      await fetch(`${SERVER_URL}/api/bookings/driver-location`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          driverId: state.driverId,
          lat: latitude,
          lng: longitude,
          source: 'background',
        }),
      });
    } catch (taskErr) {
      console.log('[BG-LOCATION] Update failed:', taskErr?.message || taskErr);
    }
  });
}

export const setBackgroundDriverTrackingState = async (state) => {
  await AsyncStorage.setItem(DRIVER_BG_STATE_KEY, JSON.stringify(state));
};

export const ensureBackgroundDriverTracking = async () => {
  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK);
  if (started) return;

  await Location.startLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 5000,
    distanceInterval: 10,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    foregroundService: {
      notificationTitle: 'RideX location sharing active',
      notificationBody: 'Tracking location for live ride updates.',
    },
    showsBackgroundLocationIndicator: false,
  });
};

export const stopBackgroundDriverTracking = async () => {
  const started = await Location.hasStartedLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK);
  if (!started) return;
  await Location.stopLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK);
};
