module.exports = {
  expo: {
    name: 'MeetingNotes',
    slug: 'meeting-notes',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'meetingnotes',
    sdkVersion: '54.0.0',
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.tio.meetingnotes.ios',
      googleServicesFile: './GoogleService-Info.plist',
    },
    android: {
      package: 'com.tio.meetingnotes',
      googleServicesFile: './google-services.json',
      adaptiveIcon: {
        foregroundImage: './app/assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
    },
    plugins: [
      'expo-router',
      './plugins/withBackgroundAudio',
      './plugins/withRecordingService',
      'expo-notifications',
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      eas: {
        projectId: 'd7c4f0ad-dbc2-47f2-a7ae-8a0953bdb298',
      },
    },
  },
};
