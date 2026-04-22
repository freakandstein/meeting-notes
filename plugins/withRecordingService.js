/**
 * Config plugin that adds a native Android Foreground Service for background recording.
 * This ensures audio recording continues when the screen is locked.
 */
const { withDangerousMod, withAndroidManifest, withAppBuildGradle } = require('@expo/config-plugins');
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
import androidx.media.app.NotificationCompat as MediaNotificationCompat

class RecordingForegroundService : Service() {
    companion object {
        const val CHANNEL_ID = "recording_service_channel"
        const val NOTIFICATION_ID = 9001
        const val ACTION_START = "com.tio.meetingnotes.START_RECORDING_SERVICE"
        const val ACTION_STOP = "com.tio.meetingnotes.STOP_RECORDING_SERVICE"
        const val ACTION_PAUSE_REQUEST = "com.tio.meetingnotes.PAUSE_REQUEST"
        const val ACTION_RESUME_REQUEST = "com.tio.meetingnotes.RESUME_REQUEST"
        const val ACTION_STOP_REQUEST = "com.tio.meetingnotes.STOP_REQUEST"

        // Callback registered by RecordingServiceModule to relay events to JS
        @Volatile var onStateChange: ((state: String) -> Unit)? = null
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var isPaused = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                isPaused = false
                startForeground(NOTIFICATION_ID, buildNotification(false))
                acquireWakeLock()
            }
            ACTION_STOP -> {
                isPaused = false
                releaseWakeLock()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            ACTION_PAUSE_REQUEST -> {
                isPaused = true
                updateNotification(true)
                onStateChange?.invoke("pause_requested")
            }
            ACTION_RESUME_REQUEST -> {
                isPaused = false
                updateNotification(false)
                onStateChange?.invoke("resume_requested")
            }
            ACTION_STOP_REQUEST -> {
                // This is now handled in MainActivity.onNewIntent() since the Stop
                // notification button uses PendingIntent.getActivity() directly
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

    private fun buildNotification(paused: Boolean): Notification {
        val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)
        val openPendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val actionPendingIntent = if (paused) {
            PendingIntent.getService(
                this, 2,
                Intent(this, RecordingForegroundService::class.java).apply { action = ACTION_RESUME_REQUEST },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        } else {
            PendingIntent.getService(
                this, 1,
                Intent(this, RecordingForegroundService::class.java).apply { action = ACTION_PAUSE_REQUEST },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        val stopPendingIntent = PendingIntent.getActivity(
            this, 3,
            (packageManager.getLaunchIntentForPackage(packageName) ?: Intent()).apply {
                action = ACTION_STOP_REQUEST
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(if (paused) "Recording paused" else "Recording in progress")
            .setContentText(if (paused) "Tap Resume to continue" else "Tap Pause to pause recording")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(openPendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .setStyle(MediaNotificationCompat.MediaStyle()
                .setShowActionsInCompactView(0, 1))
            .addAction(
                if (paused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
                if (paused) "Resume" else "Pause",
                actionPendingIntent
            )
            .addAction(android.R.drawable.presence_busy, "Stop", stopPendingIntent)
            .build()
    }

    private fun updateNotification(paused: Boolean) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(paused))
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
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class RecordingServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    init {
        // Register a callback so the service can push state changes to JS
        RecordingForegroundService.onStateChange = { state ->
            val params = WritableNativeMap().apply { putString("state", state) }
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onRecordingStateChange", params)
        }
    }

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

    @ReactMethod
    fun pauseRequest() {
        reactApplicationContext.startService(
            Intent(reactApplicationContext, RecordingForegroundService::class.java).apply {
                action = RecordingForegroundService.ACTION_PAUSE_REQUEST
            }
        )
    }

    @ReactMethod
    fun resumeRequest() {
        reactApplicationContext.startService(
            Intent(reactApplicationContext, RecordingForegroundService::class.java).apply {
                action = RecordingForegroundService.ACTION_RESUME_REQUEST
            }
        )
    }

    // Required boilerplate for NativeEventEmitter on the JS side
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
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

      // Add onNewIntent override to MainActivity.kt to handle Stop notification action
      const mainActivityPath = path.join(targetDir, 'MainActivity.kt');
      if (fs.existsSync(mainActivityPath)) {
        let content = fs.readFileSync(mainActivityPath, 'utf8');
        if (!content.includes('ACTION_STOP_REQUEST')) {
          // Add import for Intent
          if (!content.includes('import android.content.Intent')) {
            content = content.replace(
              'import android.os.Build',
              'import android.content.Intent\nimport android.os.Build'
            );
          }
          // Insert onNewIntent override after the closing brace of onCreate
          content = content.replace(
            /override fun onCreate\(savedInstanceState: Bundle\?\)\s*\{[^}]+super\.onCreate\(null\)\s*\}/,
            (match) => match + `\n\n  override fun onNewIntent(intent: Intent?) {\n    super.onNewIntent(intent)\n    if (intent?.action == RecordingForegroundService.ACTION_STOP_REQUEST) {\n      RecordingForegroundService.onStateChange?.invoke("stop_requested")\n    }\n  }`
          );
          fs.writeFileSync(mainActivityPath, content);
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

// ─── Add androidx.media:media dependency ─────────────────────────────────────

function withRecordingServiceBuildGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('androidx.media:media')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        'dependencies {\n    implementation "androidx.media:media:1.7.0"'
      );
    }
    return cfg;
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = (config) => {
  config = withRecordingServiceFiles(config);
  config = withRecordingServiceManifest(config);
  config = withRecordingServiceBuildGradle(config);
  return config;
};
