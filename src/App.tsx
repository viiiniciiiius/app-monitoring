import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import AppStack from './navigation/appStack';
import { AppProvider } from './context/AppContext';
import { ReactQueryProvider } from './context/ReactQueryProvider';
import * as SplashScreen from 'expo-splash-screen';
import { 
  useFonts, 
  NotoSans_400Regular, 
  NotoSans_500Medium, 
  NotoSans_600SemiBold,
  NotoSans_700Bold, 
  NotoSans_800ExtraBold
} from '@expo-google-fonts/noto-sans';
import { CameraProvider } from './context/CameraContext';
import DiagnosticsErrorBoundary from './components/DiagnosticsErrorBoundary';

SplashScreen.preventAutoHideAsync();

export default function App() {

  // Load custom fonts and track loading state or errors
  const [fontsLoaded, fontError] = useFonts({
    NotoSans_400Regular,
    NotoSans_500Medium,
    NotoSans_600SemiBold,
    NotoSans_700Bold,
    NotoSans_800ExtraBold,
  });

  // Hide splash screen when fonts are loaded or if there is a font loading error
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Prevent rendering the app UI until fonts are loaded or an error occurs
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <DiagnosticsErrorBoundary>
      <ReactQueryProvider>
        <NavigationContainer>
          <AppProvider>
            <CameraProvider>
              <AppStack />
            </CameraProvider>
          </AppProvider>
        </NavigationContainer>
      </ReactQueryProvider>
    </DiagnosticsErrorBoundary>
  );
}
