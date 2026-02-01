import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

const RatingModal = ({ visible, onSubmit, onClose }) => {
    const [rating, setRating] = useState(0);
    const [review, setReview] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        setLoading(true);
        await onSubmit(rating, review);
        setLoading(false);
        setRating(0);
        setReview('');
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <View style={styles.container}>
                    <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                        <Ionicons name="close" size={24} color="white" />
                    </TouchableOpacity>

                    <Text style={styles.title}>Rate your Driver</Text>
                    <Text style={styles.subtitle}>How was your ride?</Text>

                    <View style={styles.stars}>
                        {[1, 2, 3, 4, 5].map((star) => (
                            <TouchableOpacity key={star} onPress={() => setRating(star)}>
                                <Ionicons 
                                    name={star <= rating ? "star" : "star-outline"} 
                                    size={40} 
                                    color="#FFD700" 
                                />
                            </TouchableOpacity>
                        ))}
                    </View>

                    <TextInput 
                        style={styles.input} 
                        placeholder="Write a review (optional)" 
                        placeholderTextColor="#666"
                        value={review}
                        onChangeText={setReview}
                        multiline
                    />

                    <TouchableOpacity 
                        style={[styles.submitBtn, { opacity: rating > 0 ? 1 : 0.5 }]} 
                        disabled={rating === 0 || loading}
                        onPress={handleSubmit}
                    >
                        {loading ? <ActivityIndicator color="black"/> : <Text style={styles.btnText}>SUBMIT REVIEW</Text>}
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
    container: { width: '85%', backgroundColor: '#1a1a1a', padding: 25, borderRadius: 20, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
    closeBtn: { position: 'absolute', top: 10, right: 10, padding: 5 },
    title: { color: 'white', fontSize: 22, fontWeight: 'bold', marginBottom: 5 },
    subtitle: { color: '#888', marginBottom: 20 },
    stars: { flexDirection: 'row', gap: 10, marginBottom: 20 },
    input: { width: '100%', backgroundColor: '#333', color: 'white', padding: 15, borderRadius: 10, marginBottom: 20, height: 80, textAlignVertical: 'top' },
    submitBtn: { backgroundColor: colors.primary, width: '100%', padding: 15, borderRadius: 10, alignItems: 'center' },
    btnText: { color: 'black', fontWeight: 'bold', fontSize: 16 }
});

export default RatingModal;