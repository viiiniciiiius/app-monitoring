import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { diagnostics } from '../services/diagnostics';

interface DiagnosticsErrorBoundaryProps {
  children: React.ReactNode;
}

interface DiagnosticsErrorBoundaryState {
  hasError: boolean;
}

export default class DiagnosticsErrorBoundary extends React.Component<
  DiagnosticsErrorBoundaryProps,
  DiagnosticsErrorBoundaryState
> {
  state: DiagnosticsErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): DiagnosticsErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(
    error: Error,
    errorInfo: React.ErrorInfo,
  ): void {
    void diagnostics.error('react_error_boundary', error, {
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>O aplicativo encontrou um erro.</Text>
          <Text style={styles.message}>
            O diagnóstico foi salvo. Feche e abra o aplicativo para
            retomar o monitoramento.
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#000',
  },
  title: {
    color: '#FF3B30',
    fontSize: 20,
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
});
