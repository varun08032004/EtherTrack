import { Tabs } from 'expo-router';
import { Ionicons as Icon } from '@expo/vector-icons';
import { Providers } from '@/providers';

export default function TabLayout() {
  return (
    <Providers>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#007AFF',
          tabBarInactiveTintColor: '#8E8E93',
        }}
      >
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ focused, color }) => (
              <Icon name={focused ? 'home' : 'home-outline'} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="marketplace"
          options={{
            title: 'Marketplace',
            tabBarIcon: ({ focused, color }) => (
              <Icon name={focused ? 'storefront' : 'storefront-outline'} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="mrv"
          options={{
            title: 'MRV',
            tabBarIcon: ({ focused, color }) => (
              <Icon name={focused ? 'clipboard-check' : 'clipboard-check-outline'} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="portfolio"
          options={{
            title: 'Portfolio',
            tabBarIcon: ({ focused, color }) => (
              <Icon name={focused ? 'briefcase' : 'briefcase-outline'} size={24} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ focused, color }) => (
              <Icon name={focused ? 'settings' : 'settings-outline'} size={24} color={color} />
            ),
          }}
        />
      </Tabs>
    </Providers>
  );
}