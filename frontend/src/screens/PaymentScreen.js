import React, { useState, useContext, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal, SafeAreaView } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import client from '../api/client';

const PaymentScreen = ({ route, navigation }) => {
  const { fare, bookingId, paymentMode: initialPaymentMode } = route.params || { fare: '0.00', bookingId: null, paymentMode: 'cash' };
  
  const { userToken } = useContext(AuthContext);
  const [loading, setLoading] = useState(false);
  const [showGateway, setShowGateway] = useState(false);
  const [razorpayHtml, setRazorpayHtml] = useState(null);

  const handlePay = async () => {
    if (!bookingId) return Alert.alert("Error", "Invalid Booking ID");

    setLoading(true);

    if (initialPaymentMode === 'cash') {
        // 💵 CASH FLOW
        try {
            await client.post('/bookings/pay', 
                { bookingId }, 
                { headers: { Authorization: `Bearer ${userToken}` } }
            );
            Alert.alert("Success", "Cash Payment Confirmed!", [
                { text: "OK", onPress: () => navigation.navigate('Map') }
            ]);
        } catch (err) {
            Alert.alert("Error", "Could not confirm payment.");
        } finally {
            setLoading(false);
        }
    } else {
        // 💳 ONLINE FLOW (Razorpay)
        try {
            // 1. Create Order on Backend
            const res = await client.post('/payments/create-order', 
                { bookingId, amount: fare }, 
                { headers: { Authorization: `Bearer ${userToken}` } }
            );

            const { id: orderId, keyId, amount } = res.data;

            // 2. Generate HTML for WebView
            const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
                </head>
                <body style="display:flex; justify-content:center; align-items:center; height:100vh; background-color:#f4f4f4;">
                    <h2 style="font-family:sans-serif; color:#333;">Processing Payment...</h2>
                    <script>
                        var options = {
                            "key": "${keyId}",
                            "amount": "${amount}",
                            "currency": "INR",
                            "name": "Cab App",
                            "description": "Ride Booking #${bookingId}",
                            "order_id": "${orderId}",
                            "prefill": { "contact": "9999999999", "email": "rider@test.com" },
                            "theme": { "color": "#F37254" },
                            "handler": function (response){
                                window.ReactNativeWebView.postMessage(JSON.stringify({
                                    status: 'success',
                                    razorpay_payment_id: response.razorpay_payment_id,
                                    razorpay_order_id: response.razorpay_order_id,
                                    razorpay_signature: response.razorpay_signature
                                }));
                            },
                            "modal": {
                                "ondismiss": function(){
                                    window.ReactNativeWebView.postMessage(JSON.stringify({ status: 'closed' }));
                                }
                            }
                        };
                        var rzp1 = new Razorpay(options);
                        rzp1.on('payment.failed', function (response){
                             window.ReactNativeWebView.postMessage(JSON.stringify({ status: 'failed' }));
                        });
                        rzp1.open();
                    </script>
                </body>
                </html>
            `;

            setRazorpayHtml(htmlContent);
            setShowGateway(true);
            setLoading(false);

        } catch (err) {
            console.log("Create Order Error:", err);
            Alert.alert("Error", "Could not initiate online payment.");
            setLoading(false);
        }
    }
  };

  // 3. Handle WebView Messages (Success/Failure)
  const onWebViewMessage = async (event) => {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.status === 'success') {
          setShowGateway(false);
          setLoading(true);
          
          try {
              // 4. Verify on Backend
              await client.post('/payments/verify', 
                  { 
                      bookingId,
                      razorpay_order_id: data.razorpay_order_id,
                      razorpay_payment_id: data.razorpay_payment_id,
                      razorpay_signature: data.razorpay_signature
                  }, 
                  { headers: { Authorization: `Bearer ${userToken}` } }
              );
              
              Alert.alert("Success", "Payment Verified!", [
                  { text: "OK", onPress: () => navigation.navigate('Map') }
              ]);
          } catch (e) {
              Alert.alert("Verification Failed", "Payment happened but verification failed.");
          } finally {
              setLoading(false);
          }

      } else if (data.status === 'closed') {
          setShowGateway(false);
          Alert.alert("Cancelled", "Payment was cancelled.");
      } else {
          setShowGateway(false);
          Alert.alert("Failed", "Payment failed.");
      }
  };

  return (
    <View style={styles.container}>
      <Ionicons name={initialPaymentMode === 'online' ? "card" : "cash"} size={80} color={colors.primary} style={{marginBottom: 20}} />
      <Text style={styles.title}>Payment Due</Text>
      <Text style={styles.amount}>₹{fare}</Text>
      
      <View style={styles.cardInfo}>
        <Text style={styles.cardText}>
            {initialPaymentMode === 'online' ? '💳 Online Payment (Razorpay)' : '💵 Cash Payment'}
        </Text>
      </View>

      <TouchableOpacity style={styles.payBtn} onPress={handlePay} disabled={loading}>
        {loading ? (
            <ActivityIndicator color="black" />
        ) : (
            <Text style={styles.payText}>
                {initialPaymentMode === 'online' ? 'PROCEED TO PAY' : 'CONFIRM CASH PAID'}
            </Text>
        )}
      </TouchableOpacity>

      {/* 🌐 RAZORPAY WEBVIEW MODAL */}
      <Modal visible={showGateway} onRequestClose={() => setShowGateway(false)}>
          <SafeAreaView style={{flex: 1, backgroundColor: 'black'}}>
             <View style={{flexDirection:'row', padding:10, backgroundColor:'black', alignItems:'center'}}>
                 <TouchableOpacity onPress={() => setShowGateway(false)}>
                     <Ionicons name="close" size={30} color="white" />
                 </TouchableOpacity>
                 <Text style={{color:'white', fontSize:18, marginLeft:20}}>Razorpay Secure</Text>
             </View>
             {razorpayHtml && (
                 <WebView
                    originWhitelist={['*']}
                    source={{ html: razorpayHtml }}
                    onMessage={onWebViewMessage}
                    style={{flex:1}}
                 />
             )}
          </SafeAreaView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 30 },
  title: { color: 'white', fontSize: 24, fontWeight: 'bold' },
  amount: { color: colors.success, fontSize: 48, fontWeight: '900', marginVertical: 20 },
  cardInfo: { backgroundColor: '#333', padding: 20, borderRadius: 10, width: '100%', alignItems: 'center', marginBottom: 40 },
  cardText: { color: 'white', fontSize: 18 },
  payBtn: { backgroundColor: colors.primary, width: '100%', padding: 20, borderRadius: 15, alignItems: 'center' },
  payText: { color: 'black', fontWeight: '900', fontSize: 18 }
});

export default PaymentScreen;