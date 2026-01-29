import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';

const PaymentScreen = ({ route, navigation }) => {
  const { fare } = route.params || { fare: '0.00' };
  const [loading, setLoading] = useState(false);

  const handlePay = async () => {
    setLoading(true);
    // Simulate Payment Delay
    setTimeout(() => {
        setLoading(false);
        Alert.alert("Success", "Payment Successful!", [
            { text: "OK", onPress: () => navigation.navigate('Map') }
        ]);
    }, 2000);
  };

  return (
    <View style={styles.container}>
      <Ionicons name="card" size={80} color={colors.primary} style={{marginBottom: 20}} />
      <Text style={styles.title}>Payment Due</Text>
      <Text style={styles.amount}>₹{fare}</Text>
      
      <View style={styles.cardInfo}>
        <Text style={styles.cardText}>💳  •••• •••• •••• 4242</Text>
      </View>

      <TouchableOpacity style={styles.payBtn} onPress={handlePay}>
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