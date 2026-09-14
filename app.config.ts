import 'tsx/cjs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const easProjectId = process.env.EAS_PROJECT_ID;

  return {
    ...config,
    name: "Monitoramento de Campo",
    slug: "field-monitoring",
    version: "1.1.0",
    orientation: "portrait",
    icon: "./assets/field-monitoring-icon.png",
    splash: {
      image: "./assets/field-monitoring-black.png",
      resizeMode: "contain",
      backgroundColor: "#9039B0"
    },
    platforms: [
      "ios",
      "android"
    ],
    assetBundlePatterns: [
      "**/*"
    ],
    extra: {
      ...config.extra,
      ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
    },
    android: {
      versionCode: 2,
      package: "org.example.fieldmonitoring",
      adaptiveIcon: {
        foregroundImage: "./assets/field-monitoring-icon.png",
        backgroundColor: "#000000"
      },
      permissions: [
        "android.permission.INTERNET"
      ]
    },
    plugins: [
      "expo-font",
      [
        "expo-build-properties", {
          android: {
            usesCleartextTraffic: true
          }
        }
      ],
      [
        "expo-media-library",
        {
          photosPermission: "Permitir que o app acesse suas fotos.",
          savePhotosPermission: "Permitir que o app salve fotos.",
          isAccessMediaLocationEnabled: true
        }
      ]
    ],
  };
};
