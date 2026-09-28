// TextPromptModal.js — a small pop-up that asks for one line of text.
//
// Used by "New group" to ask for the group's name. (React Native's built-in
// Alert.prompt only works on iOS, so we make our own that works everywhere.)
//
// Props:
//   visible     show or hide it
//   title       e.g. "New group"
//   placeholder hint text inside the input
//   submitLabel text on the confirm button, e.g. "Create"
//   onSubmit    called with the trimmed text (only if it isn't empty)
//   onCancel    called when the user closes it without saving

import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import AppButton from './AppButton';
import { colors, radius, space } from './theme';

export default function TextPromptModal({
  visible,
  title,
  placeholder,
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}) {
  const [text, setText] = useState('');
  const trimmed = text.trim();

  function handleSubmit() {
    if (trimmed === '') return;
    onSubmit(trimmed);
    setText(''); // start empty next time it opens
  }

  function handleCancel() {
    setText('');
    onCancel();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      {/* Push the card up when the keyboard opens (iOS needs "padding"). */}
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={colors.grey}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
          <View style={styles.buttons}>
            <View style={styles.buttonWrap}>
              <AppButton title="Cancel" variant="secondary" onPress={handleCancel} />
            </View>
            <View style={styles.buttonWrap}>
              <AppButton title={submitLabel} onPress={handleSubmit} disabled={trimmed === ''} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)', // dim the screen behind
    justifyContent: 'center',
    padding: space.xl,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius + 4,
    padding: space.lg,
    gap: space.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: space.md,
    fontSize: 16,
    color: colors.text,
  },
  buttons: {
    flexDirection: 'row',
    gap: space.md,
  },
  buttonWrap: {
    flex: 1,
  },
});
