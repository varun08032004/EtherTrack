import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useMarket } from '@/hooks/useMarket';
import { useAuth } from '@/hooks/useAuth';
import { Card, StatCard, Button } from '@/components/ui';

export default function MarketplaceScreen() {
  const { listings, isLoading, refetch, filters, setFilters, clearFilters } = useMarket();
  const { user } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleFilterChange = (newFilters: typeof filters) => {
    setFilters(newFilters);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Marketplace</Text>
          <Text style={styles.headerSubtitle}>Discover & trade carbon credits</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('marketplace/create-listing')}>
          <View style={styles.fab}>
            <Icon name="plus" size={20} color="#080c0a" />
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.filterBar}>
        <View style={styles.filterRow}>
          <TouchableOpacity style={styles.filterChip} onPress={() => handleFilterChange({ ...filters, standard: 'VCS' })}>
            <Text style={styles.filterChipText}>VCS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterChip} onPress={() => handleFilterChange({ ...filters, standard: 'Gold Standard' })}>
            <Text style={styles.filterChipText}>Gold Standard</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterChip} onPress={() => handleFilterChange({ ...filters, projectType: 'Renewable Energy' })}>
            <Text style={styles.filterChipText}>Renewable</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterChip} onPress={() => handleFilterChange({ ...filters, projectType: 'Forestry' })}>
            <Text style={styles.filterChipText}>Forestry</Text>
          </TouchableOpacity>
        </View>
        {Object.keys(filters).length > 0 && (
          <TouchableOpacity style={styles.clearFilters} onPress={clearFilters}>
            <Text style={styles.clearFiltersText}>Clear Filters</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.listContent}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#22c55e" />
            <Text style={styles.loadingText}>Loading listings...</Text>
          </View>
        ) : listings.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="search-off" size={48} color="#6b7280" />
            <Text style={styles.emptyText}>No listings found</Text>
            <Text style={styles.emptySubtext}>Try adjusting your filters</Text>
            <Button title="Clear Filters" onPress={clearFilters} variant="outline" />
          </View>
        ) : (
          <FlatList
            data={listings}
            keyExtractor={(item) => item.listing_id}
            renderItem={({ item }) => (
              <Card style={styles.listingCard} onPress={() => router.push(`marketplace/${item.listing_id}`)}>
                <View style={styles.listingHeader}>
                  <View style={styles.listingInfo}>
                    <Text style={styles.listingProject}>{item.asset.project_name}</Text>
                    <View style={styles.listingMeta}>
                      <Text style={styles.listingStandard}>{item.asset.standard}</Text>
                      <Text style={styles.listingDivider}>•</Text>
                      <Text style={styles.listingVintage}>Vintage {item.asset.vintage}</Text>
                      <Text style={styles.listingDivider}>•</Text>
                      <Text style={styles.listingRegistry}>{item.asset.registry}</Text>
                    </View>
                  </View>
                  <View style={styles.listingScore}>
                    <Text style={styles.listingGrade}>{item.asset.ecs_grade}</Text>
                    <Text style={styles.listingScoreText}>ECS: {item.asset.ecs_score}</Text>
                  </View>
                </View>
                <View style={styles.listingDetails}>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Available</Text>
                    <Text style={styles.detailValue}>{item.remaining_quantity.toLocaleString()} credits</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Price</Text>
                    <Text style={styles.detailValue}>₹{item.price_per_credit_inr.toLocaleString()}/credit</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Total</Text>
                    <Text style={styles.detailValue}>₹{(item.remaining_quantity * item.price_per_credit_inr).toLocaleString()}</Text>
                  </View>
                </View>
                <View style={styles.listingFooter}>
                  <Text style={styles.sellerInfo}>
                    <Icon name="person" size={14} color="#6b7280" style={{ marginRight: 4 }} />
                    {item.seller.company_name}
                  </Text>
                  <TouchableOpacity style={styles.buyButton}>
                    <Text style={styles.buyButtonText}>Buy</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
      </ScrollView>
    </View>
  );
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBar: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#111812',
    borderWidth: 1,
    borderColor: '#1f2917',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#ffffff',
  },
  clearFilters: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  clearFiltersText: {
    fontSize: 13,
    color: '#22c55e',
    fontWeight: '600',
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
  emptyText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  emptySubtext: {
    marginTop: 8,
    color: '#6b7280',
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  listingCard: {
    marginBottom: 12,
    padding: 16,
  },
  listingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  listingInfo: {
    flex: 1,
  },
  listingProject: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  listingMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  listingStandard: {
    fontSize: 12,
    color: '#22c55e',
    fontWeight: '500',
  },
  listingDivider: {
    color: '#6b7280',
  },
  listingVintage: {
    fontSize: 12,
    color: '#6b7280',
  },
  listingRegistry: {
    fontSize: 12,
    color: '#6b7280',
  },
  listingScore: {
    alignItems: 'flex-end',
  },
  listingGrade: {
    fontSize: 20,
    fontWeight: '700',
    color: '#22c55e',
  },
  listingScoreText: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  listingDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1f2917',
  },
  detailItem: {
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  listingFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sellerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    fontSize: 12,
    color: '#6b7280',
  },
  buyButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#22c55e',
    borderRadius: 8,
  },
  buyButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#080c0a',
  },
});

export default MarketplaceScreen;