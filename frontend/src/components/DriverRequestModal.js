import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { colors } from '../theme/colors';

const DriverRequestModal = ({ visible, request, onAccept, onReject }) => {
  if (!request) return null;

  return (
    <Modal transparent={true} visible={visible} animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>NEW RIDE REQUEST! ⚡</Text>
          
          <View style={styles.infoBox}>
            <Text style={styles.label}>PICKUP</Text>
            <Text style={styles.address}>{request.pickupAddress || 'Unknown Location'}</Text>
            
            <View style={{height: 10}} />
            
            <Text style={styles.label}>FARE</Text>
            <Text style={styles.fare}>₹{request.fare}</Text>

            {!!request.scheduledFor && (
              <Text style={styles.meta}>Scheduled: {new Date(request.scheduledFor).toLocaleString()}</Text>
            )}
            {!!request.promoCode && (
              <Text style={styles.meta}>Promo: {request.promoCode} (-₹{Math.round(request.discountAmount || 0)})</Text>
            )}

            {Array.isArray(request.ridePreferences) && request.ridePreferences.length > 0 && (
              <View style={styles.prefBox}>
                <Text style={styles.prefTitle}>Rider Preferences</Text>
                <Text style={styles.prefText}>{request.ridePreferences.join(', ')}</Text>
              </View>
            )}

            {!!request.specialInstructions && (
              <View style={styles.prefBox}>
                <Text style={styles.prefTitle}>Note</Text>
                <Text style={styles.prefText}>{request.specialInstructions}</Text>
              </View>
            )}
            
            {request.surgeMultiplier > 1 && (
                 <Text style={styles.surge}>⚡ Surge {request.surgeMultiplier}x Active</Text>
            )}
          </View>

          <View style={styles.buttons}>
            <TouchableOpacity style={styles.rejectBtn} onPress={onReject}>
              <Text style={styles.btnText}>REJECT</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptBtn} onPress={onAccept}>
              <Text style={styles.acceptText}>ACCEPT RIDE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { backgroundColor: '#1a1a1a', padding: 25, borderTopLeftRadius: 25, borderTopRightRadius: 25 },
  title: { color: colors.primary, fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: 20 },
  infoBox: { backgroundColor: '#2a2a2a', padding: 15, borderRadius: 12, marginBottom: 20 },
  label: { color: '#888', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  address: { color: 'white', fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  fare: { color: colors.success, fontSize: 24, fontWeight: 'bold' },
  meta: { color: '#B9C2D8', fontSize: 12, marginTop: 4 },
  prefBox: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#3A4255' },
  prefTitle: { color: '#A3ADC5', fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  prefText: { color: '#E0E5F2', fontSize: 12, marginTop: 2 },
  surge: { color: '#FFD700', fontWeight: 'bold', marginTop: 5 },
  buttons: { flexDirection: 'row', justifyContent: 'space-between' },
  rejectBtn: { flex: 1, backgroundColor: '#333', padding: 18, borderRadius: 12, marginRight: 10, alignItems: 'center' },
  acceptBtn: { flex: 2, backgroundColor: colors.success, padding: 18, borderRadius: 12, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: 'bold' },
  acceptText: { color: 'black', fontWeight: '900', fontSize: 16 }
});

export default DriverRequestModal;
