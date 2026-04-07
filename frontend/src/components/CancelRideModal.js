import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

const RIDER_REASONS = [
  'Driver is too far',
  'Driver asked to cancel',
  'Pickup location changed',
  'Changed my plan',
  'Other',
];

const DRIVER_REASONS = [
  'Rider not reachable',
  'Rider requested cancellation',
  'Vehicle issue',
  'Road blocked / heavy traffic',
  'Other',
];

const CancelRideModal = ({ visible, role, loading, onClose, onSubmit }) => {
  const reasonOptions = useMemo(
    () => (role === 'driver' ? DRIVER_REASONS : RIDER_REASONS),
    [role]
  );

  const [selectedReason, setSelectedReason] = useState(reasonOptions[0]);
  const [customReason, setCustomReason] = useState('');

  useEffect(() => {
    if (!visible) return;
    setSelectedReason(reasonOptions[0]);
    setCustomReason('');
  }, [visible, reasonOptions]);

  const requiresCustomReason = selectedReason === 'Other';
  const finalReason = requiresCustomReason ? customReason.trim() : selectedReason;
  const canSubmit = !loading && finalReason.length >= 3;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(finalReason);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Cancel Ride</Text>
            <TouchableOpacity onPress={onClose} disabled={loading}>
              <Ionicons name="close" size={22} color="#AAB3C2" />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>Please select a reason</Text>

          <View style={styles.reasonList}>
            {reasonOptions.map((reason) => {
              const selected = selectedReason === reason;
              return (
                <TouchableOpacity
                  key={reason}
                  style={[styles.reasonChip, selected && styles.reasonChipActive]}
                  onPress={() => setSelectedReason(reason)}
                  disabled={loading}
                >
                  <Text style={[styles.reasonText, selected && styles.reasonTextActive]}>{reason}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {requiresCustomReason && (
            <TextInput
              value={customReason}
              onChangeText={setCustomReason}
              style={styles.customInput}
              placeholder="Write reason..."
              placeholderTextColor="#7B8595"
              maxLength={180}
              multiline
            />
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.keepBtn} onPress={onClose} disabled={loading}>
              <Text style={styles.keepText}>KEEP RIDE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelBtn, !canSubmit && styles.disabledBtn]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.cancelText}>CANCEL RIDE</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#121722',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#243147',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: 'white',
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    color: '#98A3B7',
    marginTop: 8,
    marginBottom: 12,
    fontSize: 14,
  },
  reasonList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reasonChip: {
    borderWidth: 1,
    borderColor: '#2D3A53',
    backgroundColor: '#1A2233',
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  reasonChipActive: {
    backgroundColor: '#2C69D7',
    borderColor: '#2C69D7',
  },
  reasonText: {
    color: '#D2D8E2',
    fontWeight: '600',
    fontSize: 13,
  },
  reasonTextActive: {
    color: 'white',
  },
  customInput: {
    marginTop: 12,
    minHeight: 70,
    maxHeight: 120,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#31405E',
    backgroundColor: '#1A2233',
    color: 'white',
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 10,
  },
  keepBtn: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: '#25314A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  keepText: {
    color: '#CFD6E4',
    fontWeight: '700',
    fontSize: 13,
  },
  cancelBtn: {
    flex: 1.2,
    borderRadius: 10,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  cancelText: {
    color: 'white',
    fontWeight: '800',
    fontSize: 13,
  },
  disabledBtn: {
    opacity: 0.55,
  },
});

export default CancelRideModal;
