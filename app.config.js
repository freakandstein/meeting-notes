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
      bundleIdentifier: 'com.yourcompany.meetingnotes',
    },
    android: {
      package: 'com.yourcompany.meetingnotes',
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
    },
    plugins: [
      'expo-router',
      './plugins/withBackgroundAudio',
      'expo-notifications',
    ],
    experiments: {
      typedRoutes: true,
    },
  },
};
