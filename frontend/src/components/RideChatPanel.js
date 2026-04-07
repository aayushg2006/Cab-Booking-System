import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Keyboard,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

const RideChatPanel = ({
  visible,
  messages,
  draft,
  onDraftChange,
  onSend,
  onClose,
  currentRole,
}) => {
  const listRef = useRef(null);
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);

  useEffect(() => {
    if (!visible || !messages?.length) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages, visible]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event) => {
      const nextHeight = Math.max(0, Number(event?.endCoordinates?.height || 0));
      setKeyboardHeight(nextHeight);
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (!visible) return null;

  return (
    <View
      style={[
        styles.wrapper,
        keyboardHeight > 0 && {
          bottom: Math.max(8, keyboardHeight - 10),
        },
      ]}
    >
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>Ride Chat</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={22} color="white" />
          </TouchableOpacity>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item, index) => item.messageId || `${item.sentAt || 'm'}_${index}`}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const mine = item.senderRole === currentRole;
            return (
              <View style={[styles.messageBubble, mine ? styles.mine : styles.theirs]}>
                <Text style={[styles.messageText, mine && styles.mineText]}>{item.text}</Text>
              </View>
            );
          }}
        />

        <View style={styles.inputRow}>
          <TextInput
            value={draft}
            onChangeText={onDraftChange}
            placeholder="Type a message..."
            placeholderTextColor="#8A8F99"
            style={styles.input}
            multiline
            maxLength={500}
            onFocus={() => {
              requestAnimationFrame(() => {
                listRef.current?.scrollToEnd({ animated: true });
              });
            }}
          />
          <TouchableOpacity onPress={onSend} style={styles.sendBtn}>
            <Ionicons name="send" size={18} color="black" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    zIndex: 120,
  },
  card: {
    width: '94%',
    alignSelf: 'center',
    backgroundColor: '#101217',
    borderColor: '#222833',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 18,
    maxHeight: 340,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 6,
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  mine: {
    backgroundColor: colors.primary,
    alignSelf: 'flex-end',
  },
  theirs: {
    backgroundColor: '#273041',
    alignSelf: 'flex-start',
  },
  messageText: {
    color: 'white',
    fontSize: 14,
  },
  mineText: {
    color: 'black',
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 4,
  },
  input: {
    flex: 1,
    backgroundColor: '#1B2230',
    color: 'white',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    maxHeight: 90,
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: colors.primary,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default RideChatPanel;
