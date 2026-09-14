import { registerRootComponent } from 'expo';

import App from './src/App';
import { installRuntimeDiagnostics } from './src/services/runtimeDiagnostics';

installRuntimeDiagnostics('1.1.0');

registerRootComponent(App);
