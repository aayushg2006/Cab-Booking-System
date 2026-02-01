import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Configure how notifications appear when app is OPEN
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotificationsAsync() {
  let token = null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      alert('Failed to get push token for push notification!');
      return null;
    }
    
    // 🛡️ CRITICAL FIX: Graceful Failure for Expo Go
    try {
        // Attempt to get the ID from app config, or fallback safely
        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.expoConfig?.slug;

        token = (await Notifications.getExpoPushTokenAsync({
            projectId: projectId, // Pass ID if available
        })).data;
        
        console.log("🔔 Expo Push Token:", token);
    } catch (e) {
        // If this fails (common in Expo Go SDK 53+), we catch it and continue.
        // This prevents the Login screen from freezing.
        console.warn("⚠️ Push Notification Warning: Could not get token.", e.message);
        console.log("👉 Note: Remote Notifications require a 'Development Build' in Expo SDK 53+.");
        token = null; 
    }
  } else {
    // alert('Must use physical device for Push Notifications');
  }

  return token;
}