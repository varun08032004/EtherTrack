import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Switch } from 'react-native';
import { useColorScheme } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';

interface CardProps {
  children: React.ReactNode;
  style?: any;
  onPress?: () => void;
  elevated?: boolean;
  padding?: number;
}

export const Card = ({ children, style, onPress, elevated = true, padding = 16 }: CardProps) => {
  const colorScheme = useColorScheme();
  const isDark = useColorScheme() === 'dark';

  const bgColor = isDark ? '#111812' : '#ffffff';
  const borderColor = isDark ? '#1f2917' : '#e2e8e0';
  const shadowColor = '#000';
  const shadowOpacity = elevated ? 0.1 : 0;
  const shadowRadius = elevated ? 8 : 0;
  const shadowOffset = elevated ? { width: 0, height: 2 } : { width: 0, height: 0 };
  const elevation = elevated ? 3 : 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.card,
        {
          backgroundColor: bgColor,
          borderColor: borderColor,
          shadowColor,
          shadowOpacity,
          shadowRadius,
          shadowOffset,
          elevation,
          padding: padding,
          borderWidth: 1,
          borderColor: borderColor,
        },
        style,
      ]}
    >
      {children}
    </TouchableOpacity>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  change?: string;
  icon: string;
  color: string;
  onPress?: () => void;
}

export const StatCard = ({ title, value, change, icon, color, onPress }: StatCardProps) => {
  const isDark = useColorScheme() === 'dark';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.statCard}>
      <View style={styles.iconWrapper}>
        <View style={[styles.iconBg, { backgroundColor: color }]}>
          <Icon name={icon} size={18} color="#ffffff" />
        </View>
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: isDark ? '#ffffff' : '#0f170a' }]}>{title}</Text>
        <Text style={[styles.value, { color: isDark ? '#ffffff' : '#0f170a' }]}>{value}</Text>
        {change && (
          <Text style={[styles.change, { color: change.startsWith('-') ? '#ef4444' : '#22c55e' }]}>{change}</Text>
        )}
      </View>
      <View style={styles.iconWrapper}>
        <View style={[styles.iconBg, { backgroundColor: color }]}>
          <Icon name={icon} size={18} color="#ffffff" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

interface SwitchItemProps {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  icon?: string;
  iconColor?: string;
  disabled?: boolean;
}

export const SwitchItem = ({ label, subtitle, value, onValueChange, icon, iconColor, disabled = false }: SwitchItemProps) => {
  const isDark = useColorScheme() === 'dark';

  return (
    <TouchableOpacity onPress={() => !disabled && onValueChange(!value)} disabled={disabled} activeOpacity={0.8}>
      <View style={styles.switchRow}>
        <View style={styles.switchLeft}>
          {icon && (
            <View style={[styles.iconWrapper, { backgroundColor: iconColor || '#22c55e' }]}>
              <Icon name={icon} size={20} color="#ffffff" />
            </View>
          )}
          <View style={styles.switchText}>
            <Text style={styles.switchLabel}>{label}</Text>
            {subtitle && <Text style={styles.switchSubtitle}>{subtitle}</Text>}
          </View>
        </View>
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          thumbColor={disabled ? '#9ca3af' : '#ffffff'}
          trackColor={{ false: '#9ca3af', true: '#22c55e' }}
        />
      </View>
    </TouchableOpacity>
  );
}

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: any;
}

export const Button = ({ title, onPress, variant = 'primary', disabled = false, loading = false, style }: ButtonProps) => {
  const isDark = useColorScheme() === 'dark';
  const bgColor = variant === 'primary' ? '#22c55e' : variant === 'outline' ? 'transparent' : 'transparent';
  const borderColor = variant === 'outline' ? '#22c55e' : 'transparent';
  const textColor = variant === 'primary' ? '#080c0a' : '#22c55e';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        styles.button,
        { backgroundColor: bgColor, borderColor, borderWidth: variant === 'outline' ? 1 : 0 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <Text style={[styles.buttonText, { color: textColor }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

interface DividerProps {
  style?: any;
}

export const Divider = ({ style }: DividerProps) => {
  const isDark = useColorScheme() === 'dark';
  return <View style={[styles.divider, { backgroundColor: isDark ? '#1f2917' : '#e2e8e0' }, style]} />;
};

interface HeaderProps {
  title: string;
  subtitle?: string;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const Header = ({ title, subtitle, leftElement, rightElement }: HeaderProps) => {
  const isDark = useColorScheme() === 'dark';
  return (
    <View style={styles.header}>
      {leftElement}
      <View style={styles.headerContent}>
        <Text style={[styles.headerTitle, { color: isDark ? '#ffffff' : '#0f170a' }]}>{title}</Text>
        {subtitle && <Text style={[styles.headerSubtitle, { color: isDark ? '#6b7280' : '#6b7280' }]}>{subtitle}</Text>}
      </View>
      {rightElement}
    </View>
  );
};

interface PullToRefreshProps {
  refreshing: boolean;
  onRefresh: () => void;
  children: React.ReactNode;
}

export const PullToRefresh = ({ refreshing, onRefresh, children }: PullToRefreshProps) => {
  return (
    <View style={styles.pullToRefresh}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111812',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2917',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  statCard: {
    backgroundColor: '#111812',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2917',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    marginHorizontal: 12,
  },
  title: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    marginBottom: 4,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  change: {
    fontSize: 12,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  switchLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  switchText: {
    flex: 1,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#ffffff',
  },
  switchSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  divider: {
    height: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  pullToRefresh: {
    flex: 1,
  },
});