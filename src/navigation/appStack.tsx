import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { MenuScreen, TransferScreen, MonitoringScreen } from '../screens';
import { RootStackList } from '../types';
import { useAppContext } from '../context/AppContext';

// Create a typed stack navigator using RootStackList for type safety
const Stack = createStackNavigator<RootStackList>();

// Define the main app stack navigator with three screens
const AppStack = () => {
  const { isMonitoringActive } = useAppContext();

  return (
    <Stack.Navigator
      initialRouteName={
        isMonitoringActive ? 'Monitoring' : 'Menu'
      }
    >
      {/* Main menu screen for setting photo name */}
      <Stack.Screen 
        name="Menu" 
        component={MenuScreen} 
        options={{
          headerShown: false,
        }}
      />
      {/* Transfer screen for handling image transfers */}
      <Stack.Screen 
        name="Transfer" 
        component={TransferScreen} 
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen 
        name="Monitoring"
        component={MonitoringScreen} 
        options={{
          headerShown: false,
        }}
      />
    </Stack.Navigator>
  )
};

export default AppStack;
