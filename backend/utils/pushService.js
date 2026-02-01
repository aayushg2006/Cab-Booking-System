const { Expo } = require('expo-server-sdk');
const expo = new Expo();

const sendPushNotification = async (pushToken, messageText, data = {}) => {
    if (!Expo.isExpoPushToken(pushToken)) {
        console.error(`❌ Invalid Expo Push Token: ${pushToken}`);
        return;
    }

    const messages = [{
        to: pushToken,
        sound: 'default',
        title: '🚖 Cab App Update',
        body: messageText,
        data: data,
    }];

    try {
        await expo.sendPushNotificationsAsync(messages);
        console.log(`✅ Notification sent to ${pushToken}`);
    } catch (error) {
        console.error("❌ Error sending push:", error);
    }
};

module.exports = { sendPushNotification };