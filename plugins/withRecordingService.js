/**
 * Config plugin that adds a native Android Foreground Service for background recording.
 * This ensures audio recording continues when the screen is locked.
 */
const { withDangerousMod, withAndroidManifest } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const PACKAGE_NAME = 'com.tio.meetingnotes';
const PACKAGE_PATH = PACKAGE_NAME.replace(/\./g, '/');

// ─── Kotlin source files ──────────────────────────────────────────────────────

const RECORDING_FOREGROUND_SERVICE_KT = `package ${PACKAGE_NAME}

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

class RecordingForegroundService : Service() {
    companion object {
        const val CHANNEL_ID = "recording_service_channel"
        const val NOTIFICATION_ID = 9001
        const val ACTION_START = "com.tio.meetingnotes.START_RECORDING_SERVICE"
        const val ACTION_STOP = "com.tio.meetingnotes.STOP_RECORDING_SERVICE"
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                startForeground(NOTIFICATION_ID, createNotification())
                acquireWakeLock()
            }
            ACTION_STOP -> {
                releaseWakeLock()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Recording Service",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps audio recording active in the background"
            setSound(null, null)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun createNotification(): Notification {
        val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Recording in progress")
            .setContentText("Tap to return to the app")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build()
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "${PACKAGE_NAME}:RecordingWakeLock"
        ).also { it.acquire(4 * 60 * 60 * 1000L) } // max 4 hours
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }
}
`;

const RECORDING_SERVICE_MODULE_KT = `package ${PACKAGE_NAME}

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class RecordingServiceModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "RecordingServiceModule"

    @ReactMethod
    fun start() {
        val intent = Intent(reactApplicationContext, RecordingForegroundService::class.java).apply {
            action = RecordingForegroundService.ACTION_START
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            reactApplicationContext.startForegroundService(intent)
        } else {
            reactApplicationContext.startService(intent)
        }
    }

    @ReactMethod
    fun stop() {
        val intent = Intent(reactApplicationContext, RecordingForegroundService::class.java).apply {
            action = RecordingForegroundService.ACTION_STOP
        }
        reactApplicationContext.startService(intent)
    }
}
`;

const RECORDING_SERVICE_PACKAGE_KT = `package ${PACKAGE_NAME}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class RecordingServicePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(RecordingServiceModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
`;

// ─── Write Kotlin source files ────────────────────────────────────────────────

function withRecordingServiceFiles(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const targetDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        PACKAGE_PATH
      );

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      fs.writeFileSync(
        path.join(targetDir, 'RecordingForegroundService.kt'),
        RECORDING_FOREGROUND_SERVICE_KT
      );
      fs.writeFileSync(
        path.join(targetDir, 'RecordingServiceModule.kt'),
        RECORDING_SERVICE_MODULE_KT
      );
      fs.writeFileSync(
        path.join(targetDir, 'RecordingServicePackage.kt'),
        RECORDING_SERVICE_PACKAGE_KT
      );

      // Add RecordingServicePackage to MainApplication.kt
      const mainAppPath = path.join(targetDir, 'MainApplication.kt');
      if (fs.existsSync(mainAppPath)) {
        let content = fs.readFileSync(mainAppPath, 'utf8');
        if (!content.includes('RecordingServicePackage')) {
          content = content.replace(
            'PackageList(this).packages.apply {',
            'PackageList(this).packages.apply {\n            add(RecordingServicePackage())'
          );
          fs.writeFileSync(mainAppPath, content);
        }
      }

      return config;
    },
  ]);
}

// ─── Add service to AndroidManifest ──────────────────────────────────────────

function withRecordingServiceManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const application = manifest.application[0];

    if (!application.service) {
      application.service = [];
    }

    const exists = application.service.find(
      (s) => s.$?.['android:name'] === '.RecordingForegroundService'
    );

    if (!exists) {
      application.service.push({
        $: {
          'android:name': '.RecordingForegroundService',
          'android:foregroundServiceType': 'microphone',
          'android:exported': 'false',
        },
      });
    }

    return cfg;
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = (config) => {
  config = withRecordingServiceFiles(config);
  config = withRecordingServiceManifest(config);
  return config;
};
