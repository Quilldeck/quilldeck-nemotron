import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import 'react-native-reanimated'
import { AppProviders } from '@/components/app-providers'

export default function RootLayout() {
  return (
    <AppProviders>
      <Stack screenOptions={{ contentStyle: { backgroundColor: '#0F0F1A' } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="blurb-generator" options={{ headerShown: false }} />
        <Stack.Screen name="go-market" options={{ headerShown: false }} />
        <Stack.Screen name="kdp-metadata" options={{ headerShown: false }} />
        <Stack.Screen name="subscription" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </AppProviders>
  )
}