import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useAuth } from '@/hooks/useAuth';
import { Card, StatCard, Button } from '@/components/ui';

export default function PortfolioScreen() {
  const { portfolio, isLoading, refetch } = usePortfolio();
  const { user, isAuthenticated } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const stats = [
    {
      title: 'Total Value',
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
      title: '24h Change',
      value: portfolio?.change24h ? `${portfolio.change24h >= 0 ? '+' : ''}${portfolio.change24h.toFixed(2)}%` : '0%',
      change: '',
      icon: 'trending-up',
      color: '#3b82f6',
    },
    {
      title: 'Credits Held',
      value: portfolio?.holdings?.length?.toString() || '0',
      change: '',
      icon: 'layers',
      color: '#f97316',
    },
  ];

  if (!isAuthenticated) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Portfolio</Text>
          <Text style={styles.headerSubtitle}>Your carbon credit holdings</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('portfolio/analytics')}>
          <Icon name="bar-chart-2" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Portfolio Overview</Text>
          <View style={styles.statsGrid}>
            {stats.map((stat, index) => (
              <StatCard key={index} {...stat} />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Portfolio Value</Text>
            <TouchableOpacity onPress={() => router.push('portfolio/analytics')}>
              <Text style={styles.viewAll}>View Analytics</Text>
            </TouchableOpacity>
          </View>
          <Card style={styles.chartCard}>
            <Text style={styles.chartPlaceholder}>Portfolio Chart - {portfolio?.history?.length || 0} data points</Text>
          </Card>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Holdings</Text>
            <TouchableOpacity onPress={() => router.push('portfolio/holdings')}>
              <Text style={styles.viewAll}>View All</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={portfolio?.holdings || []}
            keyExtractor={item => item.assetId}
            renderItem={({ item }) => (
              <Card style={styles.holdingCard} onPress={() => router.push(`asset/${item.assetId}`)}>
                <View style={styles.holdingHeader}>
                  <View style={styles.holdingInfo}>
                    <Text style={styles.holdingName}>{item.assetName}</Text>
                    <Text style={styles.holdingMeta}>{item.vintage} • {item.standard} • {item.projectName}</Text>
                  </View>
                  <View style={styles.holdingValue}>
                    <Text style={styles.holdingQty}>{item.quantity.toLocaleString()} credits</Text>
                    <Text style={[styles.holdingPnl, { color: item.pnl >= 0 ? '#22c55e' : '#ef4444' }]}>
                      {item.pnl >= 0 ? '+' : ''}{item.pnl.toLocaleString()} ({item.pnlPercent >= 0 ? '+' : ''}{item.pnlPercent.toFixed(2)}%)
                    </Text>
                  </View>
                </View>
                <View style={styles.holdingDetails}>
                  <View style={styles.holdingDetail}>
                    <Text style={styles.detailLabel}>Avg Price</Text>
                    <Text style={styles.detailValue}>₹{item.avgPrice.toLocaleString()}</Text>
                  </View>
                  <View style={styles.holdingDetail}>
                    <Text style={styles.detailLabel}>Current</Text>
                    <Text style={styles.detailValue}>₹{item.currentPrice.toLocaleString()}</Text>
                  </View>
                  <View style={styles.holdingDetail}>
                    <Text style={styles.detailLabel}>Value</Text>
                    <Text style={styles.detailValue}>₹{item.currentValue.toLocaleString()}</Text>
                  </View>
                </View>
              </Card>
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>No holdings yet</Text>
                <Button title="Buy Credits" onPress={() => router.push('marketplace')} variant="primary" />
              </Card>
            }
          />

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Recent Transactions</Text>
              <TouchableOpacity onPress={() => router.push('portfolio/transactions')}>
                <Text style={styles.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={portfolio?.recentTransactions || []}
              keyExtractor={item => item.tradeId}
              renderItem={({ item }) => (
                <Card style={styles.transactionCard}>
                  <View style={styles.transactionRow}>
                    <View style={styles.transactionType}>
                      <View style={[styles.typeDot, { backgroundColor: item.type === 'buy' ? '#22c55e' : '#ef4444' }]} />
                      <Text style={styles.transactionAction}>{item.type.toUpperCase()}</Text>
                    </View>
                    <View style={styles.transactionInfo}>
                      <Text style={styles.transactionAsset}>{item.assetName}</Text>
                      <Text style={styles.transactionMeta}>{item.quantity} credits • {new Date(item.timestamp).toLocaleDateString()}</Text>
                    </View>
                    <View style={styles.transactionValue}>
                      <Text style={[styles.transactionAmount, { color: item.type === 'buy' ? '#ef4444' : '#22c55e' }]}>
                        {item.type === 'buy' ? '-' : '+'}₹{item.total.toLocaleString()}
                      </Text>
                      <Text style={[styles.transactionStatus, { color: getStatusColor(item.status) }]}>{item.status}</Text>
                    </View>
                  </View>
                </Card>
              )}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <Card style={styles.emptyCard}>
                  <Text style={styles.emptyText}>No recent transactions</Text>
                </Card>
              }
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function getStatusColor(status: string) {
  switch (status) {
    case 'completed': return '#22c55e';
    case 'pending': return '#f97316';
    case 'failed': return '#ef4444';
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
    fontWeight: '600',
    color: '#ffffff',
  },
  viewAll: {
    color: '#22c55e',
    fontSize: 14,
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
  holdingCard: {
    marginBottom: 12,
    padding: 16,
  },
  holdingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  holdingInfo: {
    flex: 1,
  },
  holdingName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  holdingMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  holdingValue: {
    alignItems: 'flex-end',
  },
  holdingQty: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  holdingPnl: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  holdingDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1f2917',
  },
  holdingDetail: {
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  transactionCard: {
    marginBottom: 8,
    padding: 16,
  },
  transactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  transactionType: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  transactionAction: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  transactionInfo: {
    flex: 1,
    marginHorizontal: 16,
  },
  transactionAsset: {
    fontSize: 14,
    fontWeight: '500',
    color: '#ffffff',
  },
  transactionMeta: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  transactionValue: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: '600',
  },
  transactionStatus: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
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
});

export default PortfolioScreen;