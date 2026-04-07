import React, { useContext, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import client from '../api/client';
import { colors } from '../theme/colors';

const ProfileScreen = ({ navigation }) => {
  const { userInfo, logout, userToken } = useContext(AuthContext);
  const [history, setHistory] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await client.get('/bookings/history', {
         headers: { Authorization: `Bearer ${userToken}` }
      });
      setHistory(res.data);

      if (userInfo.role === 'rider') {
        const upcomingRes = await client.get('/bookings/upcoming', {
          headers: { Authorization: `Bearer ${userToken}` },
        });
        setUpcoming(Array.isArray(upcomingRes.data) ? upcomingRes.data : []);
      } else if (userInfo.role === 'driver') {
        const earningsRes = await client.get('/bookings/driver/earnings?range=7d', {
          headers: { Authorization: `Bearer ${userToken}` },
        });
        setEarnings(earningsRes.data || null);
      }
    } catch (err) {
      console.log('Error fetching history:', err);
    }
    setLoading(false);
  }, [userInfo.role, userToken]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

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
      {userInfo.role === 'driver' && earnings && (
        <View style={styles.earningsCard}>
          <Text style={styles.earningsTitle}>Last 7 Days</Text>
          <View style={styles.row}>
            <Text style={styles.earningsLabel}>Rides</Text>
            <Text style={styles.earningsValue}>{earnings.completedRides}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.earningsLabel}>Earnings</Text>
            <Text style={styles.earningsValue}>₹{Math.round(earnings.grossEarnings || 0)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.earningsLabel}>Avg Rating</Text>
            <Text style={styles.earningsValue}>{earnings.avgRating || 0}</Text>
          </View>
        </View>
      )}

      {userInfo.role === 'rider' && upcoming.length > 0 && (
        <View style={styles.upcomingBlock}>
          <Text style={styles.sectionTitle}>Upcoming Rides</Text>
          {upcoming.slice(0, 3).map((ride) => (
            <View key={ride.bookingId} style={styles.upcomingCard}>
              <Text style={styles.upcomingTime}>{new Date(ride.scheduledFor).toLocaleString()}</Text>
              <Text style={styles.upcomingRoute} numberOfLines={1}>→ {ride.dropAddress || 'Destination'}</Text>
              <Text style={styles.upcomingMeta}>
                {ride.carType?.toUpperCase()} • ₹{Math.round(ride.fare || 0)}
              </Text>
            </View>
          ))}
        </View>
      )}

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
  earningsCard: { backgroundColor: '#202838', borderWidth: 1, borderColor: '#34415C', borderRadius: 12, padding: 14, marginBottom: 16 },
  earningsTitle: { color: '#D7E1F5', fontWeight: '800', marginBottom: 8, fontSize: 14 },
  earningsLabel: { color: '#93A0B9', fontSize: 13 },
  earningsValue: { color: '#E7EEFF', fontWeight: '700', fontSize: 13 },
  upcomingBlock: { marginBottom: 18 },
  upcomingCard: { backgroundColor: '#1F2736', borderWidth: 1, borderColor: '#313F58', borderRadius: 10, padding: 10, marginBottom: 8 },
  upcomingTime: { color: '#C7D2E8', fontWeight: '700', fontSize: 12 },
  upcomingRoute: { color: 'white', marginTop: 4, marginBottom: 3 },
  upcomingMeta: { color: '#9AA8C2', fontSize: 12 },
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
