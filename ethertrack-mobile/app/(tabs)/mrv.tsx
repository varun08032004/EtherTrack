import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useMRV } from '@/hooks/useMRV';
import { useAuth } from '@/hooks/useAuth';
import { Card, Button } from '@/components/ui';

export default function MRVDashboardScreen() {
  const { plans, isLoading, refetch, createPlan } = useMRV();
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleCreatePlan = () => {
    router.push('mrv/create');
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>MRV Plans</Text>
          <Text style={styles.headerSubtitle}>Manage your MRV plans</Text>
        </View>
        <TouchableOpacity onPress={handleCreatePlan} style={styles.fab}>
          <Icon name="plus" size={24} color="#080c0a" />
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.scrollContent}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#22c55e" />
            <Text style={styles.loadingText}>Loading MRV plans...</Text>
          </View>
        ) : plans.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="clipboard-off" size={48} color="#6b7280" />
            <Text style={styles.emptyTitle}>No MRV Plans</Text>
            <Text style={styles.emptySubtext}>Create your first MRV plan to start tracking emissions</Text>
            <Button title="Create Plan" onPress={handleCreatePlan} variant="primary" />
          </View>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Your MRV Plans</Text>
              <Text style={styles.sectionSubtitle}>{plans.length} plan{plans.length !== 1 ? 's' : ''}</Text>
            </View>

            <FlatList
              data={plans}
              keyExtractor={item => item.plan_id}
              renderItem={({ item }) => (
                <Card style={styles.planCard} onPress={() => router.push(`mrv/${item.plan_id}`)}>
                  <View style={styles.planHeader}>
                    <Text style={styles.planName}>{item.plan_name}</Text>
                    <Text style={[styles.planStatus, { backgroundColor: getStatusColor(item.state) }]}>{item.state}</Text>
                  </View>
                  <Text style={styles.planDesc}>{item.description}</Text>
                  <View style={styles.planMeta}>
                    <Text style={styles.planMetaItem}>Year: {item.reporting_year}</Text>
                    <Text style={styles.planMetaItem}>{item.facility_ids?.length || 0} facilities</Text>
                    <Text style={styles.planMetaItem}>{item.asset_ids?.length || 0} assets</Text>
                  </View>
                  <View style={styles.planDates}>
                    <Text style={styles.planDate}>
                      <Icon name="calendar" size={14} color="#6b7280" style={{ marginRight: 4 }} />
                      {new Date(item.reporting_period_start).toLocaleDateString()} - {new Date(item.reporting_period_end).toLocaleDateString()}
                    </Text>
                    <Text style={styles.planDate}>
                      <Icon name="time" size={14} color="#6b7280" style={{ marginRight: 4 }} />
                      Submit by: {new Date(item.submission_deadline).toLocaleDateString()}
                    </Text>
                  </View>
                </Card>
              )}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          </>
        )}
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
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 12,
    color: '#6b7280',
    fontSize: 16,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  emptySubtext: {
    marginTop: 8,
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginHorizontal: 16,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  sectionSubtitle: {
    color: '#6b7280',
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  planCard: {
    marginBottom: 12,
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 8,
  },
  planMetaItem: {
    fontSize: 12,
    color: '#6b7280',
  },
  planDates: {
    gap: 4,
  },
  planDate: {
    flexDirection: 'row',
    alignItems: 'center',
    fontSize: 11,
    color: '#6b7280',
  },
});

export default MRVDashboardScreen;