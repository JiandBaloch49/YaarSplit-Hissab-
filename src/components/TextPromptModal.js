// TextPromptModal.js — a small pop-up that asks for one line of text.
//
// Used for "New group", "Rename group" and renaming a member. (React
// Native's built-in Alert.prompt only works on iOS, so we make our own that
// works everywhere.)
//
// Props:
//   visible      show or hide it
//   title        e.g. "New group"
//   initialValue text already in the box when it opens (e.g. the current
//                name when renaming). For renaming, render this only while
//                it's open, so it starts fresh with the right name each time.
//   placeholder  hint text inside the input
//   submitLabel  text on the confirm button, e.g. "Create"
//   onSubmit     called with the trimmed text (only if it isn't empty)
//   onCancel     called when the user closes it without saving

import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import AppButton from './AppButton';
import { colors, fonts, radius, text } from '../theme';

export default function TextPromptModal({
  visible,
  title,
  initialValue = '',
  placeholder,
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();

  function handleSubmit() {
    if (trimmed === '') return;
    onSubmit(trimmed);
    setValue(initialValue); // start fresh next time it opens
  }

  function handleCancel() {
    setValue(initialValue);
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
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            autoFocus
            selectTextOnFocus // renaming: typing replaces the old name
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
    backgroundColor: 'rgba(23, 34, 59, 0.45)', // ink, see-through — dims the screen behind
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 20,
    gap: 16,
  },
  title: {
    ...text.title,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    fontFamily: fonts.regular,
    fontSize: 17,
    color: colors.ink,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  buttonWrap: {
    flex: 1,
  },
});
