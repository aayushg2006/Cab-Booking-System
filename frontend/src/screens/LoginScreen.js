import React, { useContext, useState } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, 
  KeyboardAvoidingView, Platform, StatusBar 
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AuthContext } from '../context/AuthContext';
import { colors } from '../theme/colors';

const LoginScreen = ({ navigation }) => {
  const { login, isLoading } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Background Glow */}
      <LinearGradient
        colors={[colors.primary, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.backgroundBlob}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.content}>
        
        <View style={styles.header}>
          <Text style={styles.title}>RIDE<Text style={{color: colors.primary}}>X</Text></Text>
          <Text style={styles.subtitle}>Welcome back, Pilot.</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>IDENTITY (EMAIL)</Text>
          <TextInput 
            style={styles.input} 
            placeholder="rider@test.com" 
            placeholderTextColor="#666"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>ACCESS KEY (PASSWORD)</Text>
          <TextInput 
            style={styles.input} 
            placeholder="••••••" 
            placeholderTextColor="#666"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity 
            onPress={() => login(email, password)} 
            style={styles.button}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.buttonText}>INITIATE SESSION</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Register')} style={{marginTop: 25}}>
            <Text style={styles.link}>
              No Identity? <Text style={{color: colors.primary, fontWeight:'bold'}}>Create One</Text>
            </Text>
          </TouchableOpacity>
        </View>

      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  backgroundBlob: {
    position: 'absolute', top: -100, left: -100, width: 400, height: 400,
    borderRadius: 200, opacity: 0.15,
  },
  content: { flex: 1, justifyContent: 'center', padding: 30 },
  header: { marginBottom: 60 },
  title: { fontSize: 42, fontWeight: '900', color: colors.text, letterSpacing: 2 },
  subtitle: { fontSize: 16, color: colors.textDim, marginTop: 5, letterSpacing: 1 },
  form: { width: '100%' },
  label: { color: colors.primary, fontSize: 10, fontWeight: 'bold', marginBottom: 8, letterSpacing: 1.5 },
  input: {
    backgroundColor: colors.inputBg, borderRadius: 12, padding: 18,
    color: colors.text, fontSize: 16, marginBottom: 25, borderWidth: 1, borderColor: '#333',
  },
  button: {
    backgroundColor: colors.primary, padding: 20, borderRadius: 12, alignItems: 'center',
    shadowColor: colors.primary, shadowOpacity: 0.6, shadowRadius: 15, elevation: 10,
  },
  buttonText: { color: '#000', fontWeight: '900', fontSize: 16, letterSpacing: 1.5 },
  link: { color: colors.textDim, textAlign: 'center', fontSize: 14 }
});

export default LoginScreen;