/**
 * withLiveActivity.js
 * Expo config plugin for iOS Live Activities (iOS 16.1+)
 * 
 * Approach: plugin writes all widget Swift source files during prebuild,
 * then injects the RecordingWidget target into the Xcode project.
 * Note: com.apple.developer.live-activities entitlement is NOT required
 * for local Live Activities (only needed for push-to-start).
 */

const { withInfoPlist, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const WIDGET_TARGET = 'RecordingWidget';
const WIDGET_BUNDLE_ID = 'com.tio.meetingnotes.ios.RecordingWidget';
const TEAM_ID = 'G7935U62L4';
const DEPLOYMENT_TARGET = '16.1';

// ─── LiveActivityModule source file contents ─────────────────────────────────

const LIVE_ACTIVITY_MODULE_SWIFT = `import Foundation
import ActivityKit

// Must use the same struct name as the widget target so ActivityKit can match them.
@available(iOS 16.2, *)
struct RecordingAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var isPaused: Bool
        var elapsedSeconds: Int
    }
}

@objc(LiveActivityModule)
class LiveActivityModule: NSObject {
    private var _currentActivity: Any? = nil

    @objc func startActivity(_ elapsedSeconds: NSNumber) {
        guard #available(iOS 16.2, *) else { return }
        guard _currentActivity == nil else { return }
        let attrs = RecordingAttributes()
        let state = RecordingAttributes.ContentState(isPaused: false, elapsedSeconds: elapsedSeconds.intValue)
        let content = ActivityContent(state: state, staleDate: nil)
        do {
            let activity = try Activity<RecordingAttributes>.request(attributes: attrs, content: content)
            _currentActivity = activity
            print("[LiveActivity] started: \\(activity.id)")
        } catch {
            print("[LiveActivity] start error: \\(error)")
        }
    }

    @objc func updateActivity(_ isPaused: Bool, elapsedSeconds: NSNumber) {
        guard #available(iOS 16.2, *) else { return }
        guard let activity = _currentActivity as? Activity<RecordingAttributes> else { return }
        let newState = RecordingAttributes.ContentState(isPaused: isPaused, elapsedSeconds: elapsedSeconds.intValue)
        let content = ActivityContent(state: newState, staleDate: nil)
        Task { await activity.update(content) }
    }

    @objc func endActivity() {
        guard #available(iOS 16.2, *) else { return }
        guard let activity = _currentActivity as? Activity<RecordingAttributes> else { return }
        Task {
            let finalContent = ActivityContent(state: activity.content.state, staleDate: nil)
            await activity.end(finalContent, dismissalPolicy: .immediate)
            _currentActivity = nil
        }
    }

    @objc static func requiresMainQueueSetup() -> Bool { return false }
}
`;

const LIVE_ACTIVITY_MODULE_M = `#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LiveActivityModule, NSObject)
RCT_EXTERN_METHOD(startActivity:(nonnull NSNumber *)elapsedSeconds)
RCT_EXTERN_METHOD(updateActivity:(BOOL)isPaused elapsedSeconds:(nonnull NSNumber *)elapsedSeconds)
RCT_EXTERN_METHOD(endActivity)
@end
`;

// ─── Widget source file contents ─────────────────────────────────────────────

const RECORDING_ATTRIBUTES_SWIFT = `import ActivityKit
import Foundation

public struct RecordingAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var isPaused: Bool
        public var elapsedSeconds: Int
        public init(isPaused: Bool, elapsedSeconds: Int) {
            self.isPaused = isPaused
            self.elapsedSeconds = elapsedSeconds
        }
    }
    public init() {}
}
`;

const RECORDING_WIDGET_SWIFT = `import SwiftUI
import ActivityKit
import WidgetKit

struct RecordingWidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingAttributes.self) { context in
            LockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image(systemName: context.state.isPaused ? "pause.circle.fill" : "waveform.circle.fill")
                            .foregroundColor(context.state.isPaused ? .orange : .red)
                            .font(.title2)
                        Text(context.state.isPaused ? "Paused" : "Recording")
                            .font(.headline)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(elapsedString(context.state.elapsedSeconds))
                        .font(.headline.monospacedDigit())
                        .foregroundColor(.secondary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 20) {
                        Link(destination: URL(string: "meetingnotes://liveactivity?action=\\(context.state.isPaused ? "resume" : "pause")")!) {
                            Label(context.state.isPaused ? "Resume" : "Pause",
                                  systemImage: context.state.isPaused ? "play.fill" : "pause.fill")
                                .font(.subheadline.bold())
                                .foregroundColor(context.state.isPaused ? .green : .orange)
                                .padding(.horizontal, 16).padding(.vertical, 8)
                                .background(Color(uiColor: .secondarySystemBackground))
                                .clipShape(Capsule())
                        }
                        Link(destination: URL(string: "meetingnotes://liveactivity?action=stop")!) {
                            Label("Stop", systemImage: "stop.fill")
                                .font(.subheadline.bold())
                                .foregroundColor(.white)
                                .padding(.horizontal, 16).padding(.vertical, 8)
                                .background(Color.red)
                                .clipShape(Capsule())
                        }
                    }
                    .padding(.top, 4)
                }
            } compactLeading: {
                Image(systemName: context.state.isPaused ? "pause.circle.fill" : "waveform")
                    .foregroundColor(context.state.isPaused ? .orange : .red)
            } compactTrailing: {
                Text(elapsedString(context.state.elapsedSeconds))
                    .font(.caption.monospacedDigit())
            } minimal: {
                Image(systemName: context.state.isPaused ? "pause.circle.fill" : "waveform")
                    .foregroundColor(context.state.isPaused ? .orange : .red)
            }
        }
    }
    private func elapsedString(_ seconds: Int) -> String {
        String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

struct LockScreenView: View {
    let context: ActivityViewContext<RecordingAttributes>
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Label(
                    context.state.isPaused ? "Recording Paused" : "Recording in progress",
                    systemImage: context.state.isPaused ? "pause.circle.fill" : "waveform.circle.fill"
                )
                .font(.headline)
                .foregroundColor(context.state.isPaused ? .orange : .red)
                Text(elapsedString(context.state.elapsedSeconds))
                    .font(.subheadline.monospacedDigit())
                    .foregroundColor(.secondary)
            }
            Spacer()
            HStack(spacing: 12) {
                Link(destination: URL(string: "meetingnotes://liveactivity?action=\\(context.state.isPaused ? "resume" : "pause")")!) {
                    Image(systemName: context.state.isPaused ? "play.fill" : "pause.fill")
                        .font(.title3).foregroundColor(context.state.isPaused ? .green : .orange)
                        .frame(width: 44, height: 44)
                        .background(Color(uiColor: .secondarySystemFill))
                        .clipShape(Circle())
                }
                Link(destination: URL(string: "meetingnotes://liveactivity?action=stop")!) {
                    Image(systemName: "stop.fill")
                        .font(.title3).foregroundColor(.white)
                        .frame(width: 44, height: 44)
                        .background(Color.red)
                        .clipShape(Circle())
                }
            }
        }
        .padding()
    }
    private func elapsedString(_ seconds: Int) -> String {
        String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }
}

@main
struct RecordingWidgetBundle: WidgetBundle {
    var body: some Widget {
        RecordingWidgetLiveActivity()
    }
}
`;

const WIDGET_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSSupportsLiveActivities</key>
    <true/>
    <key>NSSupportsLiveActivitiesFrequentUpdates</key>
    <true/>
    <key>CFBundleDisplayName</key>
    <string>RecordingWidget</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundlePackageType</key>
    <string>XPC!</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.widgetkit-extension</string>
    </dict>
</dict>
</plist>
`;

// ─── 1. Main app Info.plist ───────────────────────────────────────────────────

function withLiveActivityInfoPlist(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults['NSSupportsLiveActivities'] = true;
    cfg.modResults['NSSupportsLiveActivitiesFrequentUpdates'] = true;
    return cfg;
  });
}

// ─── 2. Write widget source files + inject Xcode target ──────────────────────

function withWidgetExtension(config) {
  return withDangerousMod(config, ['ios', (cfg) => {
    const iosDir = path.join(cfg.modRequest.projectRoot, 'ios');
    const widgetDir = path.join(iosDir, WIDGET_TARGET);
    const pbxprojPath = path.join(iosDir, 'MeetingNotes.xcodeproj', 'project.pbxproj');

    // Write widget source files
    fs.mkdirSync(widgetDir, { recursive: true });
    fs.writeFileSync(path.join(widgetDir, 'RecordingAttributes.swift'), RECORDING_ATTRIBUTES_SWIFT);
    fs.writeFileSync(path.join(widgetDir, 'RecordingWidgetLiveActivity.swift'), RECORDING_WIDGET_SWIFT);
    fs.writeFileSync(path.join(widgetDir, 'Info.plist'), WIDGET_INFO_PLIST);

    // Write LiveActivityModule files into main app folder
    const mainAppDir = path.join(iosDir, 'MeetingNotes');
    fs.writeFileSync(path.join(mainAppDir, 'LiveActivityModule.swift'), LIVE_ACTIVITY_MODULE_SWIFT);
    fs.writeFileSync(path.join(mainAppDir, 'LiveActivityModule.m'), LIVE_ACTIVITY_MODULE_M);

    // Parse Xcode project
    const xcode = require('xcode');
    const project = xcode.project(pbxprojPath);
    project.parseSync();

    if (project.pbxTargetByName(WIDGET_TARGET)) return cfg;

    // Add extension target (creates Sources, Resources, Frameworks phases automatically)
    const target = project.addTarget(WIDGET_TARGET, 'app_extension', WIDGET_TARGET, WIDGET_BUNDLE_ID);

    // Create group for widget sources
    const widgetGroupKey = project.pbxCreateGroup(WIDGET_TARGET, WIDGET_TARGET);
    const mainGroupKey = project.findPBXGroupKey({ name: 'MeetingNotes' });
    if (mainGroupKey) {
      const mainGroup = project.getPBXGroupByKey(mainGroupKey);
      if (mainGroup && mainGroup.children) {
        mainGroup.children.push({ value: widgetGroupKey, comment: WIDGET_TARGET });
      }
    }

    const objects = project.hash.project.objects;

    // addTarget creates buildPhases: [] with no Sources phase — must create it explicitly
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);

    // Add Swift sources to the widget target's Sources build phase
    ['RecordingWidgetLiveActivity.swift', 'RecordingAttributes.swift'].forEach((f) => {
      project.addSourceFile(f, { target: target.uuid }, widgetGroupKey);
    });

    // Set widget build settings
    const newNativeTarget = project.pbxNativeTargetSection()[target.uuid];
    if (newNativeTarget && newNativeTarget.buildConfigurationList) {
      const configList = project.pbxXCConfigurationList()[newNativeTarget.buildConfigurationList];
      if (configList && configList.buildConfigurations) {
        configList.buildConfigurations.forEach(function(item) {
          const buildConfig = project.pbxXCBuildConfigurationSection()[item.value];
          if (!buildConfig || !buildConfig.buildSettings) return;
          Object.assign(buildConfig.buildSettings, {
            SWIFT_VERSION: '5.0',
            IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
            TARGETED_DEVICE_FAMILY: '"1,2"',
            INFOPLIST_FILE: '"RecordingWidget/Info.plist"',
            DEVELOPMENT_TEAM: TEAM_ID,
            SKIP_INSTALL: 'YES',
            CODE_SIGN_STYLE: 'Automatic',
            PRODUCT_BUNDLE_IDENTIFIER: '"com.tio.meetingnotes.ios.RecordingWidget"',
            PRODUCT_NAME: '"$(TARGET_NAME)"',
          });
        });
      }
    }

    // addTarget already creates a Copy Files phase that embeds the appex in the main target.
    // We only need to add the dependency so widget builds before main app.
    const mainTarget = project.getFirstTarget();
    const mainTargetUuid = mainTarget.uuid;

    // Add LiveActivityModule files to main app target
    const appGroupKey = project.findPBXGroupKey({ name: 'MeetingNotes' });
    project.addSourceFile('MeetingNotes/LiveActivityModule.swift', { target: mainTargetUuid }, appGroupKey);
    project.addSourceFile('MeetingNotes/LiveActivityModule.m', { target: mainTargetUuid }, appGroupKey);

    // Main app depends on widget (so widget builds first)
    project.addTargetDependency(mainTargetUuid, [target.uuid]);

    fs.writeFileSync(pbxprojPath, project.writeSync());
    return cfg;
  }]);
}

// ─── 3. Raise deployment target ───────────────────────────────────────────────

function withDeploymentTarget(config) {
  return withDangerousMod(config, ['ios', (cfg) => {
    const iosDir = path.join(cfg.modRequest.projectRoot, 'ios');
    const propsPath = path.join(iosDir, 'Podfile.properties.json');
    if (fs.existsSync(propsPath)) {
      const props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
      props['ios.deploymentTarget'] = DEPLOYMENT_TARGET;
      fs.writeFileSync(propsPath, JSON.stringify(props, null, 2));
    }
    const pbxprojPath = path.join(iosDir, 'MeetingNotes.xcodeproj', 'project.pbxproj');
    if (fs.existsSync(pbxprojPath)) {
      let c = fs.readFileSync(pbxprojPath, 'utf8');
      c = c.replace(/IPHONEOS_DEPLOYMENT_TARGET = 15\.1;/g, `IPHONEOS_DEPLOYMENT_TARGET = ${DEPLOYMENT_TARGET};`);
      fs.writeFileSync(pbxprojPath, c);
    }
    return cfg;
  }]);
}

module.exports = function withLiveActivity(config) {
  config = withLiveActivityInfoPlist(config);
  config = withWidgetExtension(config);
  config = withDeploymentTarget(config);
  return config;
};
