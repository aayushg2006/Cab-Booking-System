import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from 'react-native';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';

const CAR_TYPES = [
  { id: 'hatchback', name: 'Mini', multiplier: 1, icon: 'car-sport' },
  { id: 'sedan', name: 'Sedan', multiplier: 1.4, icon: 'car' },
  { id: 'suv', name: 'SUV', multiplier: 1.9, icon: 'bus' },
];

const SCHEDULE_OPTIONS = [
  { id: 'now', label: 'Now', offsetMinutes: 0 },
  { id: '15', label: '+15m', offsetMinutes: 15 },
  { id: '30', label: '+30m', offsetMinutes: 30 },
];

const PREFERENCE_OPTIONS = [
  { id: 'quiet_ride', label: 'Quiet Ride' },
  { id: 'ac_required', label: 'AC Required' },
  { id: 'pet_friendly', label: 'Pet Friendly' },
  { id: 'extra_luggage', label: 'Extra Luggage' },
];

const RideRequestPanel = ({
  fare,
  distance,
  duration,
  onCancel,
  onRequest,
  onApplyPromo,
  isSearching,
}) => {
  const [selectedCar, setSelectedCar] = useState(
    CAR_TYPES.find((car) => car.id === 'sedan') || CAR_TYPES[0]
  );
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoPreview, setPromoPreview] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [scheduleOptionId, setScheduleOptionId] = useState('now');
  const [ridePreferences, setRidePreferences] = useState([]);
  const [specialInstructions, setSpecialInstructions] = useState('');

  useEffect(() => {
    setPromoPreview(null);
  }, [selectedCar.id, fare]);

  const baseFare = useMemo(
    () => Math.round(Number(fare || 0) * Number(selectedCar.multiplier || 1)),
    [fare, selectedCar.multiplier]
  );
  const displayFare = useMemo(() => {
    if (
      promoPreview &&
      promoPreview.promoCode === promoCodeInput.trim().toUpperCase() &&
      promoPreview.carType === selectedCar.id
    ) {
      return Math.round(Number(promoPreview.finalFare || baseFare));
    }
    return baseFare;
  }, [baseFare, promoCodeInput, promoPreview, selectedCar.id]);

  const selectedSchedule = useMemo(
    () => SCHEDULE_OPTIONS.find((item) => item.id === scheduleOptionId) || SCHEDULE_OPTIONS[0],
    [scheduleOptionId]
  );

  const togglePreference = (preferenceId) => {
    setRidePreferences((prev) => {
      if (prev.includes(preferenceId)) {
        return prev.filter((item) => item !== preferenceId);
      }
      return [...prev, preferenceId];
    });
  };

  const applyPromoCode = async () => {
    const promoCode = promoCodeInput.trim().toUpperCase();
    if (!promoCode) return;
    if (!onApplyPromo) return;

    setPromoLoading(true);
    try {
      const promoResult = await onApplyPromo(promoCode, selectedCar.id);
      if (!promoResult) {
        setPromoPreview(null);
        return;
      }
      setPromoPreview({
        ...promoResult,
        promoCode,
        carType: selectedCar.id,
      });
    } finally {
      setPromoLoading(false);
    }
  };

  const handleRequest = () => {
    onRequest(selectedCar.id, displayFare, {
      promoCode:
        promoPreview &&
        promoPreview.promoCode === promoCodeInput.trim().toUpperCase() &&
        promoPreview.carType === selectedCar.id
          ? promoPreview.promoCode
          : null,
      scheduleOffsetMinutes: selectedSchedule.offsetMinutes,
      ridePreferences,
      specialInstructions: specialInstructions.trim(),
    });
  };

  return (
    <View style={styles.panel}>
      <View style={styles.handle} />
      
      <Text style={styles.title}>Choose a Ride</Text>

      {/* Car Category Selector */}
      <View style={styles.carSelectorContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {CAR_TYPES.map((car) => (
            <TouchableOpacity 
              key={car.id} 
              style={[styles.carCard, selectedCar.id === car.id && styles.selectedCard]}
              onPress={() => setSelectedCar(car)}
            >
              <Ionicons name={car.icon} size={30} color={selectedCar.id === car.id ? 'black' : 'white'} />
              <Text style={[styles.carName, selectedCar.id === car.id && styles.selectedText]}>{car.name}</Text>
              <Text style={[styles.carPrice, selectedCar.id === car.id && styles.selectedText]}>
                ₹{Math.round(fare * car.multiplier)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.label}>Distance</Text>
        <Text style={styles.value}>{distance} km</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>ETA</Text>
        <Text style={styles.value}>{duration} min</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Base Fare</Text>
        <Text style={styles.value}>₹{baseFare}</Text>
      </View>
      {promoPreview && promoPreview.discountAmount > 0 && (
        <View style={styles.row}>
          <Text style={styles.label}>Promo Discount</Text>
          <Text style={styles.discountText}>-₹{Math.round(promoPreview.discountAmount)}</Text>
        </View>
      )}
      
      <View style={styles.row}>
        <Text style={styles.label}>Total Fare</Text>
        <Text style={styles.price}>₹{displayFare}</Text>
      </View>

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>Schedule</Text>
      <View style={styles.scheduleRow}>
        {SCHEDULE_OPTIONS.map((option) => {
          const selected = option.id === scheduleOptionId;
          return (
            <TouchableOpacity
              key={option.id}
              style={[styles.scheduleBtn, selected && styles.scheduleBtnActive]}
              onPress={() => setScheduleOptionId(option.id)}
            >
              <Text style={[styles.scheduleText, selected && styles.scheduleTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Promo Code</Text>
      <View style={styles.promoRow}>
        <TextInput
          value={promoCodeInput}
          onChangeText={(text) => {
            setPromoCodeInput(text);
            if (!text.trim()) setPromoPreview(null);
          }}
          placeholder="WELCOME50"
          placeholderTextColor="#7D8594"
          autoCapitalize="characters"
          style={styles.promoInput}
          maxLength={20}
        />
        <TouchableOpacity
          style={[styles.applyBtn, (!promoCodeInput.trim() || promoLoading) && styles.disabledBtn]}
          onPress={applyPromoCode}
          disabled={!promoCodeInput.trim() || promoLoading}
        >
          {promoLoading ? (
            <ActivityIndicator size="small" color="black" />
          ) : (
            <Text style={styles.applyText}>Apply</Text>
          )}
        </TouchableOpacity>
      </View>
      {promoPreview?.title &&
      promoPreview.carType === selectedCar.id &&
      promoPreview.promoCode === promoCodeInput.trim().toUpperCase() ? (
        <Text style={styles.promoHint}>{promoPreview.title} applied</Text>
      ) : (
        <Text style={styles.promoHint}>Optional: use a promo code for discounts</Text>
      )}

      <Text style={styles.sectionTitle}>Ride Preferences</Text>
      <View style={styles.prefWrap}>
        {PREFERENCE_OPTIONS.map((option) => {
          const selected = ridePreferences.includes(option.id);
          return (
            <TouchableOpacity
              key={option.id}
              style={[styles.prefChip, selected && styles.prefChipActive]}
              onPress={() => togglePreference(option.id)}
            >
              <Text style={[styles.prefText, selected && styles.prefTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Note for Driver</Text>
      <TextInput
        value={specialInstructions}
        onChangeText={setSpecialInstructions}
        style={styles.instructionsInput}
        placeholder="Pickup gate, landmark, etc."
        placeholderTextColor="#7D8594"
        maxLength={140}
        multiline
      />

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity 
            style={styles.confirmBtn} 
            onPress={handleRequest}
            disabled={isSearching || promoLoading}
        >
          {isSearching ? (
             <View style={{flexDirection:'row', alignItems:'center'}}>
               <ActivityIndicator color="black" style={{marginRight:10}} />
               <Text style={styles.confirmText}>FINDING DRIVER...</Text>
             </View>
          ) : (
             <Text style={styles.confirmText}>CONFIRM {selectedCar.name.toUpperCase()}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    width: '100%',
    backgroundColor: colors.secondary, 
    borderTopLeftRadius: 20, 
    borderTopRightRadius: 20,
    padding: 20, 
    paddingBottom: 40, 
    alignItems: 'center',
    shadowColor: '#000', 
    shadowOpacity: 0.5, 
    shadowRadius: 10, 
    elevation: 15
  },
  handle: { width: 50, height: 5, backgroundColor: '#444', borderRadius: 5, marginBottom: 15 },
  title: { color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
  
  carSelectorContainer: { height: 110, marginBottom: 10, width: '100%' },
  carCard: { 
      backgroundColor: '#333', width: 100, height: 100, borderRadius: 12, 
      marginRight: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#444' 
  },
  selectedCard: { backgroundColor: colors.primary, borderColor: colors.primary },
  carName: { color: 'white', marginTop: 5, fontWeight: 'bold' },
  carPrice: { color: '#ccc', fontSize: 12, marginTop: 2 },
  selectedText: { color: 'black' },

  divider: { width: '100%', height: 1, backgroundColor: '#444', marginBottom: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 10 },
  label: { color: colors.textDim, fontSize: 16 },
  value: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
  discountText: { color: colors.success, fontSize: 16, fontWeight: 'bold' },
  price: { color: colors.success, fontSize: 22, fontWeight: 'bold' },
  sectionTitle: { alignSelf: 'flex-start', color: '#A7B2C8', fontSize: 12, fontWeight: 'bold', marginBottom: 8, marginTop: 4, letterSpacing: 0.6 },
  scheduleRow: { width: '100%', flexDirection: 'row', gap: 8, marginBottom: 12 },
  scheduleBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#3A465C',
    borderRadius: 9,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#273145',
  },
  scheduleBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  scheduleText: { color: 'white', fontWeight: '700', fontSize: 12 },
  scheduleTextActive: { color: 'black' },
  promoRow: { width: '100%', flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  promoInput: {
    flex: 1,
    backgroundColor: '#242A35',
    borderColor: '#3A4456',
    borderWidth: 1,
    borderRadius: 9,
    color: 'white',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 8,
    fontWeight: '600',
  },
  applyBtn: {
    backgroundColor: colors.primary,
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minWidth: 70,
    alignItems: 'center',
  },
  disabledBtn: { opacity: 0.6 },
  applyText: { color: 'black', fontWeight: '800', fontSize: 12 },
  promoHint: { alignSelf: 'flex-start', color: '#7D8594', fontSize: 11, marginBottom: 10 },
  prefWrap: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  prefChip: {
    backgroundColor: '#263044',
    borderColor: '#374660',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  prefChipActive: {
    backgroundColor: '#2D6EEA',
    borderColor: '#2D6EEA',
  },
  prefText: { color: '#D2D8E2', fontSize: 12, fontWeight: '600' },
  prefTextActive: { color: 'white' },
  instructionsInput: {
    width: '100%',
    minHeight: 52,
    maxHeight: 90,
    borderColor: '#374660',
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#242A35',
    color: 'white',
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  buttons: { flexDirection: 'row', marginTop: 10, width: '100%', justifyContent: 'space-between' },
  cancelBtn: { flex: 1, backgroundColor: '#333', padding: 15, borderRadius: 10, marginRight: 10, alignItems: 'center' },
  confirmBtn: { flex: 2, backgroundColor: colors.primary, padding: 15, borderRadius: 10, alignItems: 'center' },
  cancelText: { color: 'white', fontWeight: 'bold' },
  confirmText: { color: 'black', fontWeight: '900', fontSize: 16 }
});

export default RideRequestPanel;
