import React, { useState } from 'react';
import { View, Text, Modal, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';

const OTPModal = ({ visible, onSubmit, onCancel }) => {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (otp.length !== 4) return alert("Enter valid 4-digit OTP");
    setLoading(true);
    await onSubmit(otp);
    setLoading(false);
    setOtp('');
  };

  return (
    <Modal transparent visible={visible} animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>Start Ride</Text>
          <Text style={styles.subtitle}>Ask Rider for the 4-digit PIN</Text>
          
          <TextInput 
            style={styles.input} 
            placeholder="0000" 
            placeholderTextColor="#555"
            keyboardType="number-pad"
            maxLength={4}
            value={otp}
            onChangeText={setOtp}
            autoFocus
          />

          <View style={styles.buttons}>
            <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>CANCEL</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSubmit} style={styles.submitBtn}>
              {loading ? <ActivityIndicator color="black" /> : <Text style={styles.submitText}>START</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  container: { backgroundColor: '#1a1a1a', padding: 25, borderRadius: 15, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  title: { color: colors.primary, fontSize: 24, fontWeight: 'bold', marginBottom: 5 },
  subtitle: { color: '#888', marginBottom: 20 },
  input: { backgroundColor: 'black', width: '100%', color: 'white', fontSize: 32, textAlign: 'center', letterSpacing: 10, padding: 15, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, marginBottom: 20 },
  buttons: { flexDirection: 'row', width: '100%', justifyContent: 'space-between' },
  cancelBtn: { flex: 1, padding: 15, alignItems: 'center' },
  submitBtn: { flex: 1, backgroundColor: colors.success, padding: 15, borderRadius: 10, alignItems: 'center' },
  cancelText: { color: 'white', fontWeight: 'bold' },
  submitText: { color: 'black', fontWeight: 'bold' }
});

export default OTPModal;