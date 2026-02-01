import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Image } from 'react-native';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';

const CAR_TYPES = [
  { id: 'hatchback', name: 'Mini', multiplier: 1, icon: 'car-sport' },
  { id: 'sedan', name: 'Sedan', multiplier: 1.4, icon: 'car' },
  { id: 'suv', name: 'SUV', multiplier: 1.9, icon: 'bus' },
];

const RideRequestPanel = ({ fare, distance, onCancel, onRequest, isSearching }) => {
  const [selectedCar, setSelectedCar] = useState(CAR_TYPES[0]);

  // Calculate price based on selected car category
  const displayFare = Math.round(fare * selectedCar.multiplier);

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
        <Text style={styles.label}>Total Fare</Text>
        <Text style={styles.price}>₹{displayFare}</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity 
            style={styles.confirmBtn} 
            onPress={() => onRequest(selectedCar.id, displayFare)} 
            disabled={isSearching}
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
    // 🔴 REMOVED: position: 'absolute', bottom: 0 
    // This allows the panel to sit BELOW the payment buttons naturally
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
  price: { color: colors.success, fontSize: 22, fontWeight: 'bold' },
  buttons: { flexDirection: 'row', marginTop: 10, width: '100%', justifyContent: 'space-between' },
  cancelBtn: { flex: 1, backgroundColor: '#333', padding: 15, borderRadius: 10, marginRight: 10, alignItems: 'center' },
  confirmBtn: { flex: 2, backgroundColor: colors.primary, padding: 15, borderRadius: 10, alignItems: 'center' },
  cancelText: { color: 'white', fontWeight: 'bold' },
  confirmText: { color: 'black', fontWeight: '900', fontSize: 16 }
});

export default RideRequestPanel;