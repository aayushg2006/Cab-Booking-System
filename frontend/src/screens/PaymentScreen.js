import React, { useState, useContext } from 'react'; // 1. Import useContext
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext'; // 2. Import AuthContext
import client from '../api/client'; // 3. Import Client

const PaymentScreen = ({ route, navigation }) => {
  // 4. Get bookingId and fare from navigation params
  const { fare, bookingId } = route.params || { fare: '0.00', bookingId: null };
  
  const { userToken } = useContext(AuthContext); // 5. Get Token
  const [loading, setLoading] = useState(false);

  const handlePay = async () => {
    if (!bookingId) {
        Alert.alert("Error", "Invalid Booking ID");
        return;
    }

    setLoading(true);
    try {
        // 6. Call the API
        await client.post('/bookings/pay', 
            { bookingId }, 
            { headers: { Authorization: `Bearer ${userToken}` } }
        );

        Alert.alert("Success", "Payment Successful!", [
            { text: "OK", onPress: () => navigation.navigate('Map') }
        ]);

    } catch (err) {
        console.log("Payment Error:", err);
        Alert.alert("Error", "Payment failed. Please try again.");
    } finally {
        setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Ionicons name="card" size={80} color={colors.primary} style={{marginBottom: 20}} />
      <Text style={styles.title}>Payment Due</Text>
      <Text style={styles.amount}>₹{fare}</Text>
      
      <View style={styles.cardInfo}>
        <Text style={styles.cardText}>💳  •••• •••• •••• 4242</Text>
      </View>

      <TouchableOpacity style={styles.payBtn} onPress={handlePay} disabled={loading}>
        {loading ? (
            <ActivityIndicator color="black" />
        ) : (
            <Text style={styles.payText}>PAY NOW</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 30 },
  title: { color: 'white', fontSize: 24, fontWeight: 'bold' },
  amount: { color: colors.success, fontSize: 48, fontWeight: '900', marginVertical: 20 },
  cardInfo: { backgroundColor: '#333', padding: 20, borderRadius: 10, width: '100%', alignItems: 'center', marginBottom: 40 },
  cardText: { color: 'white', fontSize: 18 },
  payBtn: { backgroundColor: colors.primary, width: '100%', padding: 20, borderRadius: 15, alignItems: 'center' },
  payText: { color: 'black', fontWeight: '900', fontSize: 18 }
});

export default PaymentScreen;