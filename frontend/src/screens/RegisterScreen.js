import React, { useContext, useState } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, 
  KeyboardAvoidingView, Platform, ScrollView 
} from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { colors } from '../theme/colors';

const RegisterScreen = ({ navigation }) => {
  const { register, isLoading } = useContext(AuthContext);
  
  // Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('rider'); // 'rider' or 'driver'

  // Driver Specific
  const [carModel, setCarModel] = useState('');
  const [plate, setPlate] = useState('');
  const [license, setLicense] = useState('');

  const handleRegister = () => {
    const userData = {
        name, email, phone, password, role,
        // Only include these if driver
        ...(role === 'driver' && { car_model: carModel, car_plate: plate, license_number: license })
    };
    register(userData);
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex:1}}>
        <ScrollView contentContainerStyle={styles.content}>
          
          <Text style={styles.title}>Create Identity</Text>
          <Text style={styles.subtitle}>Join the network.</Text>

          {/* Role Selector */}
          <View style={styles.roleContainer}>
            <TouchableOpacity 
                style={[styles.roleBtn, role === 'rider' && styles.roleBtnActive]}
                onPress={() => setRole('rider')}
            >
                <Text style={[styles.roleText, role === 'rider' && {color:'black'}]}>RIDER</Text>
            </TouchableOpacity>
            <TouchableOpacity 
                style={[styles.roleBtn, role === 'driver' && styles.roleBtnActive]}
                onPress={() => setRole('driver')}
            >
                <Text style={[styles.roleText, role === 'driver' && {color:'black'}]}>DRIVER</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>FULL NAME</Text>
          <TextInput style={styles.input} placeholder="John Doe" placeholderTextColor="#555" onChangeText={setName} />

          <Text style={styles.label}>EMAIL</Text>
          <TextInput style={styles.input} placeholder="name@email.com" placeholderTextColor="#555" onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />

          <Text style={styles.label}>PHONE</Text>
          <TextInput style={styles.input} placeholder="9876543210" placeholderTextColor="#555" onChangeText={setPhone} keyboardType="phone-pad" />

          <Text style={styles.label}>PASSWORD</Text>
          <TextInput style={styles.input} placeholder="••••••" placeholderTextColor="#555" secureTextEntry onChangeText={setPassword} />

          {/* Conditional Driver Fields */}
          {role === 'driver' && (
            <>
                <Text style={styles.sectionHeader}>VEHICLE DETAILS</Text>
                <TextInput style={styles.input} placeholder="Car Model (e.g. Toyota Prius)" placeholderTextColor="#555" onChangeText={setCarModel} />
                <TextInput style={styles.input} placeholder="License Plate" placeholderTextColor="#555" onChangeText={setPlate} />
                <TextInput style={styles.input} placeholder="License Number" placeholderTextColor="#555" onChangeText={setLicense} />
            </>
          )}

          <TouchableOpacity onPress={handleRegister} style={styles.button}>
            {isLoading ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>REGISTER</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.goBack()} style={{marginTop: 20}}>
            <Text style={styles.link}>Already have an account? Login</Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 30, paddingTop: 60 },
  title: { fontSize: 32, fontWeight: 'bold', color: colors.text, marginBottom: 5 },
  subtitle: { fontSize: 16, color: colors.textDim, marginBottom: 30 },
  label: { color: colors.primary, fontSize: 11, fontWeight: 'bold', marginBottom: 8, marginTop: 10 },
  input: { backgroundColor: colors.inputBg, borderRadius: 8, padding: 15, color: colors.text, borderWidth: 1, borderColor: '#333' },
  button: { backgroundColor: colors.primary, padding: 18, borderRadius: 10, alignItems: 'center', marginTop: 30 },
  buttonText: { color: '#000', fontWeight: 'bold' },
  link: { color: colors.textDim, textAlign: 'center' },
  roleContainer: { flexDirection: 'row', marginBottom: 20, backgroundColor: '#222', borderRadius: 10, padding: 5 },
  roleBtn: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 8 },
  roleBtnActive: { backgroundColor: colors.primary },
  roleText: { color: '#888', fontWeight: 'bold' },
  sectionHeader: { color: colors.text, marginTop: 20, marginBottom: 10, fontSize: 16, fontWeight: 'bold' }
});

export default RegisterScreen;