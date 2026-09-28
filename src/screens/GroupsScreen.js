// GroupsScreen.js — the first screen: a list of all groups.
//
// Tap a group to open it. "New group" asks for a name and creates it.
// While developing (__DEV__), there's also a "Load test data" button.

import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AppButton from '../components/AppButton';
import TextPromptModal from '../components/TextPromptModal';
import { colors, radius, space } from '../components/theme';
import { addGroup, listGroups } from '../db/queries';
import { loadTestData } from '../db/testData';

export default function GroupsScreen({ navigation }) {
  const [groups, setGroups] = useState([]);
  const [askingName, setAskingName] = useState(false);

  // Reload the list every time this screen comes into view — e.g. when
  // coming back from a group. The sync DB API returns rows straight away.
  useFocusEffect(
    useCallback(() => {
      setGroups(listGroups());
    }, [])
  );

  function openGroup(group, initialTab) {
    navigation.navigate('Group', { groupId: group.id, name: group.name, initialTab });
  }

  function handleCreate(name) {
    setAskingName(false);
    const group = addGroup(name);
    setGroups(listGroups());
    openGroup(group);
  }

  // DEV ONLY: create the three-meals example and jump to its balances.
  // Expected: A +200, B +400, C -250, D -350.
  function handleLoadTestData() {
    try {
      const group = loadTestData();
      openGroup(group, 'balances');
    } catch (error) {
      Alert.alert('Test data failed', error.message);
    }
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={groups}
        keyExtractor={(group) => group.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <AppButton title="New group" onPress={() => setAskingName(true)} />
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            No groups yet. Create one for your next trip or hangout.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openGroup(item)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.arrow}>›</Text>
          </Pressable>
        )}
        ListFooterComponent={
          __DEV__ ? (
            <View style={styles.footer}>
              <AppButton title="Load test data" variant="secondary" onPress={handleLoadTestData} />
            </View>
          ) : null
        }
      />

      <TextPromptModal
        visible={askingName}
        title="New group"
        placeholder="e.g. Murree trip"
        submitLabel="Create"
        onSubmit={handleCreate}
        onCancel={() => setAskingName(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    padding: space.lg,
    gap: space.sm,
  },
  header: {
    marginBottom: space.sm,
  },
  empty: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.xl,
    fontSize: 16,
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  rowPressed: {
    opacity: 0.6,
  },
  name: {
    flex: 1,
    fontSize: 17,
    color: colors.text,
  },
  arrow: {
    fontSize: 22,
    color: colors.grey,
  },
  footer: {
    marginTop: space.xl,
  },
});
