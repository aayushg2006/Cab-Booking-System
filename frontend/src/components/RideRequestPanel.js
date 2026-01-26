import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';

const RideRequestPanel = ({ fare, distance, onCancel, onRequest, isSearching }) => {
  return (
    <View style={styles.panel}>
      <View style={styles.handle} />
      
      <Text style={styles.title}>Confirm Your Ride</Text>
      
      <View style={styles.row}>
        <Text style={styles.label}>Est. Distance</Text>
        <Text style={styles.value}>{distance} km</Text>
      </View>
      
      <View style={styles.row}>
        <Text style={styles.label}>Total Fare</Text>
        <Text style={styles.price}>${fare}</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.confirmBtn} onPress={onRequest} disabled={isSearching}>
          {isSearching ? (
             <View style={{flexDirection:'row', alignItems:'center'}}>
               <ActivityIndicator color="black" style={{marginRight:10}} />
               <Text style={styles.confirmText}>SEARCHING...</Text>
             </View>
          ) : (
             <Text style={styles.confirmText}>REQUEST RIDE</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', bottom: 0, width: '100%',
    backgroundColor: colors.secondary, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10, elevation: 15
  },
  handle: { width: 50, height: 5, backgroundColor: '#444', borderRadius: 5, marginBottom: 15 },
  title: { color: colors.text, fontSize: 18, fontWeight: 'bold', marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 10 },
  label: { color: colors.textDim, fontSize: 16 },
  value: { color: colors.text, fontSize: 16, fontWeight: 'bold' },
  price: { color: colors.primary, fontSize: 20, fontWeight: 'bold' },
  buttons: { flexDirection: 'row', marginTop: 20, width: '100%', justifyContent: 'space-between' },
  cancelBtn: { flex: 1, backgroundColor: '#333', padding: 15, borderRadius: 10, marginRight: 10, alignItems: 'center' },
  confirmBtn: { flex: 2, backgroundColor: colors.primary, padding: 15, borderRadius: 10, alignItems: 'center' },
  cancelText: { color: 'white', fontWeight: 'bold' },
  confirmText: { color: 'black', fontWeight: '900', fontSize: 16 }
});

export default RideRequestPanel;