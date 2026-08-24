import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useEmissions } from '@/hooks/useEmissions';
import { useMRV } from '@/hooks/useMRV';
import { Card, StatCard, Button } from '@/components/ui';

export default function DashboardScreen() {
  const { user, isAuthenticated } = useAuth();
  const { portfolio, isLoading: portfolioLoading, refetch: refetchPortfolio } = usePortfolio();
  const { summary: emissionsSummary, isLoading: emissionsLoading, activities: emissionsActivities } = useEmissions();
  const { plans, isLoading: mrvLoading } = useMRV();
  const router = useRouter();

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetchPortfolio(),
    ]);
    setRefreshing(false);
  };

  if (!isAuthenticated) {
    return null;
  }

  const stats = [
    {
      title: 'Portfolio Value',
      value: portfolio?.totalValue ? `₹${portfolio.totalValue.toLocaleString()}` : '₹0',
      change: portfolio?.change24h ? `${portfolio.change24h >= 0 ? '+' : ''}${portfolio.change24h.toFixed(2)}%` : '0%',
      icon: 'briefcase',
      color: '#22c55e',
    },
    {
      title: 'Credits Owned',
      value: portfolio?.totalCredits?.toLocaleString() || '0',
      change: '',
      icon: 'leaf',
      color: '#22c55e',
    },
    {
      title: 'Total Emissions',
      value: emissionsSummary?.totalEmissions ? `${emissionsSummary.totalEmissions.toFixed(2)} tCO₂e` : '0 tCO₂e',
      change: emissionsSummary?.change24h ? `${emissionsSummary.change24h >= 0 ? '+' : ''}${emissionsSummary.change24h.toFixed(1)}%` : '0%',
      icon: 'cloud',
      color: '#f97316',
    },
    {
      title: 'Net Position',
      value: emissionsSummary?.netEmissions !== undefined
        ? `${emissionsSummary.netEmissions >= 0 ? '+' : ''}${emissionsSummary.netEmissions.toFixed(2)} tCO₂e`
        : '0 tCO₂e',
      change: '',
      icon: 'balance',
      color: '#3b82f6',
    },
  ];

  const recentActivity = emissionsActivities?.slice(0, 5) || [];

  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'buy':
        router.push('marketplace');
        break;
      case 'sell':
        router.push('marketplace/create-listing');
        break;
      case 'log-emissions':
        router.push('emissions/log');
        break;
      case 'create-mrv':
        router.push('mrv/create');
        break;
      default:
        break;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Dashboard</Text>
          <Text style={styles.headerSubtitle}>Welcome back, {user?.full_name?.split(' ')[0] || 'User'}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('settings')}>
          <Icon name="settings" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <View style={styles.statsGrid}>
            {stats.map((stat, index) => (
              <StatCard key={index} {...stat} />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Portfolio</Text>
            <TouchableOpacity onPress={() => router.push('portfolio')}>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          <Card style={styles.chartCard}>
            <Text style={styles.chartPlaceholder}>Portfolio Chart - {portfolio?.history?.length || 0} data points</Text>
          </Card>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Emissions Trend</Text>
            <TouchableOpacity onPress={() => router.push('emissions')}>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          <Card style={styles.chartCard}>
            <Text style={styles.chartPlaceholder}>Emissions Chart - {emissionsActivities?.length || 0} activities</Text>
          </Card>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActions}>
            <TouchableOpacity style={styles.actionButton} onPress={() => handleQuickAction('buy')}>
              <View style={styles.actionIcon}>
                <Icon name="cart" size={20} color="#22c55e" />
              </View>
              <Text style={styles.actionLabel}>Buy Credits</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => handleQuickAction('sell')}>
              <View style={styles.actionIcon}>
                <Icon name="sell" size={20} color="#f97316" />
              </View>
              <Text style={styles.actionLabel}>Sell Credits</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => handleQuickAction('log-emissions')}>
              <View style={styles.actionIcon}>
                <Icon name="add-circle" size={20} color="#3b82f6" />
              </View>
              <Text style={styles.actionLabel}>Log Emissions</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => handleQuickAction('create-mrv')}>
              <View style={styles.actionIcon}>
                <Icon name="document-text" size={20} color="#8b5cf6" />
              </View>
              <Text style={styles.actionLabel}>Create MRV</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>MRV Plans</Text>
            <TouchableOpacity onPress={() => router.push('mrv')}>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.planList}>
            {plans?.map((plan) => (
              <Card key={plan.plan_id} style={styles.planCard} onPress={() => router.push(`mrv/${plan.plan_id}`)}>
                <View style={styles.planHeader}>
                  <Text style={styles.planName}>{plan.plan_name}</Text>
                  <Text style={[styles.planStatus, { backgroundColor: getStatusColor(plan.state) }]}>{plan.state}</Text>
                </View>
                <Text style={styles.planDesc}>{plan.description}</Text>
                <Text style={styles.planMeta}>Year: {plan.reporting_year} | {plan.facility_ids?.length || 0} facilities</Text>
              </Card>
            ))}
            {(!plans || plans.length === 0) && (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>No MRV plans yet</Text>
                <Button title="Create Plan" onPress={() => router.push('mrv/create')} variant="primary" />
              </Card>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            <TouchableOpacity onPress={() => router.push('activity')}>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.activityList}>
            {recentActivity.map((activity) => (
              <Card key={activity.activity_id} style={styles.activityCard}>
                <View style={styles.activityRow}>
                  <View style={styles.activityInfo}>
                    <Text style={styles.activityName}>{activity.activity}</Text>
                    <Text style={styles.activityMeta}>{activity.category} • {new Date(activity.date).toLocaleDateString()}</Text>
                  </View>
                  <View style={styles.activityValue}>
                    <Text style={styles.activityCO2e}>{activity.co2e.toFixed(2)} tCO₂e</Text>
                    <Text style={[styles.activityScope, { backgroundColor: getScopeColor(activity.scope) }]}>Scope {activity.scope}</Text>
                  </View>
                </View>
              </Card>
            ))}
            {recentActivity.length === 0 && (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>No recent activity</Text>
              </Card>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function getStatusColor(state: string) {
  switch (state) {
    case 'draft': return '#6b7280';
    case 'submitted': return '#3b82f6';
    case 'verified': return '#22c55e';
    case 'approved': return '#22c55e';
    case 'rejected': return '#ef4444';
    default: return '#6b7280';
  }
}

function getScopeColor(scope: number) {
  switch (scope) {
    case 1: return '#ef4444';
    case 2: return '#f97316';
    case 3: return '#3b82f6';
    default: return '#6b7280';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080c0a',
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
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  viewAll: {
    fontSize: 14,
    color: '#22c55e',
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  chartCard: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartPlaceholder: {
    color: '#6b7280',
    fontSize: 14,
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  actionButton: {
    width: '48%',
    aspectRatio: 1,
    backgroundColor: '#111812',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2917',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1f2917',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
  },
  planList: {
    gap: 12,
  },
  planCard: {
    padding: 16,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  planName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  planStatus: {
    fontSize: 11,
    fontWeight: '600',
    color: '#080c0a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  planDesc: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 8,
  },
  planMeta: {
    fontSize: 12,
    color: '#6b7280',
  },
  emptyCard: {
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
  },
  activityList: {
    gap: 8,
  },
  activityCard: {
    padding: 16,
  },
  activityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activityInfo: {
    flex: 1,
  },
  activityName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#ffffff',
  },
  activityMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  activityValue: {
    alignItems: 'flex-end',
  },
  activityCO2e: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  activityScope: {
    fontSize: 10,
    fontWeight: '600',
    color: '#080c0a',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    marginTop: 4,
  },
});

export default DashboardScreen;