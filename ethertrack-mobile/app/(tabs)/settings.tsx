import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { Card, Button, Divider } from '@/components/ui';

export default function SettingsScreen() {
  const { user, isAuthenticated, logout } = useAuth();
  const colorScheme = useColorScheme();
  const router = useRouter();

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  const colors = useColorScheme() === 'dark' ? {
    bg: '#080c0a',
    surface: '#111812',
    border: '#1f2917',
    text: '#ffffff',
    textMuted: '#6b7280',
    primary: '#22c55e',
    primaryLight: '#1f2917',
  } : {
    bg: '#f8fafc',
    surface: '#ffffff',
    border: '#e2e8e0',
    text: '#0f170a',
    textMuted: '#6b7280',
    primary: '#22c55e',
    primaryLight: '#dcfce7',
  };

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          setLoading(true);
          await logout();
          setLoading(false);
        }
      }
    ]);
  };

  const handleBiometricToggle = async (enabled: boolean) => {
    // In production, would check device capabilities and enable biometric auth
    setBiometricEnabled(enabled);
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Settings</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textMuted }]}>Manage your account and preferences</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Profile Section */}
        <View style={styles.section}>
          <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.profileHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{user?.full_name?.charAt(0) || 'U'}</Text>
              </View>
              <View style={styles.profileInfo}>
                <Text style={[styles.profileName, { color: colors.text }]}>{user?.full_name || 'User'}</Text>
                <Text style={[styles.profileEmail, { color: colors.textMuted }]}>{user?.email}</Text>
                <Text style={[styles.profileRole, { color: colors.primary }]}>{user?.role || 'User'}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Account Settings */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Account</Text>
          
          <Card style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity onPress={() => router.push('settings/profile')}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Icon name="person" size={20} color={colors.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Profile</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Edit your profile information</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.textMuted} />
              </View>
            </TouchableOpacity>

            <Divider style={[styles.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity onPress={() => router.push('settings/security')}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Icon name="shield" size={20} color={colors.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Security</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Password, biometrics, 2FA</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.textMuted} />
              </View>
            </TouchableOpacity>

            <Divider style={[styles.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity onPress={() => router.push('settings/notifications')}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Icon name="bell" size={20} color={colors.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Notifications</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Push notifications and alerts</Text>
                </View>
                <Switch
                  value={notificationsEnabled}
                  onValueChange={setNotificationsEnabled}
                  thumbColor={colors.primary}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>
            </TouchableOpacity>
          </Card>

          <Divider style={[styles.divider, { backgroundColor: colors.border }]} />

          <Card style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity onPress={() => router.push('settings/appearance')}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Icon name="moon" size={20} color={colors.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Appearance</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Theme and display settings</Text>
                </View>
                <Switch
                  value={darkMode}
                  onValueChange={setDarkMode}
                  thumbColor={colors.primary}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>
            </TouchableOpacity>

            <Divider style={[styles.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity onPress={() => router.push('settings/privacy')}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Icon name="lock" size={20} color={colors.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Privacy & Data</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Manage your data and privacy</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          </Card>
        </View>

        {/* Wallet & Payments */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Wallet & Payments</Text>
          
          <Card style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity onPress={() => router.push('settings/wallet')}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Icon name="wallet" size={20} color={colors.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Wallet</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Balance: ₹{user?.inr_balance?.toLocaleString() || '0'}</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.textMuted} />
              </View>
            </TouchableOpacity>

            <Divider style={[styles.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity onPress={() => router.push('settings/payment-methods')}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Icon name="card" size={20} color={colors.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Payment Methods</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Manage cards and bank accounts</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.textMuted} />
              </View>
            </TouchableOpacity>

            <Divider style={[styles.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity onPress={() => router.push('settings/withdrawal')}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Icon name="arrow-down-circle" size={20} color={colors.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Withdraw Funds</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Transfer to bank account</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          </Card>
        </View>

        {/* Support & About */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Support & About</Text>
          
          <Card style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity onPress={() => router.push('settings/help')}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Icon name="help-circle" size={20} color={colors.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>Help Center</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>FAQs, guides, and support</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.textMuted} />
              </View>
            </TouchableOpacity>

            <Divider style={[styles.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity onPress={() => router.push('settings/about')}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Icon name="information-circle" size={20} color={colors.primary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: colors.text }]}>About</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Version 1.0.0</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.textMuted} />
              </View>
            </TouchableOpacity>

            <Divider style={[styles.divider, { backgroundColor: colors.border }]} />

            <TouchableOpacity onPress={handleLogout} disabled={loading}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Icon name="log-out" size={20} color="#ef4444" />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingTitle, { color: '#ef4444' }]}>Logout</Text>
                  <Text style={[styles.settingSubtitle, { color: colors.textMuted }]}>Sign out of your account</Text>
                </View>
                {loading && <ActivityIndicator size="small" color="#ef4444" />}
              </View>
            </TouchableOpacity>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginHorizontal: 16,
  },
  profileCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#080c0a',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
  },
  profileEmail: {
    fontSize: 14,
    marginTop: 2,
  },
  profileRole: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#1f2917',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  settingSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  divider: {
    height: 1,
    marginHorizontal: 16,
  },
});

export default SettingsScreen;