import React, { useContext, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import client from '../api/client';
import { colors } from '../theme/colors';

const ProfileScreen = ({ navigation }) => {
  const { userInfo, logout, userToken } = useContext(AuthContext);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await client.get('/bookings/history', {
         headers: { Authorization: `Bearer ${userToken}` }
      });
      setHistory(res.data);
    } catch (err) {
      console.log('Error fetching history:', err);
    }
    setLoading(false);
  };

  const renderRide = ({ item }) => (
    <View style={styles.rideCard}>
      <View style={styles.row}>
        <Text style={styles.date}>{new Date(item.created_at).toLocaleDateString()}</Text>
        <Text style={styles.fare}>₹{item.fare}</Text>
      </View>
      <Text style={styles.address} numberOfLines={1}>📍 {item.drop_address || 'Destination'}</Text>
      <Text style={[styles.status, { color: item.status === 'completed' ? colors.success : 'orange' }]}>
        {item.status ? item.status.toUpperCase() : 'UNKNOWN'}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Back Button */}
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={24} color="white" />
      </TouchableOpacity>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
             <Text style={styles.avatarText}>{userInfo.name?.charAt(0) || 'U'}</Text>
        </View>
        <Text style={styles.name}>{userInfo.name}</Text>
        <Text style={styles.email}>{userInfo.email}</Text>
        <View style={styles.roleBadge}>
             <Text style={styles.roleText}>{userInfo.role?.toUpperCase()}</Text>
        </View>
      </View>

      {/* History List */}
      <Text style={styles.sectionTitle}>Ride History</Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{marginTop: 20}} />
      ) : (
        <FlatList 
          data={history} 
          keyExtractor={(item) => item.id.toString()} 
          renderItem={renderRide}
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No rides yet.</Text>}
        />
      )}

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>LOGOUT</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20 },
  backBtn: { marginTop: 30, marginBottom: 10 },
  header: { alignItems: 'center', marginBottom: 30 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  avatarText: { color: colors.primary, fontSize: 32, fontWeight: 'bold' },
  name: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  email: { color: colors.textDim, marginBottom: 10 },
  roleBadge: { backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 5 },
  roleText: { color: 'black', fontWeight: 'bold', fontSize: 12 },
  sectionTitle: { fontSize: 18, color: 'white', marginBottom: 15, fontWeight: 'bold', borderBottomWidth: 1, borderBottomColor: '#333', paddingBottom: 10 },
  rideCard: { backgroundColor: colors.secondary, padding: 15, borderRadius: 10, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  date: { color: '#888' },
  fare: { color: colors.success, fontWeight: 'bold', fontSize: 16 },
  address: { color: 'white', marginBottom: 5 },
  status: { fontSize: 12, fontWeight: 'bold' },
  emptyText: { color: '#666', textAlign: 'center', marginTop: 20 },
  logoutBtn: { backgroundColor: '#333', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  logoutText: { color: colors.error, fontWeight: 'bold' }
});

export default ProfileScreen;