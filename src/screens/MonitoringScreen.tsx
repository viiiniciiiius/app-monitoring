import React from 'react';

import { MonitoringActive } from '../components/monitoring/MonitoringActive';
import { MonitoringPermissions } from '../components/monitoring/MonitoringPermissions';
import { useMonitoringController } from '../hooks/useMonitoringController';

export default function MonitoringScreen() {
  const controller = useMonitoringController();

  if (!controller.permissionsReady) {
    return <MonitoringPermissions controller={controller} />;
  }

  return <MonitoringActive controller={controller} />;
}
