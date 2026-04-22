// Custom Expo config plugin to enable background audio recording on iOS and Android.
const { withInfoPlist, withAndroidManifest } = require('@expo/config-plugins');

// ─── iOS ──────────────────────────────────────────────────────────────────────

const withIosBackgroundAudio = (config) => {
  return withInfoPlist(config, (cfg) => {
    // UIBackgroundModes — required for audio to continue when app is backgrounded
    if (!cfg.modResults.UIBackgroundModes) {
      cfg.modResults.UIBackgroundModes = [];
    }
    if (!cfg.modResults.UIBackgroundModes.includes('audio')) {
      cfg.modResults.UIBackgroundModes.push('audio');
    }

    // Microphone usage description — required by App Store
    if (!cfg.modResults.NSMicrophoneUsageDescription) {
      cfg.modResults.NSMicrophoneUsageDescription =
        'MeetingNotes needs microphone access to record your meetings.';
    }

    return cfg;
  });
};

// ─── Android ──────────────────────────────────────────────────────────────────

const withAndroidBackgroundAudio = (config) => {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // Ensure uses-permission array exists
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const permissions = manifest['uses-permission'];

    const addPermission = (name) => {
      if (!permissions.find((p) => p.$?.['android:name'] === name)) {
        permissions.push({ $: { 'android:name': name } });
      }
    };

    // Record audio + foreground service permissions
    addPermission('android.permission.RECORD_AUDIO');
    addPermission('android.permission.FOREGROUND_SERVICE');
    addPermission('android.permission.FOREGROUND_SERVICE_MICROPHONE');

    // Add foreground service declaration to <application>
    const application = manifest.application[0];
    if (!application.service) {
      application.service = [];
    }

    const serviceExists = application.service.find(
      (s) => s.$?.['android:name'] === 'expo.modules.av.RecordingService'
    );

    if (!serviceExists) {
      application.service.push({
        $: {
          'android:name': 'expo.modules.av.RecordingService',
          'android:foregroundServiceType': 'microphone',
          'android:exported': 'false',
        },
      });
    }

    return cfg;
  });
};

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = (config) => {
  config = withIosBackgroundAudio(config);
  config = withAndroidBackgroundAudio(config);
  return config;
};
