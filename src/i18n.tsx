import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchPreferences, updatePreferences } from "./api/tikpalClient";
import type { AudioLibraryStorageId, AudioOutputCustomSettings, AudioOutputProfile, DisplaySleepStyle, FontTheme, MpdBitPerfectMode, PlaybackState, SourceState, UiLocale, UiPreferences, UiInputMethodId, RoomMode } from "./types";

export type TranslationParams = Record<string, string | number | null | undefined>;

export const defaultPreferences: UiPreferences = {
  locale: "en",
  inputMethodId: "keyboard-us",
  fontTheme: "system",
  audioOutputProfile: "everyday",
  audioOutputCustomSettings: {
    pureDirect: false,
    volumeNormalization: true,
    smoothTransition: true,
    automaticSampleRate: true,
    dsdMode: false,
    playbackStability: true
  },
  mpdBitPerfectMode: "standard",
  displaySleepEnabled: true,
  displaySleepMinutes: 10,
  displaySleepStyle: "meteor_shower",
  updatedAt: null,
  warning: null
};

export const localeInputMethods: Record<UiLocale, UiInputMethodId> = {
  en: "keyboard-us",
  "zh-CN": "pinyin",
  de: "keyboard-de",
  it: "keyboard-it",
  ko: "hangul",
  ja: "anthy",
  es: "keyboard-es"
};

export const languageOptions: Array<{ locale: UiLocale; label: string; shortLabel: string }> = [
  { locale: "en", label: "English", shortLabel: "EN" },
  { locale: "zh-CN", label: "中文", shortLabel: "中文" },
  { locale: "de", label: "Deutsch", shortLabel: "DE" },
  { locale: "it", label: "Italiano", shortLabel: "IT" },
  { locale: "ko", label: "한국어", shortLabel: "KO" },
  { locale: "ja", label: "日本語", shortLabel: "日本語" },
  { locale: "es", label: "Español", shortLabel: "ES" }
];

const displaySleepMinuteOptions = [5, 10, 15, 30, 60] as const;
const displaySleepStyleOptions: DisplaySleepStyle[] = ["meteor_shower", "clock", "now_playing", "starfield", "signal"];
const fontThemeOptions: FontTheme[] = ["system", "hardware", "precision", "sans", "serif", "mono"];
const audioOutputProfileOptions: AudioOutputProfile[] = ["pure", "everyday", "sleep", "custom"];
const FONT_THEME_STORAGE_KEY = "tikpal.fontTheme";
const LOCALE_STORAGE_KEY = "tikpal.locale";

const dictionaries: Record<UiLocale, Record<string, string>> = {
  en: {
    "app.name": "Tikpal",
    "common.active": "Active",
    "common.add": "Add",
    "common.apply": "Apply",
    "common.applying": "Applying...",
    "common.back": "Close",
    "common.cancel": "Cancel",
    "common.checkProxy": "Check proxy",
    "common.checkSetup": "Check setup",
    "common.clear": "Clear",
    "common.close": "Close",
    "common.closing": "Closing",
    "common.connected": "Connected",
    "common.connecting": "Connecting",
    "common.current": "Current",
    "common.delete": "Delete",
    "common.deleteQuestion": "Delete?",
    "common.direct": "Direct",
    "common.disabled": "Disabled",
    "common.enabled": "Enabled",
    "common.experimental": "Experimental",
    "common.failed": "Failed",
    "common.hidden": "Hidden",
    "common.loading": "Loading",
    "common.manual": "Manual",
    "common.muted": "Muted",
    "common.needProxyOn": "Needs proxy",
    "common.no": "No",
    "common.off": "Off",
    "common.offline": "Offline",
    "common.on": "On",
    "common.online": "Online",
    "common.opening": "Opening",
    "common.prewarming": "Prewarming",
    "common.proxy": "Proxy",
    "common.proxyOff": "Proxy Off",
    "common.proxyOn": "Proxy On",
    "common.ready": "Ready",
    "common.regionUnavailable": "Region unavailable",
    "common.saving": "Saving",
    "common.savedAutomatically": "Saved automatically",
    "common.scanning": "Scanning...",
    "common.syncing": "Syncing",
    "common.unavailable": "Unavailable",
    "common.visible": "Visible",
    "common.waiting": "Waiting",
    "common.yes": "Yes",
    "status.live": "Live",
    "status.offlineView": "Offline view",
    "status.updating": "Updating",
    "playback.nothingPlaying": "Nothing playing",
    "playback.unknownArtist": "Unknown artist",
    "playback.noAlbum": "No album",
    "playback.sourceUnknown": "Source unknown",
    "playback.playing": "Playing",
    "playback.paused": "Paused",
    "playback.stopped": "Stopped",
    "playback.previous": "Previous",
    "playback.play": "Play",
    "playback.pause": "Pause",
    "playback.next": "Next",
    "playback.favorite": "Favorite",
    "playback.removeFavorite": "Remove favorite",
    "playback.seekPosition": "Seek position",
    "playback.seekingTo": "Seeking to {time}...",
    "playback.controlUnavailable": "Playback control unavailable",
    "lyrics.listeningTo": "Listening to {source} audio...",
    "lyrics.identifying": "Identifying track...",
    "lyrics.hide": "Hide lyrics",
    "lyrics.show": "Show lyrics",
    "ambient.changeBrightness": "Swipe or scroll to change brightness",
    "ambient.changeVolume": "Swipe or scroll to change volume",
    "ambient.openSceneGallery": "Open scene gallery",
    "ambient.closeSceneGallery": "Close scene gallery",
    "ambient.sceneGallery": "Scene gallery",
    "ambient.sceneGallerySelect": "Choose {scene} for {mode}",
    "ambient.sceneGalleryEmpty": "No scenes are available yet.",
    "ambient.previousGalleryPage": "Previous gallery page",
    "ambient.nextGalleryPage": "Next gallery page",
    "ambient.sceneGalleryPage": "Page {page} of {total}",
    "ambient.previousScene": "Previous scene",
    "ambient.nextScene": "Next scene",
    "ambient.playbackMode": "Player and playback mode",
    "ambient.openPlayer": "Open player",
    "ambient.player": "Player",
    "ambient.repeatCurrent": "Repeat current track",
    "ambient.shuffle": "Shuffle playback",
    "ambient.muteSceneSound": "Mute scene sound",
    "ambient.unmuteSceneSound": "Unmute scene sound",
    "ambient.currentTime": "Current time",
    "ambient.moodSwitcher": "Mood switcher",
    "ambient.mood": "Mood",
    "ambient.chooseRoomMode": "Choose room mode",
    "ambient.roomModeLabel": "{mode} room mode",
    "ambient.brightness": "Brightness",
    "ambient.displayLevel": "Display level",
    "ambient.closeAdjustment": "Close {channel} adjustment",
    "source.library": "Library",
    "source.audio": "Audio",
    "source.scene": "Scene Sound",
    "source.radio": "Radio",
    "source.spotify": "Spotify",
    "source.bluetooth": "Bluetooth",
    "source.airplay": "AirPlay",
    "source.upnp": "DLNA",
    "source.explore": "Explore",
    "source.localQueueReady": "Local queue ready",
    "source.webPlayers": "Web players",
    "source.choose": "Choose audio source",
    "source.audioPicker": "Audio source picker",
    "source.enableRadio": "Enable Radio",
    "source.radioPresets": "Radio presets",
    "source.openSpotify": "Open Spotify",
    "source.pairPhone": "Pair phone",
    "source.openDlna": "Open DLNA",
    "source.openAirplay": "Open AirPlay",
    "source.libraryReadyPickTrack": "Library ready. Pick a track.",
    "source.readyAs": "{source} ready as {label}.",
    "source.connectedAs": "{source}: {label}.",
    "source.connectingAs": "Connecting as {label}",
    "source.connectedTo": "Connected to {label}",
    "source.ready": "{source} ready.",
    "handoff.title": "Connecting",
    "handoff.body": "Connect from your phone. This returns when playback starts.",
    "room.focus": "Focus",
    "room.calm": "Calm",
    "room.sleep": "Sleep",
    "room.hifi": "Hi-Fi",
    "room.focusIntent": "Deep work & reading",
    "room.calmIntent": "Unwind & relax",
    "room.sleepIntent": "Dim, timer, fade-out",
    "room.hifiIntent": "Pure music listening",
    "quickMenu.title": "Quick menu",
    "quickMenu.close": "Close quick menu",
    "quickMenu.screen": "Screen",
    "quickMenu.turnScreenOff": "Turn screen off",
    "quickMenu.turnScreenOn": "Turn screen on",
    "quickMenu.volume": "Volume",
    "quickMenu.mute": "Mute volume",
    "quickMenu.restoreVolume": "Restore volume",
    "quickMenu.time": "Time",
    "quickMenu.hideTime": "Hide time display",
    "quickMenu.showTime": "Show time display",
    "quickMenu.sleep": "Sleep",
    "quickMenu.sleepTikpal": "Sleep Tikpal",
    "quickMenu.tapToSleep": "Tap to sleep",
    "startup.setRoomMood": "Set Your Room Mood",
    "startup.roomModes": "Startup room modes",
    "onboarding.ariaLabel": "Startup guide",
    "onboarding.title": "Welcome to Tikpal",
    "onboarding.subtitle": "A short hands-on preview. You can hide the background or mute scene sound while practicing.",
    "onboarding.step1Title": "Tap once to bring controls back",
    "onboarding.step1Body": "When the room view is quiet, a single tap gently reveals the controls.",
    "onboarding.step1Note": "Try this when you only need a quick check without leaving Ambient.",
    "onboarding.step2Title": "Use the two edges like sliders",
    "onboarding.step2Body": "The left edge changes screen brightness. The right edge changes volume.",
    "onboarding.step2Note": "Slide slowly first; the level follows your finger from low to high.",
    "onboarding.step3Title": "Swipe down for Player, long press for Quick Menu",
    "onboarding.step3Body": "Player is for music and sources. Quick Menu is for screen, clock, volume, and sleep.",
    "onboarding.step3Note": "Ambient is always your safe home view.",
    "onboarding.previewControls": "Wizard preview controls",
    "onboarding.hideBackground": "Hide background",
    "onboarding.showBackground": "Show background",
    "onboarding.muteSound": "Mute scene sound",
    "onboarding.restoreSound": "Restore scene sound",
    "onboarding.practicePrompt": "Try the gesture in the sample",
    "onboarding.practiceSuccess": "Nice — gesture recognized",
    "onboarding.footer": "This is only a preview. It will not change your source or room mode.",
    "onboarding.next": "Next",
    "onboarding.getStarted": "Finish",
    "settings.console": "Console",
    "settings.preferences": "Preferences",
    "settings.library": "Library",
    "settings.link": "Link",
    "settings.care": "Care",
    "settings.preferencesDesc": "Audio, display, type, and listening overlays.",
    "settings.libraryDesc": "Local music, USB, NAS, and scan status.",
    "settings.linkDesc": "Connectivity and remote reachability.",
    "settings.careDesc": "Guarded restart and shutdown actions.",
    "settings.language": "Language",
    "settings.languageMeta": "Device UI and keyboard",
    "settings.languageDetail": "Choose Tikpal UI language. Keyboard starts in English; the language key switches here directly.",
    "settings.languageSaved": "Language saved.",
    "settings.languageSavedWithWarning": "Language saved. Keyboard will sync soon.",
    "settings.audioOutput": "Audio Output",
    "settings.dsp": "DSP",
    "settings.eqReady": "EQ Ready",
    "settings.adjustable": "Adjustable",
    "settings.readOnly": "Read-only",
    "settings.display": "Display",
    "settings.screenReady": "Screen ready",
    "settings.brightnessReady": "Brightness ready",
    "settings.displayBrightness": "Display Brightness",
    "settings.brightnessPanel": "Display brightness panel",
    "settings.hardware": "Hardware",
    "settings.dimStep": "Dim -10",
    "settings.boostStep": "Boost +10",
    "settings.screenSleep": "Screen Sleep",
    "settings.screenSleepMeta": "Touch wakes screen.",
    "settings.sleepStyle": "Sleep Style",
    "settings.sleepStyle.meteor_shower": "Meteor Shower",
    "settings.sleepStyle.clock": "Clock",
    "settings.sleepStyle.now_playing": "Now Playing",
    "settings.sleepStyle.starfield": "Starfield",
    "settings.sleepStyle.signal": "Signal",
    "settings.previewSleepStyle": "Preview",
    "settings.stopSleepPreview": "Stop screen saver preview",
    "settings.turnOffAfter": "Turn off after",
    "settings.sleepAfterMinutes": "{minutes} min",
    "settings.timeNight": "Time & Night",
    "settings.night": "Night",
    "settings.auto": "Auto",
    "settings.localLibrary": "Local Library",
    "settings.savedOnDevice": "Music saved on this device",
    "settings.nasSources": "NAS Sources",
    "settings.addNas": "Add NAS",
    "settings.addNasInSettings": "Add NAS in Settings",
    "settings.usb": "USB",
    "settings.notMounted": "Not mounted",
    "settings.portableStorage": "Portable storage",
    "settings.portableStorageMounted": "Portable storage mounted",
    "settings.libraryScan": "Library Scan",
    "settings.scanLibrary": "Scan library",
    "settings.scanInProgress": "Scan in progress",
    "settings.font": "Font",
    "settings.chooseTypography": "Choose the kiosk typography",
    "settings.skin": "Skin",
    "settings.switchSkin": "Switch skin",
    "settings.lyrics": "Lyrics",
    "settings.tuneLyrics": "Tune lyrics",
    "settings.system": "System",
    "settings.wizard": "Wizard",
    "settings.startupGuide": "Startup guide",
    "settings.wizardMeta": "Review the first-use gestures again.",
    "settings.openWizard": "Open wizard",
    "settings.limited": "Limited",
    "settings.needsAttention": "Needs attention",
    "settings.restart": "Restart",
    "settings.shutdown": "Shutdown",
    "settings.confirmNeeded": "Confirm Needed",
    "settings.systemReboot": "System reboot",
    "settings.powerOff": "Power off",
    "settings.restartSystem": "Restart system",
    "settings.shutdownSystem": "Shutdown system",
    "settings.tapAgainRestart": "Tap again to restart",
    "settings.tapAgainPowerOff": "Tap again to power off",
    "settings.adjustType": "Adjust type",
    "settings.proxyKeyboard": "Proxy & keyboard",
    "settings.proxyReady": "Proxy ready",
    "settings.officialWebPlayers": "Official web players",
    "settings.exploreHelp": "Saves automatically. If a player won’t open, switch Proxy and retry.",
    "settings.enterProxyUrl": "Enter a complete proxy URL",
    "settings.nightBrightness": "{percent}% night brightness",
    "settings.nasStatus": "NAS status",
    "settings.tracks": "{count} tracks",
    "settings.savedCount": "{count} saved",
    "library.source": "Source",
    "library.local": "Local",
    "library.nas": "NAS",
    "library.usb": "USB",
    "library.favorites": "Favorites",
    "library.recentlyAdded": "Recently Added",
    "library.localShort": "{count} local",
    "library.nasShort": "{count} NAS",
    "library.usbShort": "{count} USB",
    "library.savedShort": "{count} saved",
    "library.newShort": "{count} new",
    "library.copyToLocal": "Copy to Local",
    "library.deleteFromLocal": "Delete from Local",
    "library.search": "Search {storage}",
    "library.clearSearch": "Clear search",
    "library.localStorage": "Local storage: {free} free",
    "library.localStorageUnavailable": "Local storage unavailable",
    "library.free": "{free} free",
    "library.backMain": "Back to main screen",
    "library.loading": "Loading music library...",
    "library.noMatches": "No matches. Try another search.",
    "library.emptyNas": "Add NAS in Settings.",
    "library.emptyUsb": "No USB tracks found. Check the drive, then scan.",
    "library.emptyFavorites": "No favorites yet. Tap the heart on a track.",
    "library.emptyRecent": "No recent tracks yet.",
    "library.emptyLocal": "No local tracks yet. Copy from USB or scan.",
    "library.playingFromLocal": "Playing from Local.",
    "library.playingFromNas": "Playing from NAS.",
    "library.playingFromUsb": "Playing from USB.",
    "library.savedToLocal": "Saved to Local.",
    "library.alreadySaved": "Already saved locally.",
    "library.savedFavorite": "Saved to Favorites.",
    "library.removedFavorite": "Removed from Favorites.",
    "library.removedLocal": "Removed from Local.",
    "radio.threeFresh": "Three fresh picks. Tap one to play.",
    "radio.loading": "Loading stations...",
    "radio.empty": "No stations here. Try Random.",
    "radio.random": "Random",
    "explore.pickLeft": "Pick music on the left",
    "explore.noWebPlayer": "No web player",
    "explore.chooseBelow": "Choose a web player below",
    "explore.openLeft": "Opening on the left",
    "explore.couldNotOpen": "Could not open",
    "explore.proxyActive": "Proxy active",
    "explore.proxyChangeInSettings": "Change Proxy in Settings.",
    "explore.proxyRequired": "Turn Proxy On to open this player.",
    "explore.directConnection": "Direct connection",
    "explore.footer": "Choose music on the left. Tikpal controls stay here.",
    "explore.webPlayers": "Music web players",
    "explore.tikpalControls": "Tikpal web controls",
    "explore.font": "Font",
    "explore.leftFont": "Left provider font size",
    "explore.small": "Small",
    "explore.medium": "Medium",
    "explore.large": "Large",
    "remote.title": "Tikpal Remote",
    "remote.accessKey": "Access key",
    "remote.optionalAccessKey": "Optional access key",
    "remote.noKey": "No key",
    "remote.refresh": "Refresh",
    "remote.sources": "Sources",
    "remote.room": "Room",
    "remote.hifiEq": "Hi-Fi EQ",
    "remote.scene": "Scene",
    "remote.display": "Display",
    "remote.startExplore": "Start Explore",
    "remote.proxyOn": "Proxy On",
    "remote.proxyOff": "Proxy Off",
    "remote.soundOn": "Sound On",
    "remote.soundOff": "Sound Off",
    "error.accessKey": "Check the access key.",
    "error.noConnection": "No connection yet. Reopen the source and try again.",
    "error.proxy": "Check Web Proxy and retry.",
    "error.brightness": "Brightness did not change. Try a lower level.",
    "error.copy": "Could not save to Local. Try again.",
    "error.delete": "Could not remove this track. Try again.",
    "error.favorite": "Could not update Favorites. Try again.",
    "error.radio": "Radio is not ready. Try another station.",
    "error.library": "Library is not ready. Scan or retry.",
    "error.explore": "Explore did not open. Check Web Proxy and retry.",
    "error.volume": "Volume did not change. Try again.",
    "error.timeout": "This took too long. Try again.",
    "error.connection": "Connection is slow. Try again.",
    "error.generic": "Needs attention. Try again."
  },
  "zh-CN": {},
  de: {},
  it: {},
  ko: {},
  ja: {},
  es: {}
};

Object.assign(dictionaries["zh-CN"], {
  "common.active": "正在使用", "common.add": "添加", "common.apply": "应用", "common.applying": "应用中...", "common.back": "关闭", "common.cancel": "取消", "common.checkProxy": "检查代理", "common.checkSetup": "检查设置", "common.clear": "清除", "common.close": "关闭", "common.closing": "关闭中", "common.connected": "已连接", "common.connecting": "连接中", "common.current": "当前", "common.delete": "删除", "common.deleteQuestion": "删除？", "common.direct": "直连", "common.disabled": "已关闭", "common.enabled": "已启用", "common.experimental": "实验", "common.failed": "失败", "common.hidden": "隐藏", "common.loading": "加载中", "common.manual": "手动", "common.muted": "静音", "common.needProxyOn": "需要使用代理", "common.no": "否", "common.off": "关", "common.offline": "离线", "common.on": "开", "common.online": "在线", "common.opening": "打开中", "common.prewarming": "预热中", "common.proxy": "代理", "common.proxyOff": "Proxy Off", "common.proxyOn": "Proxy On", "common.ready": "就绪", "common.regionUnavailable": "当前地区不可用", "common.saving": "保存中", "common.savedAutomatically": "已自动保存", "common.scanning": "扫描中...", "common.syncing": "同步中", "common.unavailable": "不可用", "common.visible": "显示", "common.waiting": "等待中", "common.yes": "是",
  "status.live": "实时", "status.offlineView": "离线视图", "status.updating": "更新中", "playback.nothingPlaying": "未播放", "playback.unknownArtist": "未知艺人", "playback.noAlbum": "无专辑", "playback.sourceUnknown": "未知音源", "playback.playing": "播放中", "playback.paused": "已暂停", "playback.stopped": "已停止", "playback.previous": "上一曲", "playback.play": "播放", "playback.pause": "暂停", "playback.next": "下一曲", "playback.favorite": "收藏", "playback.removeFavorite": "取消收藏", "playback.seekPosition": "播放位置", "playback.seekingTo": "跳转到 {time}...", "playback.controlUnavailable": "播放控制不可用", "lyrics.listeningTo": "正在听取 {source} 音频...", "lyrics.identifying": "正在识别歌曲...", "lyrics.hide": "隐藏歌词", "lyrics.show": "显示歌词",
  "ambient.changeBrightness": "滑动或滚动调节亮度", "ambient.changeVolume": "滑动或滚动调节音量", "ambient.openSceneGallery": "打开场景图库", "ambient.closeSceneGallery": "关闭场景图库", "ambient.sceneGallery": "场景图库", "ambient.sceneGallerySelect": "选择 {scene}，进入 {mode}", "ambient.sceneGalleryEmpty": "暂无可用场景。", "ambient.previousGalleryPage": "上一页场景", "ambient.nextGalleryPage": "下一页场景", "ambient.sceneGalleryPage": "第 {page} / {total} 页", "ambient.previousScene": "上一个场景", "ambient.nextScene": "下一个场景", "ambient.playbackMode": "播放器与播放模式", "ambient.openPlayer": "打开播放器", "ambient.player": "播放器", "ambient.repeatCurrent": "单曲循环", "ambient.shuffle": "随机播放", "ambient.muteSceneSound": "关闭场景声音", "ambient.unmuteSceneSound": "打开场景声音", "ambient.currentTime": "当前时间", "ambient.moodSwitcher": "氛围切换", "ambient.mood": "氛围", "ambient.chooseRoomMode": "选择房间模式", "ambient.roomModeLabel": "{mode} 房间模式", "ambient.brightness": "亮度", "ambient.displayLevel": "显示亮度", "ambient.closeAdjustment": "关闭 {channel} 调节",
  "source.library": "曲库", "source.audio": "音频", "source.scene": "场景声音", "source.radio": "电台", "source.spotify": "Spotify", "source.bluetooth": "蓝牙", "source.airplay": "AirPlay", "source.upnp": "DLNA", "source.explore": "Explore", "source.webPlayers": "网页播放器", "source.choose": "选择音源", "source.audioPicker": "音源选择", "source.enableRadio": "启用电台", "source.radioPresets": "电台预设", "source.openSpotify": "打开 Spotify", "source.pairPhone": "配对手机", "source.openDlna": "打开 DLNA", "source.openAirplay": "打开 AirPlay", "source.libraryReadyPickTrack": "曲库就绪。请选择歌曲。", "source.readyAs": "{source} 已就绪：{label}。", "source.connectedAs": "{source}：{label}。", "source.connectingAs": "正在以 {label} 连接", "source.connectedTo": "已连接到 {label}", "source.ready": "{source} 已就绪。",
  "handoff.title": "连接中", "handoff.body": "从手机连接。播放开始后会自动返回。", "room.focus": "专注", "room.calm": "放松", "room.sleep": "睡眠", "room.hifi": "Hi-Fi", "room.focusIntent": "深度工作与阅读", "room.calmIntent": "放松与休息", "room.sleepIntent": "调暗、定时、淡出", "room.hifiIntent": "纯音乐聆听",
  "quickMenu.title": "快捷菜单", "quickMenu.close": "关闭快捷菜单", "quickMenu.screen": "屏幕", "quickMenu.turnScreenOff": "关闭屏幕", "quickMenu.turnScreenOn": "打开屏幕", "quickMenu.volume": "音量", "quickMenu.mute": "静音", "quickMenu.restoreVolume": "恢复音量", "quickMenu.time": "时间", "quickMenu.hideTime": "隐藏时间", "quickMenu.showTime": "显示时间", "quickMenu.sleep": "睡眠", "quickMenu.sleepTikpal": "让 Tikpal 休眠", "quickMenu.tapToSleep": "点击休眠", "startup.setRoomMood": "设置房间氛围", "startup.roomModes": "启动房间模式", "onboarding.ariaLabel": "开机引导", "onboarding.title": "欢迎使用 Tikpal", "onboarding.subtitle": "几个手势就能快速上手。", "onboarding.tapTitle": "点击唤醒控制", "onboarding.tapBody": "在 Ambient 页面轻点一下即可重新显示控制层。", "onboarding.brightnessTitle": "左侧调节亮度", "onboarding.brightnessBody": "在左边缘上下滑动，可以调暗或调亮屏幕。", "onboarding.volumeTitle": "右侧调节音量", "onboarding.volumeBody": "在右边缘上下滑动，可以改变收听音量。", "onboarding.playerTitle": "下滑进入播放页", "onboarding.playerBody": "想切换歌曲、音源或播放控制时，进入 Player。", "onboarding.menuTitle": "长按打开快捷菜单", "onboarding.menuBody": "使用快捷菜单控制屏幕、时间和睡眠。", "onboarding.footer": "之后可在设置中重新打开此引导。", "onboarding.getStarted": "开始使用",
  "settings.console": "控制台", "settings.preferences": "偏好", "settings.library": "曲库", "settings.link": "连接", "settings.care": "维护", "settings.language": "语言", "settings.languageMeta": "界面与键盘", "settings.languageDetail": "选择 Tikpal 界面语言。键盘默认英文，语言键直接切到当前语言。", "settings.languageSaved": "语言已保存。", "settings.languageSavedWithWarning": "语言已保存。键盘稍后同步。", "settings.audioOutput": "音频输出", "settings.dsp": "DSP", "settings.eqReady": "EQ 就绪", "settings.display": "显示", "settings.timeNight": "时间与夜间", "settings.localLibrary": "本地曲库", "settings.savedOnDevice": "保存在本机的音乐", "settings.nasSources": "NAS 来源", "settings.addNas": "添加 NAS", "settings.usb": "USB", "settings.notMounted": "未挂载", "settings.libraryScan": "曲库扫描", "settings.scanLibrary": "扫描曲库", "settings.font": "字体", "settings.skin": "皮肤", "settings.lyrics": "歌词", "settings.system": "系统", "settings.restart": "重启", "settings.shutdown": "关机", "settings.confirmNeeded": "需要确认", "settings.restartSystem": "重启系统", "settings.shutdownSystem": "关闭系统", "settings.tapAgainRestart": "再点一次重启", "settings.tapAgainPowerOff": "再点一次关机", "settings.tracks": "{count} 首", "settings.savedCount": "{count} 个已保存",
  "library.source": "音源", "library.local": "本地", "library.nas": "NAS", "library.usb": "USB", "library.favorites": "收藏", "library.recentlyAdded": "最近添加", "library.copyToLocal": "复制到本地", "library.deleteFromLocal": "从本地删除", "library.search": "搜索 {storage}", "library.clearSearch": "清除搜索", "library.free": "剩余 {free}", "library.backMain": "返回主界面", "library.loading": "正在加载曲库...", "library.noMatches": "没有匹配。换个关键词试试。", "library.emptyNas": "请在 Settings 添加 NAS。", "library.emptyUsb": "未找到 USB 音频。检查 U 盘后扫描。", "library.emptyFavorites": "还没有收藏。点击歌曲上的爱心。", "library.emptyRecent": "暂无最近添加。", "library.emptyLocal": "暂无本地歌曲。可从 USB 复制或扫描。", "library.playingFromLocal": "正在播放本地音乐。", "library.playingFromNas": "正在播放 NAS 音乐。", "library.playingFromUsb": "正在播放 USB 音乐。", "library.savedToLocal": "已保存到本地。", "library.alreadySaved": "本地已存在。", "library.savedFavorite": "已加入收藏。", "library.removedFavorite": "已移出收藏。", "library.removedLocal": "已从本地删除。",
  "radio.threeFresh": "随机 3 个推荐，点选后播放。", "radio.loading": "正在加载电台...", "radio.empty": "这里没有电台。试试 Random。", "radio.random": "随机",
  "explore.pickLeft": "在左侧选择音乐", "explore.noWebPlayer": "未打开网页播放器", "explore.chooseBelow": "从下面选择网页播放器", "explore.openLeft": "正在左侧打开", "explore.couldNotOpen": "无法打开", "explore.proxyActive": "代理已启用", "explore.proxyChangeInSettings": "请到 Settings 修改 Proxy。", "explore.proxyRequired": "打开 Proxy 后再进入这个播放器。", "explore.directConnection": "直连", "explore.footer": "在左侧选择音乐。Tikpal 控制保留在这里。", "explore.font": "字体", "explore.small": "小", "explore.medium": "中", "explore.large": "大",
  "remote.title": "Tikpal 遥控", "remote.accessKey": "访问密钥", "remote.optionalAccessKey": "可选访问密钥", "remote.noKey": "无需密钥", "remote.refresh": "刷新", "remote.sources": "音源", "remote.room": "房间", "remote.hifiEq": "Hi-Fi EQ", "remote.scene": "场景", "remote.display": "显示", "remote.startExplore": "打开 Explore", "remote.proxyOn": "代理开", "remote.proxyOff": "代理关", "remote.soundOn": "声音开", "remote.soundOff": "声音关"
});

Object.assign(dictionaries.de, {
  "common.active": "Aktiv", "common.back": "Schließen", "common.cancel": "Abbrechen", "common.close": "Schließen", "common.connected": "Verbunden", "common.connecting": "Verbinden", "common.current": "Aktuell", "common.delete": "Löschen", "common.deleteQuestion": "Löschen?", "common.direct": "Direkt", "common.hidden": "Ausgeblendet", "common.muted": "Stumm", "common.no": "Nein", "common.off": "Aus", "common.on": "Ein", "common.opening": "Öffnen", "common.prewarming": "Vorwärmen", "common.proxy": "Proxy", "common.ready": "Bereit", "common.saving": "Speichern", "common.syncing": "Synchronisieren", "common.unavailable": "Nicht verfügbar", "common.visible": "Sichtbar", "common.waiting": "Warten", "common.yes": "Ja",
  "playback.nothingPlaying": "Keine Wiedergabe", "playback.unknownArtist": "Unbekannter Künstler", "playback.noAlbum": "Kein Album", "playback.sourceUnknown": "Quelle unbekannt", "playback.playing": "Wiedergabe", "playback.paused": "Pausiert", "playback.previous": "Zurück", "playback.play": "Play", "playback.pause": "Pause", "playback.next": "Weiter", "source.library": "Mediathek", "source.radio": "Radio", "source.scene": "Szenenklang", "source.explore": "Explore",
  "room.focus": "Fokus", "room.calm": "Ruhe", "room.sleep": "Schlaf", "room.hifi": "Hi-Fi", "quickMenu.screen": "Bildschirm", "quickMenu.volume": "Lautstärke", "quickMenu.time": "Zeit", "quickMenu.sleep": "Schlaf", "quickMenu.tapToSleep": "Zum Schlafen tippen",
  "settings.preferences": "Präferenzen", "settings.library": "Mediathek", "settings.link": "Verbindung", "settings.care": "Pflege", "settings.language": "Sprache", "settings.languageMeta": "UI und Tastatur", "settings.languageDetail": "Wähle die Tikpal Sprache. Die Tastatur startet auf Englisch; die Sprachentaste wechselt direkt hierher.", "settings.audioOutput": "Audioausgang", "settings.display": "Display", "settings.font": "Schrift", "settings.skin": "Design", "settings.lyrics": "Lyrics", "settings.restart": "Neustart", "settings.shutdown": "Ausschalten",
  "library.local": "Lokal", "library.favorites": "Favoriten", "library.recentlyAdded": "Neu", "library.copyToLocal": "Lokal kopieren", "library.search": "{storage} suchen", "library.noMatches": "Keine Treffer. Anders suchen.", "library.emptyNas": "NAS in Settings hinzufügen.", "library.playingFromLocal": "Wiedergabe von Lokal.", "library.playingFromNas": "Wiedergabe von NAS.", "library.playingFromUsb": "Wiedergabe von USB.",
  "explore.pickLeft": "Links Musik wählen", "explore.chooseBelow": "Webplayer wählen", "explore.font": "Schrift", "explore.small": "Klein", "explore.medium": "Mittel", "explore.large": "Groß", "remote.title": "Tikpal Remote", "remote.accessKey": "Zugangsschlüssel", "remote.noKey": "Kein Schlüssel"
});

Object.assign(dictionaries.it, {
  "common.active": "Attivo", "common.back": "Chiudi", "common.cancel": "Annulla", "common.close": "Chiudi", "common.connected": "Connesso", "common.connecting": "Connessione", "common.delete": "Elimina", "common.deleteQuestion": "Eliminare?", "common.direct": "Diretto", "common.hidden": "Nascosto", "common.muted": "Muto", "common.no": "No", "common.off": "Off", "common.on": "On", "common.opening": "Apertura", "common.prewarming": "Preparazione", "common.proxy": "Proxy", "common.ready": "Pronto", "common.saving": "Salvataggio", "common.unavailable": "Non disponibile", "common.visible": "Visibile", "common.yes": "Sì",
  "playback.nothingPlaying": "Niente in riproduzione", "playback.unknownArtist": "Artista sconosciuto", "playback.noAlbum": "Nessun album", "playback.playing": "In riproduzione", "playback.paused": "In pausa", "playback.previous": "Precedente", "playback.play": "Play", "playback.pause": "Pausa", "playback.next": "Successivo", "source.library": "Libreria", "source.radio": "Radio", "source.scene": "Audio scena", "source.explore": "Explore",
  "room.focus": "Focus", "room.calm": "Calma", "room.sleep": "Sonno", "room.hifi": "Hi-Fi", "quickMenu.screen": "Schermo", "quickMenu.volume": "Volume", "quickMenu.time": "Ora", "quickMenu.sleep": "Sonno", "quickMenu.tapToSleep": "Tocca per dormire",
  "settings.preferences": "Preferenze", "settings.library": "Libreria", "settings.link": "Collegamento", "settings.care": "Cura", "settings.language": "Lingua", "settings.languageMeta": "UI e tastiera", "settings.languageDetail": "Scegli la lingua di Tikpal. La tastiera parte in inglese; il tasto lingua passa qui direttamente.", "settings.audioOutput": "Uscita audio", "settings.display": "Display", "settings.font": "Font", "settings.skin": "Tema", "settings.lyrics": "Testi",
  "library.local": "Locale", "library.favorites": "Preferiti", "library.copyToLocal": "Copia in locale", "library.search": "Cerca {storage}", "library.noMatches": "Nessun risultato. Prova un'altra ricerca.", "library.playingFromLocal": "Riproduzione da Locale.", "library.playingFromNas": "Riproduzione da NAS.", "library.playingFromUsb": "Riproduzione da USB.",
  "explore.pickLeft": "Scegli musica a sinistra", "explore.font": "Font", "explore.small": "Piccolo", "explore.medium": "Medio", "explore.large": "Grande", "remote.title": "Tikpal Remote", "remote.accessKey": "Chiave di accesso"
});

Object.assign(dictionaries.ko, {
  "common.active": "활성", "common.back": "닫기", "common.cancel": "취소", "common.close": "닫기", "common.connected": "연결됨", "common.connecting": "연결 중", "common.delete": "삭제", "common.deleteQuestion": "삭제할까요?", "common.direct": "직접", "common.hidden": "숨김", "common.muted": "음소거", "common.no": "아니요", "common.off": "꺼짐", "common.on": "켜짐", "common.opening": "여는 중", "common.prewarming": "예열 중", "common.proxy": "프록시", "common.ready": "준비됨", "common.saving": "저장 중", "common.unavailable": "사용 불가", "common.visible": "표시", "common.yes": "예",
  "playback.nothingPlaying": "재생 중 아님", "playback.unknownArtist": "알 수 없는 아티스트", "playback.noAlbum": "앨범 없음", "playback.playing": "재생 중", "playback.paused": "일시정지", "playback.previous": "이전", "playback.play": "재생", "playback.pause": "일시정지", "playback.next": "다음", "source.library": "라이브러리", "source.radio": "라디오", "source.scene": "장면 사운드", "source.explore": "Explore",
  "room.focus": "집중", "room.calm": "휴식", "room.sleep": "수면", "room.hifi": "Hi-Fi", "quickMenu.screen": "화면", "quickMenu.volume": "볼륨", "quickMenu.time": "시간", "quickMenu.sleep": "수면", "quickMenu.tapToSleep": "눌러서 수면",
  "settings.preferences": "환경설정", "settings.library": "라이브러리", "settings.link": "연결", "settings.care": "관리", "settings.language": "언어", "settings.languageMeta": "UI와 키보드", "settings.languageDetail": "Tikpal 언어를 선택합니다. 키보드는 영어로 시작하고 언어 키로 바로 전환합니다.", "settings.audioOutput": "오디오 출력", "settings.display": "디스플레이", "settings.font": "글꼴", "settings.skin": "스킨", "settings.lyrics": "가사",
  "library.local": "로컬", "library.favorites": "즐겨찾기", "library.copyToLocal": "로컬에 복사", "library.search": "{storage} 검색", "library.noMatches": "결과 없음. 다른 검색어를 입력하세요.", "library.playingFromLocal": "로컬에서 재생 중.", "library.playingFromNas": "NAS에서 재생 중.", "library.playingFromUsb": "USB에서 재생 중.",
  "explore.pickLeft": "왼쪽에서 음악 선택", "explore.font": "글꼴", "explore.small": "작게", "explore.medium": "보통", "explore.large": "크게", "remote.title": "Tikpal 리모컨", "remote.accessKey": "접근 키"
});

Object.assign(dictionaries.ja, {
  "common.active": "有効", "common.back": "閉じる", "common.cancel": "キャンセル", "common.close": "閉じる", "common.connected": "接続済み", "common.connecting": "接続中", "common.delete": "削除", "common.deleteQuestion": "削除しますか？", "common.direct": "直接", "common.hidden": "非表示", "common.muted": "ミュート", "common.no": "いいえ", "common.off": "オフ", "common.on": "オン", "common.opening": "起動中", "common.prewarming": "準備中", "common.proxy": "プロキシ", "common.ready": "準備完了", "common.saving": "保存中", "common.unavailable": "利用不可", "common.visible": "表示", "common.yes": "はい",
  "playback.nothingPlaying": "再生していません", "playback.unknownArtist": "不明なアーティスト", "playback.noAlbum": "アルバムなし", "playback.playing": "再生中", "playback.paused": "一時停止", "playback.previous": "前へ", "playback.play": "再生", "playback.pause": "一時停止", "playback.next": "次へ", "source.library": "ライブラリ", "source.radio": "ラジオ", "source.scene": "シーンサウンド", "source.explore": "Explore",
  "room.focus": "集中", "room.calm": "リラックス", "room.sleep": "スリープ", "room.hifi": "Hi-Fi", "quickMenu.screen": "画面", "quickMenu.volume": "音量", "quickMenu.time": "時間", "quickMenu.sleep": "スリープ", "quickMenu.tapToSleep": "タップでスリープ",
  "settings.preferences": "設定", "settings.library": "ライブラリ", "settings.link": "接続", "settings.care": "管理", "settings.language": "言語", "settings.languageMeta": "UI とキーボード", "settings.languageDetail": "Tikpal の表示言語を選びます。キーボードは英語で始まり、言語キーで直接切り替えます。", "settings.audioOutput": "音声出力", "settings.display": "ディスプレイ", "settings.font": "フォント", "settings.skin": "スキン", "settings.lyrics": "歌詞",
  "library.local": "ローカル", "library.favorites": "お気に入り", "library.copyToLocal": "ローカルにコピー", "library.search": "{storage}を検索", "library.noMatches": "一致なし。別の語で検索してください。", "library.playingFromLocal": "ローカルから再生中。", "library.playingFromNas": "NAS から再生中。", "library.playingFromUsb": "USB から再生中。",
  "explore.pickLeft": "左で音楽を選択", "explore.font": "フォント", "explore.small": "小", "explore.medium": "中", "explore.large": "大", "remote.title": "Tikpal Remote", "remote.accessKey": "アクセスキー"
});

Object.assign(dictionaries.es, {
  "common.active": "Activo", "common.back": "Cerrar", "common.cancel": "Cancelar", "common.close": "Cerrar", "common.connected": "Conectado", "common.connecting": "Conectando", "common.delete": "Eliminar", "common.deleteQuestion": "¿Eliminar?", "common.direct": "Directo", "common.hidden": "Oculto", "common.muted": "Silencio", "common.no": "No", "common.off": "Off", "common.on": "On", "common.opening": "Abriendo", "common.prewarming": "Preparando", "common.proxy": "Proxy", "common.ready": "Listo", "common.saving": "Guardando", "common.unavailable": "No disponible", "common.visible": "Visible", "common.yes": "Sí",
  "playback.nothingPlaying": "Nada en reproducción", "playback.unknownArtist": "Artista desconocido", "playback.noAlbum": "Sin álbum", "playback.playing": "Reproduciendo", "playback.paused": "Pausado", "playback.previous": "Anterior", "playback.play": "Reproducir", "playback.pause": "Pausa", "playback.next": "Siguiente", "source.library": "Biblioteca", "source.radio": "Radio", "source.scene": "Sonido de escena", "source.explore": "Explore",
  "room.focus": "Focus", "room.calm": "Calma", "room.sleep": "Sueño", "room.hifi": "Hi-Fi", "quickMenu.screen": "Pantalla", "quickMenu.volume": "Volumen", "quickMenu.time": "Hora", "quickMenu.sleep": "Sueño", "quickMenu.tapToSleep": "Toca para dormir",
  "settings.preferences": "Preferencias", "settings.library": "Biblioteca", "settings.link": "Conexión", "settings.care": "Cuidado", "settings.language": "Idioma", "settings.languageMeta": "UI y teclado", "settings.languageDetail": "Elige el idioma de Tikpal. El teclado empieza en inglés; la tecla de idioma cambia aquí directamente.", "settings.audioOutput": "Salida de audio", "settings.display": "Pantalla", "settings.font": "Fuente", "settings.skin": "Tema", "settings.lyrics": "Letras",
  "library.local": "Local", "library.favorites": "Favoritos", "library.copyToLocal": "Copiar a Local", "library.search": "Buscar {storage}", "library.noMatches": "Sin resultados. Prueba otra búsqueda.", "library.playingFromLocal": "Reproduciendo desde Local.", "library.playingFromNas": "Reproduciendo desde NAS.", "library.playingFromUsb": "Reproduciendo desde USB.",
  "explore.pickLeft": "Elige música a la izquierda", "explore.font": "Fuente", "explore.small": "Pequeño", "explore.medium": "Medio", "explore.large": "Grande", "remote.title": "Tikpal Remote", "remote.accessKey": "Clave de acceso"
});

Object.assign(dictionaries.de, {
  "app.name": "Tikpal", "common.add": "Hinzufügen", "common.apply": "Anwenden", "common.applying": "Wird angewendet...", "common.checkSetup": "Setup prüfen", "common.clear": "Leeren", "common.closing": "Schließt", "common.disabled": "Deaktiviert", "common.enabled": "Aktiviert", "common.experimental": "Experimentell", "common.failed": "Fehlgeschlagen", "common.loading": "Lädt", "common.manual": "Manuell", "common.offline": "Offline", "common.online": "Online", "common.savedAutomatically": "Automatisch gespeichert", "common.scanning": "Scan läuft...",
  "status.live": "Live", "status.offlineView": "Offline-Ansicht", "status.updating": "Aktualisiert", "playback.stopped": "Gestoppt", "playback.favorite": "Favorit", "playback.removeFavorite": "Favorit entfernen", "playback.seekPosition": "Position", "playback.seekingTo": "Springt zu {time}...", "playback.controlUnavailable": "Steuerung nicht verfügbar", "lyrics.listeningTo": "Hört {source} Audio...", "lyrics.identifying": "Titel wird erkannt...", "lyrics.hide": "Lyrics ausblenden", "lyrics.show": "Lyrics anzeigen",
  "ambient.changeBrightness": "Wischen oder scrollen für Helligkeit", "ambient.changeVolume": "Wischen oder scrollen für Lautstärke", "ambient.openSceneGallery": "Szenengalerie öffnen", "ambient.closeSceneGallery": "Szenengalerie schließen", "ambient.sceneGallery": "Szenengalerie", "ambient.sceneGallerySelect": "{scene} für {mode} wählen", "ambient.sceneGalleryEmpty": "Noch keine Szenen verfügbar.", "ambient.previousGalleryPage": "Vorherige Galerieseite", "ambient.nextGalleryPage": "Nächste Galerieseite", "ambient.sceneGalleryPage": "Seite {page} von {total}", "ambient.previousScene": "Vorige Szene", "ambient.nextScene": "Nächste Szene", "ambient.playbackMode": "Player und Wiedergabe", "ambient.openPlayer": "Player öffnen", "ambient.player": "Player", "ambient.repeatCurrent": "Aktuellen Titel wiederholen", "ambient.shuffle": "Zufallswiedergabe", "ambient.muteSceneSound": "Szenenklang stumm", "ambient.unmuteSceneSound": "Szenenklang an", "ambient.currentTime": "Aktuelle Zeit", "ambient.moodSwitcher": "Stimmung wechseln", "ambient.mood": "Stimmung", "ambient.chooseRoomMode": "Raummodus wählen", "ambient.roomModeLabel": "{mode} Raummodus", "ambient.brightness": "Helligkeit", "ambient.displayLevel": "Displaystufe", "ambient.closeAdjustment": "{channel} schließen",
  "source.audio": "Audio", "source.spotify": "Spotify", "source.bluetooth": "Bluetooth", "source.airplay": "AirPlay", "source.upnp": "DLNA", "source.localQueueReady": "Lokale Warteschlange bereit", "source.webPlayers": "Webplayer", "source.choose": "Audioquelle wählen", "source.audioPicker": "Audioquellen-Auswahl", "source.enableRadio": "Radio öffnen", "source.radioPresets": "Radio-Presets", "source.openSpotify": "Spotify öffnen", "source.pairPhone": "Telefon koppeln", "source.openDlna": "DLNA öffnen", "source.openAirplay": "AirPlay öffnen", "source.libraryReadyPickTrack": "Mediathek bereit. Titel wählen.", "source.readyAs": "{source} bereit als {label}.", "source.connectedAs": "{source}: {label}.", "source.connectingAs": "Verbindet als {label}", "source.connectedTo": "Verbunden mit {label}", "source.ready": "{source} bereit.",
  "handoff.title": "Verbindet", "handoff.body": "Vom Telefon verbinden. Tikpal kommt zurück, sobald Musik startet.", "room.focusIntent": "Arbeit und Lesen", "room.calmIntent": "Runterkommen", "room.sleepIntent": "Dunkel, Timer, Ausblenden", "room.hifiIntent": "Reines Musikhören", "quickMenu.title": "Schnellmenü", "quickMenu.close": "Schnellmenü schließen", "quickMenu.turnScreenOff": "Bildschirm aus", "quickMenu.turnScreenOn": "Bildschirm an", "quickMenu.mute": "Stumm", "quickMenu.restoreVolume": "Lautstärke zurück", "quickMenu.hideTime": "Zeit ausblenden", "quickMenu.showTime": "Zeit anzeigen", "quickMenu.sleepTikpal": "Tikpal schlafen lassen", "startup.setRoomMood": "Raumstimmung wählen", "startup.roomModes": "Startmodi", "onboarding.ariaLabel": "Startanleitung", "onboarding.title": "Willkommen bei Tikpal", "onboarding.subtitle": "Mit ein paar Gesten fühlt sich der Kiosk sofort natürlich an.", "onboarding.tapTitle": "Tippen, um Steuerung zu zeigen", "onboarding.tapBody": "Tippe auf die Ambient-Ansicht, um die versteckten Bedienelemente wieder einzublenden.", "onboarding.brightnessTitle": "Links Helligkeit ändern", "onboarding.brightnessBody": "Am linken Rand nach oben oder unten wischen, um das Display zu dimmen oder aufzuhellen.", "onboarding.volumeTitle": "Rechts Lautstärke ändern", "onboarding.volumeBody": "Am rechten Rand nach oben oder unten wischen, um die Lautstärke zu ändern.", "onboarding.playerTitle": "Nach unten für Playback wischen", "onboarding.playerBody": "Wechsle von Ambient zu Player, wenn du Titel, Quellen oder Transport brauchst.", "onboarding.menuTitle": "Lang drücken für Schnellmenü", "onboarding.menuBody": "Nutze das Schnellmenü für Bildschirm-, Zeit- und Schlafaktionen.", "onboarding.footer": "Du kannst diese Anleitung später in den Einstellungen erneut öffnen.", "onboarding.getStarted": "Los geht's",
  "settings.console": "Konsole", "settings.preferencesDesc": "Audio, Display, Schrift und Overlays.", "settings.libraryDesc": "Lokale Musik, USB, NAS und Scanstatus.", "settings.linkDesc": "Verbindungen und Remote-Zugriff.", "settings.careDesc": "Gesicherter Neustart und Ausschalten.", "settings.languageSaved": "Sprache gespeichert.", "settings.languageSavedWithWarning": "Sprache gespeichert. Tastatur folgt gleich.", "settings.dsp": "DSP", "settings.eqReady": "EQ bereit", "settings.adjustable": "Einstellbar", "settings.readOnly": "Nur lesen", "settings.screenReady": "Bildschirm bereit", "settings.brightnessReady": "Helligkeit bereit", "settings.timeNight": "Zeit und Nacht", "settings.night": "Nacht", "settings.auto": "Auto", "settings.localLibrary": "Lokale Mediathek", "settings.savedOnDevice": "Musik auf diesem Gerät", "settings.nasSources": "NAS-Quellen", "settings.addNas": "NAS hinzufügen", "settings.addNasInSettings": "NAS in Settings hinzufügen", "settings.usb": "USB", "settings.notMounted": "Nicht eingebunden", "settings.portableStorage": "Mobiler Speicher", "settings.portableStorageMounted": "Mobiler Speicher verbunden", "settings.libraryScan": "Mediathek-Scan", "settings.scanLibrary": "Mediathek scannen", "settings.scanInProgress": "Scan läuft", "settings.chooseTypography": "Kiosk-Schrift wählen", "settings.switchSkin": "Skin wechseln", "settings.tuneLyrics": "Lyrics anpassen", "settings.system": "System", "settings.limited": "Begrenzt", "settings.needsAttention": "Prüfen", "settings.confirmNeeded": "Bestätigung nötig", "settings.systemReboot": "Systemneustart", "settings.powerOff": "Ausschalten", "settings.restartSystem": "System neu starten", "settings.shutdownSystem": "System ausschalten", "settings.tapAgainRestart": "Zum Neustart erneut tippen", "settings.tapAgainPowerOff": "Zum Ausschalten erneut tippen", "settings.adjustType": "Schrift anpassen", "settings.proxyKeyboard": "Proxy und Tastatur", "settings.proxyReady": "Proxy bereit", "settings.officialWebPlayers": "Offizielle Webplayer", "settings.exploreHelp": "Speichert automatisch. Wenn ein Player nicht öffnet, Proxy umschalten und erneut versuchen.", "settings.enterProxyUrl": "Vollständige Proxy-URL eingeben", "settings.nightBrightness": "{percent}% Nachthelligkeit", "settings.nasStatus": "NAS-Status", "settings.tracks": "{count} Titel", "settings.savedCount": "{count} gespeichert",
  "library.source": "Quelle", "library.nas": "NAS", "library.usb": "USB", "library.localShort": "{count} lokal", "library.nasShort": "{count} NAS", "library.usbShort": "{count} USB", "library.savedShort": "{count} gespeichert", "library.newShort": "{count} neu", "library.deleteFromLocal": "Lokal löschen", "library.clearSearch": "Suche leeren", "library.localStorage": "Lokaler Speicher: {free} frei", "library.localStorageUnavailable": "Lokaler Speicher nicht verfügbar", "library.free": "{free} frei", "library.backMain": "Zur Hauptansicht", "library.loading": "Mediathek lädt...", "library.emptyUsb": "Keine USB-Titel. Laufwerk prüfen, dann scannen.", "library.emptyFavorites": "Noch keine Favoriten. Herz am Titel tippen.", "library.emptyRecent": "Noch keine neuen Titel.", "library.emptyLocal": "Noch keine lokalen Titel. Von USB kopieren oder scannen.", "library.savedToLocal": "Lokal gespeichert.", "library.alreadySaved": "Schon lokal gespeichert.", "library.savedFavorite": "Als Favorit gespeichert.", "library.removedFavorite": "Aus Favoriten entfernt.", "library.removedLocal": "Lokal entfernt.",
  "radio.threeFresh": "Drei neue Tipps. Einen antippen.", "radio.loading": "Sender laden...", "radio.empty": "Keine Sender hier. Random versuchen.", "radio.random": "Zufall", "explore.noWebPlayer": "Kein Webplayer", "explore.openLeft": "Öffnet links", "explore.couldNotOpen": "Konnte nicht öffnen", "explore.proxyActive": "Proxy aktiv", "explore.directConnection": "Direktverbindung", "explore.footer": "Links Musik wählen. Tikpal bleibt rechts.", "explore.webPlayers": "Musik-Webplayer", "explore.tikpalControls": "Tikpal-Steuerung", "explore.leftFont": "Schrift links", "remote.optionalAccessKey": "Optionaler Zugangsschlüssel", "remote.refresh": "Aktualisieren", "remote.sources": "Quellen", "remote.room": "Raum", "remote.hifiEq": "Hi-Fi EQ", "remote.scene": "Szene", "remote.display": "Display", "remote.startExplore": "Explore starten", "remote.proxyOn": "Proxy an", "remote.proxyOff": "Proxy aus", "remote.soundOn": "Ton an", "remote.soundOff": "Ton aus", "error.accessKey": "Zugangsschlüssel prüfen.", "error.noConnection": "Noch keine Verbindung. Quelle erneut öffnen.", "error.proxy": "Web Proxy prüfen und erneut versuchen.", "error.brightness": "Helligkeit änderte sich nicht. Niedriger versuchen.", "error.copy": "Konnte nicht lokal speichern.", "error.delete": "Titel konnte nicht entfernt werden.", "error.favorite": "Favoriten konnten nicht geändert werden.", "error.radio": "Radio ist nicht bereit. Anderen Sender wählen.", "error.library": "Mediathek nicht bereit. Scannen oder erneut versuchen.", "error.explore": "Explore öffnete nicht. Proxy prüfen.", "error.volume": "Lautstärke änderte sich nicht.", "error.timeout": "Das dauerte zu lang. Erneut versuchen.", "error.connection": "Verbindung ist langsam. Erneut versuchen.", "error.generic": "Benötigt Aufmerksamkeit. Erneut versuchen."
});

Object.assign(dictionaries.it, {
  "app.name": "Tikpal", "common.add": "Aggiungi", "common.apply": "Applica", "common.applying": "Applicazione...", "common.checkSetup": "Controlla setup", "common.clear": "Cancella", "common.closing": "Chiusura", "common.current": "Attuale", "common.disabled": "Disattivato", "common.enabled": "Attivato", "common.experimental": "Sperimentale", "common.failed": "Non riuscito", "common.loading": "Caricamento", "common.manual": "Manuale", "common.offline": "Offline", "common.online": "Online", "common.savedAutomatically": "Salvato automaticamente", "common.scanning": "Scansione...", "common.syncing": "Sincronizzazione", "common.waiting": "In attesa",
  "status.live": "Live", "status.offlineView": "Vista offline", "status.updating": "Aggiornamento", "playback.sourceUnknown": "Sorgente sconosciuta", "playback.stopped": "Fermo", "playback.favorite": "Preferito", "playback.removeFavorite": "Rimuovi preferito", "playback.seekPosition": "Posizione", "playback.seekingTo": "Salto a {time}...", "playback.controlUnavailable": "Controllo non disponibile", "lyrics.listeningTo": "Ascolto audio {source}...", "lyrics.identifying": "Riconoscimento brano...", "lyrics.hide": "Nascondi testi", "lyrics.show": "Mostra testi",
  "ambient.changeBrightness": "Scorri per cambiare luminosità", "ambient.changeVolume": "Scorri per cambiare volume", "ambient.openSceneGallery": "Apri galleria scene", "ambient.closeSceneGallery": "Chiudi galleria scene", "ambient.sceneGallery": "Galleria scene", "ambient.sceneGallerySelect": "Scegli {scene} per {mode}", "ambient.sceneGalleryEmpty": "Nessuna scena disponibile.", "ambient.previousGalleryPage": "Pagina galleria precedente", "ambient.nextGalleryPage": "Pagina galleria successiva", "ambient.sceneGalleryPage": "Pagina {page} di {total}", "ambient.previousScene": "Scena precedente", "ambient.nextScene": "Scena successiva", "ambient.playbackMode": "Player e riproduzione", "ambient.openPlayer": "Apri player", "ambient.player": "Player", "ambient.repeatCurrent": "Ripeti brano", "ambient.shuffle": "Riproduzione casuale", "ambient.muteSceneSound": "Disattiva suono scena", "ambient.unmuteSceneSound": "Attiva suono scena", "ambient.currentTime": "Ora attuale", "ambient.moodSwitcher": "Cambio atmosfera", "ambient.mood": "Atmosfera", "ambient.chooseRoomMode": "Scegli modalità stanza", "ambient.roomModeLabel": "Modalità {mode}", "ambient.brightness": "Luminosità", "ambient.displayLevel": "Livello display", "ambient.closeAdjustment": "Chiudi regolazione {channel}",
  "source.audio": "Audio", "source.spotify": "Spotify", "source.bluetooth": "Bluetooth", "source.airplay": "AirPlay", "source.upnp": "DLNA", "source.localQueueReady": "Coda locale pronta", "source.webPlayers": "Player web", "source.choose": "Scegli sorgente audio", "source.audioPicker": "Selettore sorgente", "source.enableRadio": "Apri Radio", "source.radioPresets": "Preset radio", "source.openSpotify": "Apri Spotify", "source.pairPhone": "Abbina telefono", "source.openDlna": "Apri DLNA", "source.openAirplay": "Apri AirPlay", "source.libraryReadyPickTrack": "Libreria pronta. Scegli un brano.", "source.readyAs": "{source} pronta come {label}.", "source.connectedAs": "{source}: {label}.", "source.connectingAs": "Connessione come {label}", "source.connectedTo": "Connesso a {label}", "source.ready": "{source} pronta.",
  "handoff.title": "Connessione", "handoff.body": "Connettiti dal telefono. Torna quando parte la musica.", "room.focusIntent": "Lavoro e lettura", "room.calmIntent": "Relax", "room.sleepIntent": "Scuro, timer, dissolvenza", "room.hifiIntent": "Ascolto puro", "quickMenu.title": "Menu rapido", "quickMenu.close": "Chiudi menu rapido", "quickMenu.turnScreenOff": "Spegni schermo", "quickMenu.turnScreenOn": "Accendi schermo", "quickMenu.mute": "Muto", "quickMenu.restoreVolume": "Ripristina volume", "quickMenu.hideTime": "Nascondi ora", "quickMenu.showTime": "Mostra ora", "quickMenu.sleepTikpal": "Metti Tikpal in sleep", "startup.setRoomMood": "Imposta atmosfera", "startup.roomModes": "Modalità iniziali", "onboarding.ariaLabel": "Guida iniziale", "onboarding.title": "Benvenuto in Tikpal", "onboarding.subtitle": "Con pochi gesti il kiosk diventa subito naturale.", "onboarding.tapTitle": "Tocca per mostrare i controlli", "onboarding.tapBody": "Tocca la vista Ambient per mostrare di nuovo i controlli nascosti.", "onboarding.brightnessTitle": "Il bordo sinistro regola la luminosità", "onboarding.brightnessBody": "Scorri verso l'alto o il basso sul lato sinistro per abbassare o aumentare il display.", "onboarding.volumeTitle": "Il bordo destro regola il volume", "onboarding.volumeBody": "Scorri verso l'alto o il basso sul lato destro per cambiare il volume d'ascolto.", "onboarding.playerTitle": "Scorri in basso per la riproduzione", "onboarding.playerBody": "Passa da Ambient a Player quando vuoi brani, sorgenti e trasporto.", "onboarding.menuTitle": "Pressione lunga per il menu rapido", "onboarding.menuBody": "Usa il menu rapido per schermo, ora e sospensione.", "onboarding.footer": "Puoi riaprire questa guida più tardi dalle impostazioni.", "onboarding.getStarted": "Inizia",
  "settings.console": "Console", "settings.preferencesDesc": "Audio, display, testo e overlay.", "settings.libraryDesc": "Musica locale, USB, NAS e scansione.", "settings.linkDesc": "Connessioni e accesso remoto.", "settings.careDesc": "Riavvio e spegnimento protetti.", "settings.languageSaved": "Lingua salvata.", "settings.languageSavedWithWarning": "Lingua salvata. Tastiera in sync a breve.", "settings.dsp": "DSP", "settings.eqReady": "EQ pronto", "settings.adjustable": "Regolabile", "settings.readOnly": "Solo lettura", "settings.screenReady": "Schermo pronto", "settings.brightnessReady": "Luminosità pronta", "settings.timeNight": "Ora e notte", "settings.night": "Notte", "settings.auto": "Auto", "settings.localLibrary": "Libreria locale", "settings.savedOnDevice": "Musica salvata su questo dispositivo", "settings.nasSources": "Sorgenti NAS", "settings.addNas": "Aggiungi NAS", "settings.addNasInSettings": "Aggiungi NAS in Settings", "settings.usb": "USB", "settings.notMounted": "Non montato", "settings.portableStorage": "Archivio portatile", "settings.portableStorageMounted": "Archivio portatile montato", "settings.libraryScan": "Scansione libreria", "settings.scanLibrary": "Scansiona libreria", "settings.scanInProgress": "Scansione in corso", "settings.chooseTypography": "Scegli carattere kiosk", "settings.switchSkin": "Cambia skin", "settings.tuneLyrics": "Regola testi", "settings.system": "Sistema", "settings.limited": "Limitato", "settings.needsAttention": "Da controllare", "settings.restart": "Riavvia", "settings.shutdown": "Spegni", "settings.confirmNeeded": "Conferma richiesta", "settings.systemReboot": "Riavvio sistema", "settings.powerOff": "Spegnimento", "settings.restartSystem": "Riavvia sistema", "settings.shutdownSystem": "Spegni sistema", "settings.tapAgainRestart": "Tocca ancora per riavviare", "settings.tapAgainPowerOff": "Tocca ancora per spegnere", "settings.adjustType": "Regola testo", "settings.proxyKeyboard": "Proxy e tastiera", "settings.proxyReady": "Proxy pronto", "settings.officialWebPlayers": "Player web ufficiali", "settings.exploreHelp": "Salva automaticamente. Se non apre, cambia Proxy e riprova.", "settings.enterProxyUrl": "Inserisci URL proxy completo", "settings.nightBrightness": "Luminosità notte {percent}%", "settings.nasStatus": "Stato NAS", "settings.tracks": "{count} brani", "settings.savedCount": "{count} salvati",
  "library.source": "Sorgente", "library.nas": "NAS", "library.usb": "USB", "library.recentlyAdded": "Recenti", "library.localShort": "{count} locali", "library.nasShort": "{count} NAS", "library.usbShort": "{count} USB", "library.savedShort": "{count} salvati", "library.newShort": "{count} nuovi", "library.deleteFromLocal": "Elimina da Locale", "library.clearSearch": "Cancella ricerca", "library.localStorage": "Spazio locale: {free} liberi", "library.localStorageUnavailable": "Spazio locale non disponibile", "library.free": "{free} liberi", "library.backMain": "Torna alla schermata principale", "library.loading": "Caricamento libreria...", "library.emptyNas": "Aggiungi NAS in Settings.", "library.emptyUsb": "Nessun brano USB. Controlla il drive, poi scansiona.", "library.emptyFavorites": "Nessun preferito. Tocca il cuore su un brano.", "library.emptyRecent": "Nessun brano recente.", "library.emptyLocal": "Nessun brano locale. Copia da USB o scansiona.", "library.savedToLocal": "Salvato in Locale.", "library.alreadySaved": "Già salvato localmente.", "library.savedFavorite": "Salvato nei Preferiti.", "library.removedFavorite": "Rimosso dai Preferiti.", "library.removedLocal": "Rimosso da Locale.",
  "radio.threeFresh": "Tre scelte nuove. Tocca per ascoltare.", "radio.loading": "Caricamento stazioni...", "radio.empty": "Nessuna stazione qui. Prova Random.", "radio.random": "Casuale", "explore.noWebPlayer": "Nessun player web", "explore.chooseBelow": "Scegli un player web sotto", "explore.openLeft": "Apertura a sinistra", "explore.couldNotOpen": "Impossibile aprire", "explore.proxyActive": "Proxy attivo", "explore.directConnection": "Connessione diretta", "explore.footer": "Scegli musica a sinistra. I controlli restano qui.", "explore.webPlayers": "Player web musicali", "explore.tikpalControls": "Controlli Tikpal", "explore.leftFont": "Testo provider sinistro", "remote.optionalAccessKey": "Chiave opzionale", "remote.noKey": "Nessuna chiave", "remote.refresh": "Aggiorna", "remote.sources": "Sorgenti", "remote.room": "Stanza", "remote.hifiEq": "Hi-Fi EQ", "remote.scene": "Scena", "remote.display": "Display", "remote.startExplore": "Avvia Explore", "remote.proxyOn": "Proxy On", "remote.proxyOff": "Proxy Off", "remote.soundOn": "Audio On", "remote.soundOff": "Audio Off", "error.accessKey": "Controlla la chiave.", "error.noConnection": "Nessuna connessione. Riapri la sorgente.", "error.proxy": "Controlla Web Proxy e riprova.", "error.brightness": "Luminosità non cambiata. Prova più bassa.", "error.copy": "Impossibile salvare in Locale.", "error.delete": "Impossibile rimuovere il brano.", "error.favorite": "Impossibile aggiornare Preferiti.", "error.radio": "Radio non pronta. Prova un'altra stazione.", "error.library": "Libreria non pronta. Scansiona o riprova.", "error.explore": "Explore non si è aperto. Controlla Proxy.", "error.volume": "Volume non cambiato. Riprova.", "error.timeout": "Operazione troppo lunga. Riprova.", "error.connection": "Connessione lenta. Riprova.", "error.generic": "Richiede attenzione. Riprova."
});

Object.assign(dictionaries.ko, {
  "app.name": "Tikpal", "common.add": "추가", "common.apply": "적용", "common.applying": "적용 중...", "common.checkSetup": "설정 확인", "common.clear": "지우기", "common.closing": "닫는 중", "common.current": "현재", "common.disabled": "비활성", "common.enabled": "활성", "common.experimental": "실험적", "common.failed": "실패", "common.loading": "로딩 중", "common.manual": "수동", "common.offline": "오프라인", "common.online": "온라인", "common.savedAutomatically": "자동 저장됨", "common.scanning": "스캔 중...", "common.syncing": "동기화 중", "common.waiting": "대기 중",
  "status.live": "실시간", "status.offlineView": "오프라인 보기", "status.updating": "업데이트 중", "playback.sourceUnknown": "소스 알 수 없음", "playback.stopped": "정지됨", "playback.favorite": "즐겨찾기", "playback.removeFavorite": "즐겨찾기 해제", "playback.seekPosition": "재생 위치", "playback.seekingTo": "{time}(으)로 이동 중...", "playback.controlUnavailable": "재생 제어 불가", "lyrics.listeningTo": "{source} 오디오 듣는 중...", "lyrics.identifying": "곡 인식 중...", "lyrics.hide": "가사 숨기기", "lyrics.show": "가사 표시",
  "ambient.changeBrightness": "쓸거나 스크롤해 밝기 조절", "ambient.changeVolume": "쓸거나 스크롤해 볼륨 조절", "ambient.openSceneGallery": "장면 갤러리 열기", "ambient.closeSceneGallery": "장면 갤러리 닫기", "ambient.sceneGallery": "장면 갤러리", "ambient.sceneGallerySelect": "{mode}용 {scene} 선택", "ambient.sceneGalleryEmpty": "사용 가능한 장면이 없습니다.", "ambient.previousGalleryPage": "이전 갤러리 페이지", "ambient.nextGalleryPage": "다음 갤러리 페이지", "ambient.sceneGalleryPage": "{total}페이지 중 {page}페이지", "ambient.previousScene": "이전 장면", "ambient.nextScene": "다음 장면", "ambient.playbackMode": "플레이어와 재생 모드", "ambient.openPlayer": "플레이어 열기", "ambient.player": "플레이어", "ambient.repeatCurrent": "현재 곡 반복", "ambient.shuffle": "셔플 재생", "ambient.muteSceneSound": "장면 사운드 끄기", "ambient.unmuteSceneSound": "장면 사운드 켜기", "ambient.currentTime": "현재 시간", "ambient.moodSwitcher": "분위기 전환", "ambient.mood": "분위기", "ambient.chooseRoomMode": "룸 모드 선택", "ambient.roomModeLabel": "{mode} 룸 모드", "ambient.brightness": "밝기", "ambient.displayLevel": "디스플레이 밝기", "ambient.closeAdjustment": "{channel} 조절 닫기",
  "source.audio": "오디오", "source.spotify": "Spotify", "source.bluetooth": "Bluetooth", "source.airplay": "AirPlay", "source.upnp": "DLNA", "source.localQueueReady": "로컬 큐 준비됨", "source.webPlayers": "웹 플레이어", "source.choose": "오디오 소스 선택", "source.audioPicker": "오디오 소스 선택기", "source.enableRadio": "라디오 열기", "source.radioPresets": "라디오 프리셋", "source.openSpotify": "Spotify 열기", "source.pairPhone": "폰 페어링", "source.openDlna": "DLNA 열기", "source.openAirplay": "AirPlay 열기", "source.libraryReadyPickTrack": "라이브러리 준비됨. 곡을 선택하세요.", "source.readyAs": "{source} 준비됨: {label}.", "source.connectedAs": "{source}: {label}.", "source.connectingAs": "{label}(으)로 연결 중", "source.connectedTo": "{label}에 연결됨", "source.ready": "{source} 준비됨.",
  "handoff.title": "연결 중", "handoff.body": "폰에서 연결하세요. 재생이 시작되면 돌아옵니다.", "room.focusIntent": "작업과 독서", "room.calmIntent": "휴식", "room.sleepIntent": "어둡게, 타이머, 페이드아웃", "room.hifiIntent": "순수 음악 감상", "quickMenu.title": "빠른 메뉴", "quickMenu.close": "빠른 메뉴 닫기", "quickMenu.turnScreenOff": "화면 끄기", "quickMenu.turnScreenOn": "화면 켜기", "quickMenu.mute": "음소거", "quickMenu.restoreVolume": "볼륨 복원", "quickMenu.hideTime": "시간 숨기기", "quickMenu.showTime": "시간 표시", "quickMenu.sleepTikpal": "Tikpal 절전", "startup.setRoomMood": "룸 분위기 설정", "startup.roomModes": "시작 룸 모드", "onboarding.ariaLabel": "시작 안내", "onboarding.title": "Tikpal에 오신 것을 환영합니다", "onboarding.subtitle": "몇 가지 손동작만 익히면 키오스크를 바로 자연스럽게 사용할 수 있습니다.", "onboarding.tapTitle": "탭해서 제어 보기", "onboarding.tapBody": "Ambient 화면을 한 번 탭하면 숨겨진 제어가 다시 나타납니다.", "onboarding.brightnessTitle": "왼쪽 가장자리로 밝기 조절", "onboarding.brightnessBody": "왼쪽 가장자리에서 위아래로 쓸어 화면을 어둡게 또는 밝게 할 수 있습니다.", "onboarding.volumeTitle": "오른쪽 가장자리로 볼륨 조절", "onboarding.volumeBody": "오른쪽 가장자리에서 위아래로 쓸어 듣는 볼륨을 바꿀 수 있습니다.", "onboarding.playerTitle": "아래로 쓸어 재생 화면으로", "onboarding.playerBody": "곡, 소스, 재생 제어가 필요할 때 Ambient에서 Player로 이동하세요.", "onboarding.menuTitle": "길게 눌러 빠른 메뉴", "onboarding.menuBody": "빠른 메뉴에서 화면, 시간, 절전 동작을 사용할 수 있습니다.", "onboarding.footer": "이 안내는 나중에 설정에서 다시 열 수 있습니다.", "onboarding.getStarted": "시작하기",
  "settings.console": "콘솔", "settings.preferencesDesc": "오디오, 화면, 글꼴, 오버레이.", "settings.libraryDesc": "로컬 음악, USB, NAS, 스캔 상태.", "settings.linkDesc": "연결과 원격 접근.", "settings.careDesc": "안전한 재시작과 종료.", "settings.languageSaved": "언어 저장됨.", "settings.languageSavedWithWarning": "언어 저장됨. 키보드는 곧 동기화됩니다.", "settings.dsp": "DSP", "settings.eqReady": "EQ 준비됨", "settings.adjustable": "조절 가능", "settings.readOnly": "읽기 전용", "settings.screenReady": "화면 준비됨", "settings.brightnessReady": "밝기 준비됨", "settings.timeNight": "시간과 야간", "settings.night": "야간", "settings.auto": "자동", "settings.localLibrary": "로컬 라이브러리", "settings.savedOnDevice": "이 기기에 저장된 음악", "settings.nasSources": "NAS 소스", "settings.addNas": "NAS 추가", "settings.addNasInSettings": "Settings에서 NAS 추가", "settings.usb": "USB", "settings.notMounted": "마운트 안 됨", "settings.portableStorage": "이동식 저장소", "settings.portableStorageMounted": "이동식 저장소 연결됨", "settings.libraryScan": "라이브러리 스캔", "settings.scanLibrary": "라이브러리 스캔", "settings.scanInProgress": "스캔 중", "settings.chooseTypography": "키오스크 글꼴 선택", "settings.switchSkin": "스킨 변경", "settings.tuneLyrics": "가사 조정", "settings.system": "시스템", "settings.limited": "제한됨", "settings.needsAttention": "확인 필요", "settings.restart": "재시작", "settings.shutdown": "종료", "settings.confirmNeeded": "확인 필요", "settings.systemReboot": "시스템 재시작", "settings.powerOff": "전원 끄기", "settings.restartSystem": "시스템 재시작", "settings.shutdownSystem": "시스템 종료", "settings.tapAgainRestart": "다시 눌러 재시작", "settings.tapAgainPowerOff": "다시 눌러 종료", "settings.adjustType": "글자 조정", "settings.proxyKeyboard": "프록시와 키보드", "settings.proxyReady": "프록시 준비됨", "settings.officialWebPlayers": "공식 웹 플레이어", "settings.exploreHelp": "자동 저장됩니다. 열리지 않으면 Proxy를 바꾸고 재시도하세요.", "settings.enterProxyUrl": "전체 프록시 URL 입력", "settings.nightBrightness": "야간 밝기 {percent}%", "settings.nasStatus": "NAS 상태", "settings.tracks": "{count}곡", "settings.savedCount": "{count}개 저장됨",
  "library.source": "소스", "library.nas": "NAS", "library.usb": "USB", "library.recentlyAdded": "최근 추가", "library.localShort": "로컬 {count}", "library.nasShort": "NAS {count}", "library.usbShort": "USB {count}", "library.savedShort": "저장 {count}", "library.newShort": "신규 {count}", "library.deleteFromLocal": "로컬에서 삭제", "library.clearSearch": "검색 지우기", "library.localStorage": "로컬 저장소: {free} 남음", "library.localStorageUnavailable": "로컬 저장소 사용 불가", "library.free": "{free} 남음", "library.backMain": "메인 화면으로", "library.loading": "음악 라이브러리 로딩 중...", "library.emptyNas": "Settings에서 NAS를 추가하세요.", "library.emptyUsb": "USB 곡 없음. 드라이브 확인 후 스캔하세요.", "library.emptyFavorites": "즐겨찾기 없음. 곡의 하트를 누르세요.", "library.emptyRecent": "최근 곡 없음.", "library.emptyLocal": "로컬 곡 없음. USB에서 복사하거나 스캔하세요.", "library.savedToLocal": "로컬에 저장됨.", "library.alreadySaved": "이미 로컬에 저장됨.", "library.savedFavorite": "즐겨찾기에 저장됨.", "library.removedFavorite": "즐겨찾기에서 제거됨.", "library.removedLocal": "로컬에서 제거됨.",
  "radio.threeFresh": "새 추천 3개. 하나를 누르세요.", "radio.loading": "스테이션 로딩 중...", "radio.empty": "여기엔 스테이션 없음. Random을 시도하세요.", "radio.random": "랜덤", "explore.noWebPlayer": "웹 플레이어 없음", "explore.chooseBelow": "아래에서 웹 플레이어 선택", "explore.openLeft": "왼쪽에서 여는 중", "explore.couldNotOpen": "열 수 없음", "explore.proxyActive": "프록시 활성", "explore.directConnection": "직접 연결", "explore.footer": "왼쪽에서 음악을 고르세요. Tikpal 제어는 여기 남습니다.", "explore.webPlayers": "음악 웹 플레이어", "explore.tikpalControls": "Tikpal 제어", "explore.leftFont": "왼쪽 글꼴 크기", "remote.optionalAccessKey": "선택 접근 키", "remote.noKey": "키 없음", "remote.refresh": "새로고침", "remote.sources": "소스", "remote.room": "룸", "remote.hifiEq": "Hi-Fi EQ", "remote.scene": "장면", "remote.display": "디스플레이", "remote.startExplore": "Explore 시작", "remote.proxyOn": "프록시 켜짐", "remote.proxyOff": "프록시 꺼짐", "remote.soundOn": "소리 켜짐", "remote.soundOff": "소리 꺼짐", "error.accessKey": "접근 키를 확인하세요.", "error.noConnection": "아직 연결 없음. 소스를 다시 여세요.", "error.proxy": "Web Proxy를 확인하고 재시도하세요.", "error.brightness": "밝기가 바뀌지 않았습니다. 낮게 시도하세요.", "error.copy": "로컬에 저장할 수 없습니다.", "error.delete": "곡을 제거할 수 없습니다.", "error.favorite": "즐겨찾기를 업데이트할 수 없습니다.", "error.radio": "라디오가 준비되지 않았습니다. 다른 스테이션을 선택하세요.", "error.library": "라이브러리가 준비되지 않았습니다. 스캔하거나 재시도하세요.", "error.explore": "Explore가 열리지 않았습니다. Proxy를 확인하세요.", "error.volume": "볼륨이 바뀌지 않았습니다.", "error.timeout": "너무 오래 걸렸습니다. 다시 시도하세요.", "error.connection": "연결이 느립니다. 다시 시도하세요.", "error.generic": "확인이 필요합니다. 다시 시도하세요."
});

Object.assign(dictionaries.ja, {
  "app.name": "Tikpal", "common.add": "追加", "common.apply": "適用", "common.applying": "適用中...", "common.checkSetup": "設定確認", "common.clear": "クリア", "common.closing": "終了中", "common.current": "現在", "common.disabled": "無効", "common.enabled": "有効", "common.experimental": "試験中", "common.failed": "失敗", "common.loading": "読み込み中", "common.manual": "手動", "common.offline": "オフライン", "common.online": "オンライン", "common.savedAutomatically": "自動保存済み", "common.scanning": "スキャン中...", "common.syncing": "同期中", "common.waiting": "待機中",
  "status.live": "ライブ", "status.offlineView": "オフライン表示", "status.updating": "更新中", "playback.sourceUnknown": "ソース不明", "playback.stopped": "停止", "playback.favorite": "お気に入り", "playback.removeFavorite": "お気に入り解除", "playback.seekPosition": "再生位置", "playback.seekingTo": "{time}へ移動中...", "playback.controlUnavailable": "再生操作は利用不可", "lyrics.listeningTo": "{source}の音声を聴取中...", "lyrics.identifying": "曲を認識中...", "lyrics.hide": "歌詞を隠す", "lyrics.show": "歌詞を表示",
  "ambient.changeBrightness": "スワイプまたはスクロールで明るさ調整", "ambient.changeVolume": "スワイプまたはスクロールで音量調整", "ambient.openSceneGallery": "シーンギャラリーを開く", "ambient.closeSceneGallery": "シーンギャラリーを閉じる", "ambient.sceneGallery": "シーンギャラリー", "ambient.sceneGallerySelect": "{mode}用に{scene}を選択", "ambient.sceneGalleryEmpty": "利用可能なシーンはありません。", "ambient.previousGalleryPage": "前のギャラリーページ", "ambient.nextGalleryPage": "次のギャラリーページ", "ambient.sceneGalleryPage": "{total}ページ中 {page}ページ", "ambient.previousScene": "前のシーン", "ambient.nextScene": "次のシーン", "ambient.playbackMode": "プレイヤーと再生モード", "ambient.openPlayer": "プレイヤーを開く", "ambient.player": "プレイヤー", "ambient.repeatCurrent": "現在の曲をリピート", "ambient.shuffle": "シャッフル再生", "ambient.muteSceneSound": "シーンサウンドをミュート", "ambient.unmuteSceneSound": "シーンサウンドをオン", "ambient.currentTime": "現在時刻", "ambient.moodSwitcher": "ムード切替", "ambient.mood": "ムード", "ambient.chooseRoomMode": "ルームモード選択", "ambient.roomModeLabel": "{mode}ルームモード", "ambient.brightness": "明るさ", "ambient.displayLevel": "表示レベル", "ambient.closeAdjustment": "{channel}調整を閉じる",
  "source.audio": "オーディオ", "source.spotify": "Spotify", "source.bluetooth": "Bluetooth", "source.airplay": "AirPlay", "source.upnp": "DLNA", "source.localQueueReady": "ローカルキュー準備完了", "source.webPlayers": "Webプレイヤー", "source.choose": "音源を選択", "source.audioPicker": "音源ピッカー", "source.enableRadio": "ラジオを開く", "source.radioPresets": "ラジオプリセット", "source.openSpotify": "Spotifyを開く", "source.pairPhone": "スマホをペアリング", "source.openDlna": "DLNAを開く", "source.openAirplay": "AirPlayを開く", "source.libraryReadyPickTrack": "ライブラリ準備完了。曲を選択。", "source.readyAs": "{source}は{label}で準備完了。", "source.connectedAs": "{source}: {label}。", "source.connectingAs": "{label}として接続中", "source.connectedTo": "{label}に接続済み", "source.ready": "{source}準備完了。",
  "handoff.title": "接続中", "handoff.body": "スマホから接続してください。再生開始後に戻ります。", "room.focusIntent": "作業と読書", "room.calmIntent": "リラックス", "room.sleepIntent": "暗め、タイマー、フェードアウト", "room.hifiIntent": "純粋な音楽鑑賞", "quickMenu.title": "クイックメニュー", "quickMenu.close": "クイックメニューを閉じる", "quickMenu.turnScreenOff": "画面オフ", "quickMenu.turnScreenOn": "画面オン", "quickMenu.mute": "ミュート", "quickMenu.restoreVolume": "音量を戻す", "quickMenu.hideTime": "時刻を隠す", "quickMenu.showTime": "時刻を表示", "quickMenu.sleepTikpal": "Tikpalをスリープ", "startup.setRoomMood": "部屋のムードを設定", "startup.roomModes": "起動ルームモード",
  "settings.console": "コンソール", "settings.preferencesDesc": "音声、表示、文字、オーバーレイ。", "settings.libraryDesc": "ローカル音楽、USB、NAS、スキャン状態。", "settings.linkDesc": "接続とリモートアクセス。", "settings.careDesc": "安全な再起動と電源操作。", "settings.languageSaved": "言語を保存しました。", "settings.languageSavedWithWarning": "言語を保存しました。キーボードは後で同期します。", "settings.dsp": "DSP", "settings.eqReady": "EQ準備完了", "settings.adjustable": "調整可", "settings.readOnly": "読み取り専用", "settings.screenReady": "画面準備完了", "settings.brightnessReady": "明るさ準備完了", "settings.timeNight": "時刻と夜間", "settings.night": "夜間", "settings.auto": "自動", "settings.localLibrary": "ローカルライブラリ", "settings.savedOnDevice": "この端末に保存した音楽", "settings.nasSources": "NASソース", "settings.addNas": "NASを追加", "settings.addNasInSettings": "SettingsでNASを追加", "settings.usb": "USB", "settings.notMounted": "未マウント", "settings.portableStorage": "外部ストレージ", "settings.portableStorageMounted": "外部ストレージ接続済み", "settings.libraryScan": "ライブラリスキャン", "settings.scanLibrary": "ライブラリをスキャン", "settings.scanInProgress": "スキャン中", "settings.chooseTypography": "キオスクの書体を選択", "settings.switchSkin": "スキン変更", "settings.tuneLyrics": "歌詞を調整", "settings.system": "システム", "settings.limited": "制限あり", "settings.needsAttention": "確認が必要", "settings.restart": "再起動", "settings.shutdown": "シャットダウン", "settings.confirmNeeded": "確認が必要", "settings.systemReboot": "システム再起動", "settings.powerOff": "電源オフ", "settings.restartSystem": "システムを再起動", "settings.shutdownSystem": "システムを終了", "settings.tapAgainRestart": "もう一度タップで再起動", "settings.tapAgainPowerOff": "もう一度タップで電源オフ", "settings.adjustType": "文字を調整", "settings.proxyKeyboard": "プロキシとキーボード", "settings.proxyReady": "プロキシ準備完了", "settings.officialWebPlayers": "公式Webプレイヤー", "settings.exploreHelp": "自動保存されます。開かない時はProxyを切り替えて再試行。", "settings.enterProxyUrl": "完全なプロキシURLを入力", "settings.nightBrightness": "夜間明るさ {percent}%", "settings.nasStatus": "NAS状態", "settings.tracks": "{count}曲", "settings.savedCount": "{count}件保存",
  "library.source": "ソース", "library.nas": "NAS", "library.usb": "USB", "library.recentlyAdded": "最近追加", "library.localShort": "ローカル {count}", "library.nasShort": "NAS {count}", "library.usbShort": "USB {count}", "library.savedShort": "保存 {count}", "library.newShort": "新規 {count}", "library.deleteFromLocal": "ローカルから削除", "library.clearSearch": "検索をクリア", "library.localStorage": "ローカル容量: {free}空き", "library.localStorageUnavailable": "ローカル容量は利用不可", "library.free": "{free}空き", "library.backMain": "メイン画面へ", "library.loading": "ライブラリ読み込み中...", "library.emptyNas": "SettingsでNASを追加。", "library.emptyUsb": "USBの曲なし。ドライブ確認後にスキャン。", "library.emptyFavorites": "お気に入りはまだありません。曲のハートをタップ。", "library.emptyRecent": "最近の曲はまだありません。", "library.emptyLocal": "ローカル曲なし。USBからコピーまたはスキャン。", "library.savedToLocal": "ローカルに保存しました。", "library.alreadySaved": "すでにローカル保存済み。", "library.savedFavorite": "お気に入りに保存しました。", "library.removedFavorite": "お気に入りから削除しました。", "library.removedLocal": "ローカルから削除しました。",
  "radio.threeFresh": "新しい3局。1つタップして再生。", "radio.loading": "局を読み込み中...", "radio.empty": "ここに局はありません。Randomを試してください。", "radio.random": "ランダム", "explore.noWebPlayer": "Webプレイヤーなし", "explore.chooseBelow": "下からWebプレイヤーを選択", "explore.openLeft": "左で起動中", "explore.couldNotOpen": "開けませんでした", "explore.proxyActive": "プロキシ有効", "explore.directConnection": "直接接続", "explore.footer": "左で音楽を選択。Tikpal操作はここに残ります。", "explore.webPlayers": "音楽Webプレイヤー", "explore.tikpalControls": "Tikpal操作", "explore.leftFont": "左プレイヤー文字サイズ", "remote.optionalAccessKey": "任意のアクセスキー", "remote.noKey": "キーなし", "remote.refresh": "更新", "remote.sources": "ソース", "remote.room": "ルーム", "remote.hifiEq": "Hi-Fi EQ", "remote.scene": "シーン", "remote.display": "表示", "remote.startExplore": "Explore開始", "remote.proxyOn": "プロキシオン", "remote.proxyOff": "プロキシオフ", "remote.soundOn": "音オン", "remote.soundOff": "音オフ", "error.accessKey": "アクセスキーを確認してください。", "error.noConnection": "まだ接続なし。ソースを開き直してください。", "error.proxy": "Web Proxyを確認して再試行。", "error.brightness": "明るさが変わりません。低めで試してください。", "error.copy": "ローカル保存できませんでした。", "error.delete": "曲を削除できませんでした。", "error.favorite": "お気に入りを更新できませんでした。", "error.radio": "ラジオ準備未完了。別の局を選択。", "error.library": "ライブラリ準備未完了。スキャンまたは再試行。", "error.explore": "Exploreを開けませんでした。Proxyを確認。", "error.volume": "音量が変わりません。", "error.timeout": "時間がかかりすぎました。再試行。", "error.connection": "接続が遅いです。再試行。", "error.generic": "確認が必要です。再試行。"
});

Object.assign(dictionaries.es, {
  "app.name": "Tikpal", "common.add": "Añadir", "common.apply": "Aplicar", "common.applying": "Aplicando...", "common.checkSetup": "Revisar setup", "common.clear": "Limpiar", "common.closing": "Cerrando", "common.current": "Actual", "common.disabled": "Desactivado", "common.enabled": "Activado", "common.experimental": "Experimental", "common.failed": "Falló", "common.loading": "Cargando", "common.manual": "Manual", "common.offline": "Offline", "common.online": "Online", "common.savedAutomatically": "Guardado automáticamente", "common.scanning": "Escaneando...", "common.syncing": "Sincronizando", "common.waiting": "Esperando",
  "status.live": "En vivo", "status.offlineView": "Vista offline", "status.updating": "Actualizando", "playback.sourceUnknown": "Fuente desconocida", "playback.stopped": "Detenido", "playback.favorite": "Favorito", "playback.removeFavorite": "Quitar favorito", "playback.seekPosition": "Posición", "playback.seekingTo": "Saltando a {time}...", "playback.controlUnavailable": "Control no disponible", "lyrics.listeningTo": "Escuchando audio de {source}...", "lyrics.identifying": "Identificando canción...", "lyrics.hide": "Ocultar letras", "lyrics.show": "Mostrar letras",
  "ambient.changeBrightness": "Desliza o rueda para cambiar brillo", "ambient.changeVolume": "Desliza o rueda para cambiar volumen", "ambient.openSceneGallery": "Abrir galería de escenas", "ambient.closeSceneGallery": "Cerrar galería de escenas", "ambient.sceneGallery": "Galería de escenas", "ambient.sceneGallerySelect": "Elegir {scene} para {mode}", "ambient.sceneGalleryEmpty": "No hay escenas disponibles.", "ambient.previousGalleryPage": "Página de galería anterior", "ambient.nextGalleryPage": "Página de galería siguiente", "ambient.sceneGalleryPage": "Página {page} de {total}", "ambient.previousScene": "Escena anterior", "ambient.nextScene": "Escena siguiente", "ambient.playbackMode": "Player y modo de reproducción", "ambient.openPlayer": "Abrir player", "ambient.player": "Player", "ambient.repeatCurrent": "Repetir canción actual", "ambient.shuffle": "Reproducción aleatoria", "ambient.muteSceneSound": "Silenciar escena", "ambient.unmuteSceneSound": "Activar sonido de escena", "ambient.currentTime": "Hora actual", "ambient.moodSwitcher": "Cambio de ambiente", "ambient.mood": "Ambiente", "ambient.chooseRoomMode": "Elegir modo de sala", "ambient.roomModeLabel": "Modo {mode}", "ambient.brightness": "Brillo", "ambient.displayLevel": "Nivel de pantalla", "ambient.closeAdjustment": "Cerrar ajuste de {channel}",
  "source.audio": "Audio", "source.spotify": "Spotify", "source.bluetooth": "Bluetooth", "source.airplay": "AirPlay", "source.upnp": "DLNA", "source.localQueueReady": "Cola local lista", "source.webPlayers": "Web players", "source.choose": "Elegir fuente de audio", "source.audioPicker": "Selector de fuente", "source.enableRadio": "Abrir Radio", "source.radioPresets": "Presets de radio", "source.openSpotify": "Abrir Spotify", "source.pairPhone": "Emparejar teléfono", "source.openDlna": "Abrir DLNA", "source.openAirplay": "Abrir AirPlay", "source.libraryReadyPickTrack": "Biblioteca lista. Elige una canción.", "source.readyAs": "{source} lista como {label}.", "source.connectedAs": "{source}: {label}.", "source.connectingAs": "Conectando como {label}", "source.connectedTo": "Conectado a {label}", "source.ready": "{source} lista.",
  "handoff.title": "Conectando", "handoff.body": "Conecta desde tu teléfono. Vuelve cuando empiece la música.", "room.focusIntent": "Trabajo y lectura", "room.calmIntent": "Relajarse", "room.sleepIntent": "Oscuro, temporizador, fundido", "room.hifiIntent": "Escucha musical pura", "quickMenu.title": "Menú rápido", "quickMenu.close": "Cerrar menú rápido", "quickMenu.turnScreenOff": "Apagar pantalla", "quickMenu.turnScreenOn": "Encender pantalla", "quickMenu.mute": "Silenciar", "quickMenu.restoreVolume": "Restaurar volumen", "quickMenu.hideTime": "Ocultar hora", "quickMenu.showTime": "Mostrar hora", "quickMenu.sleepTikpal": "Dormir Tikpal", "startup.setRoomMood": "Configurar ambiente", "startup.roomModes": "Modos de inicio",
  "settings.console": "Consola", "settings.preferencesDesc": "Audio, pantalla, texto y overlays.", "settings.libraryDesc": "Música local, USB, NAS y escaneo.", "settings.linkDesc": "Conectividad y acceso remoto.", "settings.careDesc": "Reinicio y apagado protegidos.", "settings.languageSaved": "Idioma guardado.", "settings.languageSavedWithWarning": "Idioma guardado. Teclado se sincronizará pronto.", "settings.dsp": "DSP", "settings.eqReady": "EQ listo", "settings.adjustable": "Ajustable", "settings.readOnly": "Solo lectura", "settings.screenReady": "Pantalla lista", "settings.brightnessReady": "Brillo listo", "settings.timeNight": "Hora y noche", "settings.night": "Noche", "settings.auto": "Auto", "settings.localLibrary": "Biblioteca local", "settings.savedOnDevice": "Música guardada en este dispositivo", "settings.nasSources": "Fuentes NAS", "settings.addNas": "Añadir NAS", "settings.addNasInSettings": "Añadir NAS en Settings", "settings.usb": "USB", "settings.notMounted": "No montado", "settings.portableStorage": "Almacenamiento portátil", "settings.portableStorageMounted": "Almacenamiento conectado", "settings.libraryScan": "Escaneo de biblioteca", "settings.scanLibrary": "Escanear biblioteca", "settings.scanInProgress": "Escaneando", "settings.chooseTypography": "Elegir tipografía del kiosk", "settings.switchSkin": "Cambiar skin", "settings.tuneLyrics": "Ajustar letras", "settings.system": "Sistema", "settings.limited": "Limitado", "settings.needsAttention": "Revisar", "settings.restart": "Reiniciar", "settings.shutdown": "Apagar", "settings.confirmNeeded": "Confirmar", "settings.systemReboot": "Reinicio del sistema", "settings.powerOff": "Apagar", "settings.restartSystem": "Reiniciar sistema", "settings.shutdownSystem": "Apagar sistema", "settings.tapAgainRestart": "Toca otra vez para reiniciar", "settings.tapAgainPowerOff": "Toca otra vez para apagar", "settings.adjustType": "Ajustar texto", "settings.proxyKeyboard": "Proxy y teclado", "settings.proxyReady": "Proxy listo", "settings.officialWebPlayers": "Web players oficiales", "settings.exploreHelp": "Se guarda solo. Si no abre, cambia Proxy y reintenta.", "settings.enterProxyUrl": "Introduce una URL proxy completa", "settings.nightBrightness": "Brillo noche {percent}%", "settings.nasStatus": "Estado NAS", "settings.tracks": "{count} canciones", "settings.savedCount": "{count} guardadas",
  "library.source": "Fuente", "library.nas": "NAS", "library.usb": "USB", "library.recentlyAdded": "Recientes", "library.localShort": "{count} local", "library.nasShort": "{count} NAS", "library.usbShort": "{count} USB", "library.savedShort": "{count} guardadas", "library.newShort": "{count} nuevas", "library.deleteFromLocal": "Eliminar de Local", "library.clearSearch": "Limpiar búsqueda", "library.localStorage": "Espacio local: {free} libre", "library.localStorageUnavailable": "Espacio local no disponible", "library.free": "{free} libre", "library.backMain": "Volver a pantalla principal", "library.loading": "Cargando biblioteca...", "library.emptyNas": "Añade NAS en Settings.", "library.emptyUsb": "Sin canciones USB. Revisa la unidad y escanea.", "library.emptyFavorites": "Sin favoritos. Toca el corazón de una canción.", "library.emptyRecent": "Sin canciones recientes.", "library.emptyLocal": "Sin canciones locales. Copia desde USB o escanea.", "library.savedToLocal": "Guardado en Local.", "library.alreadySaved": "Ya guardado localmente.", "library.savedFavorite": "Guardado en Favoritos.", "library.removedFavorite": "Quitado de Favoritos.", "library.removedLocal": "Quitado de Local.",
  "radio.threeFresh": "Tres opciones nuevas. Toca una.", "radio.loading": "Cargando emisoras...", "radio.empty": "No hay emisoras aquí. Prueba Random.", "radio.random": "Aleatorio", "explore.noWebPlayer": "Sin web player", "explore.chooseBelow": "Elige un web player abajo", "explore.openLeft": "Abriendo a la izquierda", "explore.couldNotOpen": "No se pudo abrir", "explore.proxyActive": "Proxy activo", "explore.directConnection": "Conexión directa", "explore.footer": "Elige música a la izquierda. Tikpal queda aquí.", "explore.webPlayers": "Web players de música", "explore.tikpalControls": "Controles Tikpal", "explore.leftFont": "Texto del provider izquierdo", "remote.optionalAccessKey": "Clave opcional", "remote.noKey": "Sin clave", "remote.refresh": "Actualizar", "remote.sources": "Fuentes", "remote.room": "Sala", "remote.hifiEq": "Hi-Fi EQ", "remote.scene": "Escena", "remote.display": "Pantalla", "remote.startExplore": "Iniciar Explore", "remote.proxyOn": "Proxy On", "remote.proxyOff": "Proxy Off", "remote.soundOn": "Sonido On", "remote.soundOff": "Sonido Off", "error.accessKey": "Revisa la clave.", "error.noConnection": "Sin conexión aún. Reabre la fuente.", "error.proxy": "Revisa Web Proxy y reintenta.", "error.brightness": "El brillo no cambió. Prueba más bajo.", "error.copy": "No se pudo guardar en Local.", "error.delete": "No se pudo quitar esta canción.", "error.favorite": "No se pudieron actualizar Favoritos.", "error.radio": "Radio no está lista. Prueba otra emisora.", "error.library": "Biblioteca no lista. Escanea o reintenta.", "error.explore": "Explore no se abrió. Revisa Proxy.", "error.volume": "El volumen no cambió.", "error.timeout": "Tardó demasiado. Reintenta.", "error.connection": "Conexión lenta. Reintenta.", "error.generic": "Necesita atención. Reintenta."
});

Object.assign(dictionaries["zh-CN"], {
  "settings.displayBrightness": "屏幕亮度",
  "settings.brightnessPanel": "屏幕亮度面板",
  "settings.hardware": "硬件",
  "settings.dimStep": "变暗 -10",
  "settings.boostStep": "增亮 +10",
  "settings.screenSleep": "屏幕休眠",
  "settings.screenSleepMeta": "触摸可唤醒屏幕。",
  "settings.sleepStyle": "屏保样式",
  "settings.sleepStyle.meteor_shower": "流星雨",
  "settings.sleepStyle.clock": "时钟",
  "settings.sleepStyle.now_playing": "正在播放",
  "settings.sleepStyle.starfield": "星空",
  "settings.sleepStyle.signal": "信号线",
  "settings.previewSleepStyle": "预览",
  "settings.stopSleepPreview": "退出屏保预览",
  "settings.turnOffAfter": "多久后关屏",
  "settings.sleepAfterMinutes": "{minutes} 分钟"
});

Object.assign(dictionaries.de, {
  "settings.displayBrightness": "Display-Helligkeit",
  "settings.brightnessPanel": "Display-Helligkeit",
  "settings.hardware": "Hardware",
  "settings.dimStep": "Dunkler -10",
  "settings.boostStep": "Heller +10",
  "settings.screenSleep": "Bildschirmruhe",
  "settings.screenSleepMeta": "Berührung weckt den Bildschirm.",
  "settings.sleepStyle": "Schoner",
  "settings.sleepStyle.meteor_shower": "Sternschnuppen",
  "settings.sleepStyle.clock": "Uhr",
  "settings.sleepStyle.now_playing": "Jetzt läuft",
  "settings.sleepStyle.starfield": "Sternfeld",
  "settings.sleepStyle.signal": "Signal",
  "settings.previewSleepStyle": "Vorschau",
  "settings.stopSleepPreview": "Vorschau beenden",
  "settings.turnOffAfter": "Ausschalten nach",
  "settings.sleepAfterMinutes": "{minutes} Min."
});

Object.assign(dictionaries.it, {
  "settings.displayBrightness": "Luminosità display",
  "settings.brightnessPanel": "Pannello luminosità",
  "settings.hardware": "Hardware",
  "settings.dimStep": "Riduci -10",
  "settings.boostStep": "Aumenta +10",
  "settings.screenSleep": "Sospensione schermo",
  "settings.screenSleepMeta": "Un tocco riattiva lo schermo.",
  "settings.sleepStyle": "Salvaschermo",
  "settings.sleepStyle.meteor_shower": "Stelle cadenti",
  "settings.sleepStyle.clock": "Orologio",
  "settings.sleepStyle.now_playing": "In riproduzione",
  "settings.sleepStyle.starfield": "Stelle",
  "settings.sleepStyle.signal": "Segnale",
  "settings.previewSleepStyle": "Anteprima",
  "settings.stopSleepPreview": "Chiudi anteprima",
  "settings.turnOffAfter": "Spegni dopo",
  "settings.sleepAfterMinutes": "{minutes} min"
});

Object.assign(dictionaries.ko, {
  "settings.displayBrightness": "화면 밝기",
  "settings.brightnessPanel": "화면 밝기 패널",
  "settings.hardware": "하드웨어",
  "settings.dimStep": "어둡게 -10",
  "settings.boostStep": "밝게 +10",
  "settings.screenSleep": "화면 절전",
  "settings.screenSleepMeta": "터치하면 화면이 켜집니다.",
  "settings.sleepStyle": "화면보호기",
  "settings.sleepStyle.meteor_shower": "유성우",
  "settings.sleepStyle.clock": "시계",
  "settings.sleepStyle.now_playing": "재생 중",
  "settings.sleepStyle.starfield": "별빛",
  "settings.sleepStyle.signal": "시그널",
  "settings.previewSleepStyle": "미리보기",
  "settings.stopSleepPreview": "미리보기 종료",
  "settings.turnOffAfter": "꺼지는 시간",
  "settings.sleepAfterMinutes": "{minutes}분"
});

Object.assign(dictionaries.ja, {
  "settings.displayBrightness": "画面の明るさ",
  "settings.brightnessPanel": "明るさパネル",
  "settings.hardware": "ハードウェア",
  "settings.dimStep": "暗く -10",
  "settings.boostStep": "明るく +10",
  "settings.screenSleep": "画面スリープ",
  "settings.screenSleepMeta": "タッチで画面を復帰します。",
  "settings.sleepStyle": "スクリーンセーバー",
  "settings.sleepStyle.meteor_shower": "流星群",
  "settings.sleepStyle.clock": "時計",
  "settings.sleepStyle.now_playing": "再生中",
  "settings.sleepStyle.starfield": "星空",
  "settings.sleepStyle.signal": "シグナル",
  "settings.previewSleepStyle": "プレビュー",
  "settings.stopSleepPreview": "プレビュー終了",
  "settings.turnOffAfter": "消灯まで",
  "settings.sleepAfterMinutes": "{minutes}分"
});

Object.assign(dictionaries.es, {
  "settings.displayBrightness": "Brillo de pantalla",
  "settings.brightnessPanel": "Panel de brillo",
  "settings.hardware": "Hardware",
  "settings.dimStep": "Bajar -10",
  "settings.boostStep": "Subir +10",
  "settings.screenSleep": "Reposo de pantalla",
  "settings.screenSleepMeta": "Toca para despertar la pantalla.",
  "settings.sleepStyle": "Salvapantallas",
  "settings.sleepStyle.meteor_shower": "Lluvia de meteoros",
  "settings.sleepStyle.clock": "Reloj",
  "settings.sleepStyle.now_playing": "Reproduciendo",
  "settings.sleepStyle.starfield": "Estrellas",
  "settings.sleepStyle.signal": "Señal",
  "settings.previewSleepStyle": "Vista previa",
  "settings.stopSleepPreview": "Salir de vista previa",
  "settings.turnOffAfter": "Apagar después de",
  "settings.sleepAfterMinutes": "{minutes} min"
});

Object.assign(dictionaries["zh-CN"], {
  "app.name": "Tikpal", "source.localQueueReady": "本地队列就绪",
  "settings.preferencesDesc": "音频、显示、字体和聆听浮层。", "settings.libraryDesc": "本地音乐、USB、NAS 和扫描状态。", "settings.linkDesc": "连接与远程访问。", "settings.careDesc": "受保护的重启和关机。", "settings.adjustable": "可调", "settings.readOnly": "只读", "settings.screenReady": "屏幕就绪", "settings.brightnessReady": "亮度就绪", "settings.night": "夜间", "settings.auto": "自动", "settings.addNasInSettings": "在 Settings 添加 NAS", "settings.portableStorage": "移动存储", "settings.portableStorageMounted": "移动存储已挂载", "settings.scanInProgress": "扫描中", "settings.chooseTypography": "选择 kiosk 字体", "settings.switchSkin": "切换皮肤", "settings.tuneLyrics": "调整歌词", "settings.limited": "受限", "settings.needsAttention": "需要检查", "settings.systemReboot": "系统重启", "settings.powerOff": "关机", "settings.adjustType": "调整字体", "settings.proxyKeyboard": "代理与键盘", "settings.proxyReady": "代理就绪", "settings.officialWebPlayers": "官方网页播放器", "settings.exploreHelp": "会自动保存。播放器打不开时，切换代理后重试。", "settings.enterProxyUrl": "输入完整代理 URL", "settings.nightBrightness": "夜间亮度 {percent}%", "settings.nasStatus": "NAS 状态",
  "library.localShort": "{count} 本地", "library.nasShort": "{count} NAS", "library.usbShort": "{count} USB", "library.savedShort": "{count} 已保存", "library.newShort": "{count} 新增", "library.localStorage": "本地空间：剩余 {free}", "library.localStorageUnavailable": "本地空间不可用",
  "explore.webPlayers": "音乐网页播放器", "explore.tikpalControls": "Tikpal 控制", "explore.leftFont": "左侧播放器字体",
  "error.accessKey": "请检查访问密钥。", "error.noConnection": "尚未连接。重新打开音源后重试。", "error.proxy": "检查 Web Proxy 后重试。", "error.brightness": "亮度未改变。试试更低数值。", "error.copy": "无法保存到本地。请重试。", "error.delete": "无法移除这首歌。请重试。", "error.favorite": "无法更新收藏。请重试。", "error.radio": "电台未就绪。试试其他电台。", "error.library": "曲库未就绪。请扫描或重试。", "error.explore": "Explore 未打开。检查代理后重试。", "error.volume": "音量未改变。请重试。", "error.timeout": "等待太久了。请重试。", "error.connection": "连接较慢。请重试。", "error.generic": "需要检查。请重试。"
});

Object.assign(dictionaries.en, {
  "common.failed": "Needs attention",
  "settings.preferencesDesc": "Language, display, sound, and listening.",
  "settings.libraryDesc": "Music here, USB, NAS, and scans.",
  "settings.linkDesc": "Network, remote, and web players.",
  "settings.careDesc": "Restart and power controls.",
  "settings.confirmNeeded": "Tap again",
  "settings.displayBrightness": "Brightness",
  "settings.brightnessPanel": "Brightness",
  "settings.dimStep": "Dim",
  "settings.boostStep": "Brighter",
  "settings.screenSleep": "Auto screen sleep",
  "settings.sleepStyle": "Screen saver",
  "settings.turnOffAfter": "After",
  "settings.proxyKeyboard": "Web players",
  "settings.proxyReady": "Proxy on",
  "settings.officialWebPlayers": "Direct web players",
  "settings.exploreHelp": "Saves automatically. If a player will not open, switch Proxy and retry.",
  "settings.dayMode": "Day mode",
  "settings.lyricsHidden": "Lyrics are hidden.",
  "settings.lyricsSize.large": "Large",
  "settings.lyricsSize.medium": "Medium",
  "settings.lyricsSize.small": "Small",
  "settings.lyricsVisible": "Lyrics are visible.",
  "settings.nightActive": "Night active",
  "settings.nasSources": "NAS Music",
  "settings.addNasInSettings": "Add NAS in Settings",
  "playback.seekUnavailable": "Seeking is not available here.",
  "playback.seekUnavailableNas": "Copy to Local to seek.",
  "error.copy": "Could not save to Local. Check space or try another track.",
  "error.delete": "Could not remove this track. Try again.",
  "error.favorite": "Favorite did not change. Try again.",
  "error.library": "Library is not ready. Scan Library, then reopen this tab.",
  "error.nas": "Open NAS settings and check the share.",
  "error.seek": "Could not jump there. Try again after playback settles.",
  "error.timeout": "This took too long. Try again in a moment.",
  "error.usb": "Check the drive, then scan.",
  "nas.addNas": "Add NAS",
  "nas.addOrScan": "Add or scan",
  "nas.account": "Account",
  "nas.accountPassword": "Username + password",
  "nas.cancel": "Cancel",
  "nas.delete": "Delete",
  "nas.deleteQuestion": "Delete NAS?",
  "nas.edit": "Edit",
  "nas.editNas": "Edit NAS",
  "nas.foundShares": "{count} found. Choose one to add.",
  "nas.folder": "Folder",
  "nas.guest": "Guest",
  "nas.hidePassword": "Hide password",
  "nas.loadedFromEnvironment": "Loaded from environment.",
  "nas.localName": "Local Name",
  "nas.manageHere": "Saved NAS appears on the left. Pick one to manage it here.",
  "nas.mount": "Mount",
  "nas.name": "Name",
  "nas.newNas": "New NAS",
  "nas.noNasYet": "No NAS yet",
  "nas.noPassword": "No password",
  "nas.noResults": "No results",
  "nas.noResultsHint": "Tap Scan Network.",
  "nas.noSharesFound": "No shares found.",
  "nas.optional": "Optional",
  "nas.path": "Path",
  "nas.password": "Password",
  "nas.port": "Port",
  "nas.readOnlyEnvironment": "Read-only source from environment.",
  "nas.readySaveScan": "Ready. Save and scan music.",
  "nas.readyTrackCount": "Ready to play · {count} tracks",
  "nas.reviewThenTest": "Review, then test.",
  "nas.removed": "NAS removed.",
  "nas.saveScan": "Save & Scan",
  "nas.savedNas": "Saved NAS",
  "nas.scan": "Scan",
  "nas.scanNetwork": "Scan Network",
  "nas.scanOrAdd": "Scan Network or add one manually.",
  "nas.scanResults": "Scan Results",
  "nas.scanning": "Scanning...",
  "nas.serverIp": "Server/IP",
  "nas.share": "Share",
  "nas.showPassword": "Show password",
  "nas.status.checkSetup": "Needs setup",
  "nas.status.checking": "Checking",
  "nas.status.manual": "Manual source",
  "nas.status.offline": "Offline",
  "nas.status.ready": "Ready to play",
  "nas.test": "Test",
  "nas.testFirst": "Test first, then save.",
  "nas.testing": "Testing...",
  "nas.tracks": "Tracks",
  "nas.unmount": "Unmount",
  "nas.username": "Username",
  "nas.version": "Version",
  "radio.category.blues": "Blues",
  "radio.category.calm": "Calm",
  "radio.category.classical": "Classical",
  "radio.category.electronic": "Electronic",
  "radio.category.focus": "Focus",
  "radio.category.hifi": "Hi-Fi",
  "radio.category.jazz": "Jazz",
  "radio.category.news": "News",
  "radio.category.podcast": "Podcast",
  "radio.category.rock": "Rock",
  "radio.category.sleep": "Sleep",
  "radio.category.world": "World"
});

Object.assign(dictionaries["zh-CN"], {
  "common.failed": "需要检查",
  "common.proxyOff": "代理关",
  "common.proxyOn": "代理开",
  "settings.preferencesDesc": "语言、显示、声音和聆听体验。",
  "settings.libraryDesc": "本机音乐、USB、NAS 和扫描。",
  "settings.linkDesc": "网络、遥控和网页播放器。",
  "settings.careDesc": "重启和电源控制。",
  "settings.confirmNeeded": "再点一次",
  "settings.displayBrightness": "亮度",
  "settings.brightnessPanel": "亮度",
  "settings.dimStep": "变暗",
  "settings.boostStep": "增亮",
  "settings.screenSleep": "自动屏幕休眠",
  "settings.sleepStyle": "屏保",
  "settings.turnOffAfter": "等待",
  "settings.proxyKeyboard": "网页播放器",
  "settings.proxyReady": "代理已开",
  "settings.officialWebPlayers": "直连网页播放器",
  "settings.exploreHelp": "会自动保存。播放器打不开时，切换代理后重试。",
  "settings.dayMode": "白天模式",
  "settings.lyricsHidden": "歌词已隐藏。",
  "settings.lyricsSize.large": "大",
  "settings.lyricsSize.medium": "中",
  "settings.lyricsSize.small": "小",
  "settings.lyricsVisible": "歌词已显示。",
  "settings.nightActive": "夜间模式",
  "settings.nasSources": "NAS 音乐",
  "settings.addNasInSettings": "在设置里添加 NAS",
  "playback.seekUnavailable": "这里不能拖动进度。",
  "playback.seekUnavailableNas": "复制到本地后可拖动。",
  "error.copy": "无法保存到本地。检查空间或换一首。",
  "error.delete": "无法移除这首歌。请重试。",
  "error.favorite": "收藏状态未改变。请重试。",
  "error.library": "曲库还没准备好。先扫描曲库，再打开此页。",
  "error.nas": "打开 NAS 设置，检查共享目录。",
  "error.seek": "暂时无法跳转。等播放稳定后重试。",
  "error.timeout": "等待太久了。稍后再试。",
  "error.usb": "检查 U 盘后再扫描。",
  "nas.addNas": "添加 NAS",
  "nas.addOrScan": "添加或扫描",
  "nas.account": "账号",
  "nas.accountPassword": "用户名和密码",
  "nas.cancel": "取消",
  "nas.delete": "删除",
  "nas.deleteQuestion": "删除 NAS？",
  "nas.edit": "编辑",
  "nas.editNas": "编辑 NAS",
  "nas.foundShares": "找到 {count} 个。选择一个添加。",
  "nas.folder": "文件夹",
  "nas.guest": "访客",
  "nas.hidePassword": "隐藏密码",
  "nas.loadedFromEnvironment": "来自本机配置。",
  "nas.localName": "本地名称",
  "nas.manageHere": "已保存的 NAS 会显示在左侧。点一个即可管理。",
  "nas.mount": "挂载",
  "nas.name": "名称",
  "nas.newNas": "新 NAS",
  "nas.noNasYet": "还没有 NAS",
  "nas.noPassword": "无需密码",
  "nas.noResults": "没有结果",
  "nas.noResultsHint": "点击扫描网络。",
  "nas.noSharesFound": "没有找到共享目录。",
  "nas.optional": "可选",
  "nas.path": "路径",
  "nas.password": "密码",
  "nas.port": "端口",
  "nas.readOnlyEnvironment": "来自环境配置的只读来源。",
  "nas.readySaveScan": "已连通。保存并扫描音乐。",
  "nas.readyTrackCount": "可播放 · {count} 首",
  "nas.reviewThenTest": "确认信息后测试。",
  "nas.removed": "NAS 已删除。",
  "nas.saveScan": "保存并扫描",
  "nas.savedNas": "已保存 NAS",
  "nas.scan": "扫描",
  "nas.scanNetwork": "扫描网络",
  "nas.scanOrAdd": "扫描网络，或手动添加。",
  "nas.scanResults": "扫描结果",
  "nas.scanning": "扫描中...",
  "nas.serverIp": "服务器/IP",
  "nas.share": "共享名",
  "nas.showPassword": "显示密码",
  "nas.status.checkSetup": "需要设置",
  "nas.status.checking": "检查中",
  "nas.status.manual": "手动来源",
  "nas.status.offline": "离线",
  "nas.status.ready": "可播放",
  "nas.test": "测试",
  "nas.testFirst": "先测试，再保存。",
  "nas.testing": "测试中...",
  "nas.tracks": "歌曲",
  "nas.unmount": "卸载",
  "nas.username": "用户名",
  "nas.version": "版本",
  "radio.category.blues": "布鲁斯",
  "radio.category.calm": "放松",
  "radio.category.classical": "古典",
  "radio.category.electronic": "电子",
  "radio.category.focus": "专注",
  "radio.category.hifi": "Hi-Fi",
  "radio.category.jazz": "爵士",
  "radio.category.news": "新闻",
  "radio.category.podcast": "播客",
  "radio.category.rock": "摇滚",
  "radio.category.sleep": "睡眠",
  "radio.category.world": "世界"
});

Object.assign(dictionaries.de, {
  "common.failed": "Pruefen",
  "common.proxyOff": "Proxy aus",
  "common.proxyOn": "Proxy an",
  "settings.preferencesDesc": "Sprache, Display, Klang und Hoeren.",
  "settings.libraryDesc": "Musik hier, USB, NAS und Scans.",
  "settings.linkDesc": "Netzwerk, Remote und Webplayer.",
  "settings.careDesc": "Neustart und Stromsteuerung.",
  "settings.confirmNeeded": "Nochmals tippen",
  "settings.displayBrightness": "Helligkeit",
  "settings.brightnessPanel": "Helligkeit",
  "settings.dimStep": "Dunkler",
  "settings.boostStep": "Heller",
  "settings.screenSleep": "Automatische Bildschirmruhe",
  "settings.sleepStyle": "Bildschirmschoner",
  "settings.turnOffAfter": "Nach",
  "settings.proxyKeyboard": "Webplayer",
  "settings.nasSources": "NAS-Musik",
  "playback.seekUnavailable": "Springen ist hier nicht verfuegbar.",
  "playback.seekUnavailableNas": "Zum Springen lokal kopieren.",
  "error.nas": "NAS-Einstellungen oeffnen und Freigabe pruefen.",
  "error.seek": "Sprung nicht moeglich. Kurz warten und erneut versuchen.",
  "error.usb": "Laufwerk pruefen, dann scannen.",
  "nas.addNas": "NAS hinzufuegen",
  "nas.cancel": "Abbrechen",
  "nas.delete": "Loeschen",
  "nas.deleteQuestion": "NAS loeschen?",
  "nas.edit": "Bearbeiten",
  "nas.editNas": "NAS bearbeiten",
  "nas.guest": "Gast",
  "nas.mount": "Einbinden",
  "nas.noNasYet": "Noch kein NAS",
  "nas.noResults": "Keine Ergebnisse",
  "nas.saveScan": "Speichern & scannen",
  "nas.savedNas": "Gespeicherte NAS",
  "nas.scan": "Scannen",
  "nas.scanNetwork": "Netzwerk scannen",
  "nas.scanResults": "Scan-Ergebnisse",
  "nas.status.checkSetup": "Setup noetig",
  "nas.status.manual": "Manuelle Quelle",
  "nas.status.ready": "Bereit zum Abspielen",
  "nas.test": "Test",
  "nas.testFirst": "Erst testen, dann speichern.",
  "nas.tracks": "Titel",
  "nas.unmount": "Trennen"
});

Object.assign(dictionaries.it, {
  "common.failed": "Da controllare",
  "common.proxyOff": "Proxy Off",
  "common.proxyOn": "Proxy On",
  "settings.preferencesDesc": "Lingua, display, audio e ascolto.",
  "settings.libraryDesc": "Musica qui, USB, NAS e scansioni.",
  "settings.linkDesc": "Rete, remoto e player web.",
  "settings.careDesc": "Riavvio e alimentazione.",
  "settings.confirmNeeded": "Tocca ancora",
  "settings.displayBrightness": "Luminosita",
  "settings.brightnessPanel": "Luminosita",
  "settings.dimStep": "Riduci",
  "settings.boostStep": "Aumenta",
  "settings.screenSleep": "Riposo schermo auto",
  "settings.sleepStyle": "Salvaschermo",
  "settings.turnOffAfter": "Dopo",
  "settings.proxyKeyboard": "Player web",
  "settings.nasSources": "Musica NAS",
  "playback.seekUnavailable": "Salto non disponibile qui.",
  "playback.seekUnavailableNas": "Copia in Locale per saltare.",
  "error.nas": "Apri NAS e controlla la condivisione.",
  "error.seek": "Salto non riuscito. Riprova dopo l'avvio.",
  "error.usb": "Controlla il drive, poi scansiona.",
  "nas.addNas": "Aggiungi NAS",
  "nas.cancel": "Annulla",
  "nas.delete": "Elimina",
  "nas.deleteQuestion": "Eliminare NAS?",
  "nas.edit": "Modifica",
  "nas.editNas": "Modifica NAS",
  "nas.guest": "Guest",
  "nas.mount": "Monta",
  "nas.noNasYet": "Nessun NAS",
  "nas.noResults": "Nessun risultato",
  "nas.saveScan": "Salva e scansiona",
  "nas.savedNas": "NAS salvati",
  "nas.scan": "Scansiona",
  "nas.scanNetwork": "Scansiona rete",
  "nas.scanResults": "Risultati",
  "nas.status.checkSetup": "Setup richiesto",
  "nas.status.manual": "Sorgente manuale",
  "nas.status.ready": "Pronto",
  "nas.test": "Test",
  "nas.testFirst": "Prima testa, poi salva.",
  "nas.tracks": "Brani",
  "nas.unmount": "Smonta"
});

Object.assign(dictionaries.ko, {
  "common.failed": "확인 필요",
  "common.proxyOff": "프록시 꺼짐",
  "common.proxyOn": "프록시 켜짐",
  "settings.preferencesDesc": "언어, 화면, 소리, 감상 설정.",
  "settings.libraryDesc": "기기 음악, USB, NAS, 스캔.",
  "settings.linkDesc": "네트워크, 리모컨, 웹 플레이어.",
  "settings.careDesc": "재시작과 전원 제어.",
  "settings.confirmNeeded": "한 번 더 누르기",
  "settings.displayBrightness": "밝기",
  "settings.brightnessPanel": "밝기",
  "settings.dimStep": "어둡게",
  "settings.boostStep": "밝게",
  "settings.screenSleep": "자동 화면 절전",
  "settings.sleepStyle": "화면보호기",
  "settings.turnOffAfter": "시간",
  "settings.proxyKeyboard": "웹 플레이어",
  "settings.nasSources": "NAS 음악",
  "playback.seekUnavailable": "여기서는 이동할 수 없습니다.",
  "playback.seekUnavailableNas": "로컬에 복사하면 이동할 수 있습니다.",
  "error.nas": "NAS 설정에서 공유 폴더를 확인하세요.",
  "error.seek": "이동하지 못했습니다. 재생이 안정되면 다시 시도하세요.",
  "error.usb": "드라이브를 확인한 뒤 스캔하세요.",
  "nas.addNas": "NAS 추가",
  "nas.cancel": "취소",
  "nas.delete": "삭제",
  "nas.deleteQuestion": "NAS 삭제?",
  "nas.edit": "편집",
  "nas.editNas": "NAS 편집",
  "nas.guest": "게스트",
  "nas.mount": "마운트",
  "nas.noNasYet": "NAS 없음",
  "nas.noResults": "결과 없음",
  "nas.saveScan": "저장 및 스캔",
  "nas.savedNas": "저장된 NAS",
  "nas.scan": "스캔",
  "nas.scanNetwork": "네트워크 스캔",
  "nas.scanResults": "스캔 결과",
  "nas.status.checkSetup": "설정 필요",
  "nas.status.manual": "수동 소스",
  "nas.status.ready": "재생 준비됨",
  "nas.test": "테스트",
  "nas.testFirst": "먼저 테스트한 뒤 저장하세요.",
  "nas.tracks": "곡",
  "nas.unmount": "해제"
});

Object.assign(dictionaries.ja, {
  "common.failed": "確認が必要",
  "common.proxyOff": "プロキシオフ",
  "common.proxyOn": "プロキシオン",
  "settings.preferencesDesc": "言語、表示、音、リスニング。",
  "settings.libraryDesc": "本体の音楽、USB、NAS、スキャン。",
  "settings.linkDesc": "ネットワーク、リモート、Webプレイヤー。",
  "settings.careDesc": "再起動と電源操作。",
  "settings.confirmNeeded": "もう一度タップ",
  "settings.displayBrightness": "明るさ",
  "settings.brightnessPanel": "明るさ",
  "settings.dimStep": "暗く",
  "settings.boostStep": "明るく",
  "settings.screenSleep": "自動画面スリープ",
  "settings.sleepStyle": "スクリーンセーバー",
  "settings.turnOffAfter": "時間",
  "settings.proxyKeyboard": "Webプレイヤー",
  "settings.nasSources": "NAS音楽",
  "playback.seekUnavailable": "ここではシークできません。",
  "playback.seekUnavailableNas": "ローカルにコピーするとシークできます。",
  "error.nas": "NAS設定で共有フォルダを確認してください。",
  "error.seek": "移動できませんでした。再生が安定してから再試行。",
  "error.usb": "ドライブを確認してからスキャンしてください。",
  "nas.addNas": "NASを追加",
  "nas.cancel": "キャンセル",
  "nas.delete": "削除",
  "nas.deleteQuestion": "NASを削除?",
  "nas.edit": "編集",
  "nas.editNas": "NASを編集",
  "nas.guest": "ゲスト",
  "nas.mount": "マウント",
  "nas.noNasYet": "NASなし",
  "nas.noResults": "結果なし",
  "nas.saveScan": "保存してスキャン",
  "nas.savedNas": "保存済みNAS",
  "nas.scan": "スキャン",
  "nas.scanNetwork": "ネットワークスキャン",
  "nas.scanResults": "スキャン結果",
  "nas.status.checkSetup": "設定が必要",
  "nas.status.manual": "手動ソース",
  "nas.status.ready": "再生できます",
  "nas.test": "テスト",
  "nas.testFirst": "先にテストしてから保存。",
  "nas.tracks": "曲",
  "nas.unmount": "解除"
});

Object.assign(dictionaries.es, {
  "common.failed": "Revisar",
  "common.proxyOff": "Proxy Off",
  "common.proxyOn": "Proxy On",
  "settings.preferencesDesc": "Idioma, pantalla, sonido y escucha.",
  "settings.libraryDesc": "Musica aqui, USB, NAS y escaneos.",
  "settings.linkDesc": "Red, remoto y web players.",
  "settings.careDesc": "Reinicio y energia.",
  "settings.confirmNeeded": "Toca otra vez",
  "settings.displayBrightness": "Brillo",
  "settings.brightnessPanel": "Brillo",
  "settings.dimStep": "Bajar",
  "settings.boostStep": "Subir",
  "settings.screenSleep": "Reposo automatico",
  "settings.sleepStyle": "Salvapantallas",
  "settings.turnOffAfter": "Despues",
  "settings.proxyKeyboard": "Web players",
  "settings.nasSources": "Musica NAS",
  "playback.seekUnavailable": "No se puede saltar aqui.",
  "playback.seekUnavailableNas": "Copia a Local para saltar.",
  "error.nas": "Abre NAS y revisa la carpeta compartida.",
  "error.seek": "No se pudo saltar. Reintenta cuando arranque.",
  "error.usb": "Revisa la unidad y escanea.",
  "nas.addNas": "Anadir NAS",
  "nas.cancel": "Cancelar",
  "nas.delete": "Eliminar",
  "nas.deleteQuestion": "Eliminar NAS?",
  "nas.edit": "Editar",
  "nas.editNas": "Editar NAS",
  "nas.guest": "Invitado",
  "nas.mount": "Montar",
  "nas.noNasYet": "Sin NAS",
  "nas.noResults": "Sin resultados",
  "nas.saveScan": "Guardar y escanear",
  "nas.savedNas": "NAS guardados",
  "nas.scan": "Escanear",
  "nas.scanNetwork": "Escanear red",
  "nas.scanResults": "Resultados",
  "nas.status.checkSetup": "Revisar setup",
  "nas.status.manual": "Fuente manual",
  "nas.status.ready": "Listo para reproducir",
  "nas.test": "Probar",
  "nas.testFirst": "Prueba primero, luego guarda.",
  "nas.tracks": "Canciones",
  "nas.unmount": "Desmontar"
});

Object.assign(dictionaries.en, {
  "playback.liveStream": "Live stream",
  "settings.link": "Connect",
  "settings.care": "Device",
  "settings.linkDesc": "Network, remote, and web players.",
  "settings.careDesc": "Restart and power controls.",
  "settings.screenSleepOn": "Sleep on",
  "settings.screenSleepOff": "Stays awake",
  "settings.screenStaysAwake": "Screen stays on.",
  "settings.sleepSummary": "{style} · {minutes} min",
  "settings.applyingPercent": "Applying {percent}%...",
  "settings.keyboardDefault": "Keyboard starts in English.",
  "settings.tapToUse": "Tap to use",
  "nas.addShareHint": "Add a shared music folder.",
  "nas.editThenTest": "Edit, then test.",
  "nas.requiredHint": "Enter Server/IP and Share.",
  "nas.trackCountReady": "{count} tracks ready",
  "nas.readyHint": "Ready in Library",
  "nas.manage": "Manage"
});

Object.assign(dictionaries["zh-CN"], {
  "playback.liveStream": "直播流",
  "settings.link": "连接",
  "settings.care": "设备",
  "settings.linkDesc": "网络、遥控与网页播放器。",
  "settings.careDesc": "重启与电源控制。",
  "settings.screenSleepOn": "休眠已开",
  "settings.screenSleepOff": "常亮",
  "settings.screenStaysAwake": "屏幕保持常亮。",
  "settings.sleepSummary": "{style} · {minutes} 分钟",
  "settings.applyingPercent": "正在应用 {percent}%...",
  "settings.keyboardDefault": "键盘默认英文。",
  "settings.tapToUse": "点击使用",
  "nas.addShareHint": "添加一个共享音乐文件夹。",
  "nas.editThenTest": "编辑后先测试。",
  "nas.requiredHint": "填写服务器/IP 和共享名。",
  "nas.trackCountReady": "{count} 首可播放",
  "nas.readyHint": "已在曲库可用",
  "nas.manage": "管理"
});

Object.assign(dictionaries.de, {
  "playback.liveStream": "Livestream",
  "settings.link": "Verbinden",
  "settings.care": "Gerät",
  "settings.linkDesc": "Netzwerk, Remote und Webplayer.",
  "settings.careDesc": "Neustart und Strom.",
  "settings.screenSleepOn": "Sleep an",
  "settings.screenSleepOff": "Bleibt wach",
  "settings.screenStaysAwake": "Bildschirm bleibt an.",
  "settings.sleepSummary": "{style} · {minutes} Min",
  "settings.applyingPercent": "{percent}% wird angewendet...",
  "settings.keyboardDefault": "Tastatur folgt Sprache.",
  "settings.tapToUse": "Antippen",
  "nas.addShareHint": "Geteilten Musikordner hinzufuegen.",
  "nas.editThenTest": "Bearbeiten, dann testen.",
  "nas.requiredHint": "Server/IP und Freigabe eingeben.",
  "nas.trackCountReady": "{count} Titel bereit",
  "nas.readyHint": "Bereit in der Mediathek",
  "nas.manage": "Verwalten"
});

Object.assign(dictionaries.it, {
  "playback.liveStream": "Stream live",
  "settings.link": "Connetti",
  "settings.care": "Dispositivo",
  "settings.linkDesc": "Rete, remote e web player.",
  "settings.careDesc": "Riavvio e alimentazione.",
  "settings.screenSleepOn": "Sleep attivo",
  "settings.screenSleepOff": "Sempre acceso",
  "settings.screenStaysAwake": "Schermo sempre acceso.",
  "settings.sleepSummary": "{style} · {minutes} min",
  "settings.applyingPercent": "Applicazione {percent}%...",
  "settings.keyboardDefault": "Tastiera segue lingua.",
  "settings.tapToUse": "Tocca",
  "nas.addShareHint": "Aggiungi una cartella musica condivisa.",
  "nas.editThenTest": "Modifica, poi testa.",
  "nas.requiredHint": "Inserisci Server/IP e Share.",
  "nas.trackCountReady": "{count} brani pronti",
  "nas.readyHint": "Pronto in Libreria",
  "nas.manage": "Gestisci"
});

Object.assign(dictionaries.ko, {
  "playback.liveStream": "라이브 스트림",
  "settings.link": "연결",
  "settings.care": "기기",
  "settings.linkDesc": "네트워크, 리모컨, 웹 플레이어.",
  "settings.careDesc": "재시작과 전원 제어.",
  "settings.screenSleepOn": "절전 켜짐",
  "settings.screenSleepOff": "항상 켜짐",
  "settings.screenStaysAwake": "화면이 계속 켜져 있습니다.",
  "settings.sleepSummary": "{style} · {minutes}분",
  "settings.applyingPercent": "{percent}% 적용 중...",
  "settings.keyboardDefault": "키보드는 언어를 따릅니다.",
  "settings.tapToUse": "탭하여 사용",
  "nas.addShareHint": "공유 음악 폴더를 추가하세요.",
  "nas.editThenTest": "편집 후 테스트하세요.",
  "nas.requiredHint": "Server/IP와 Share를 입력하세요.",
  "nas.trackCountReady": "{count}곡 준비됨",
  "nas.readyHint": "라이브러리에서 준비됨",
  "nas.manage": "관리"
});

Object.assign(dictionaries.ja, {
  "playback.liveStream": "ライブ配信",
  "settings.link": "接続",
  "settings.care": "端末",
  "settings.linkDesc": "ネットワーク、リモート、Webプレイヤー。",
  "settings.careDesc": "再起動と電源操作。",
  "settings.screenSleepOn": "スリープ有効",
  "settings.screenSleepOff": "常時点灯",
  "settings.screenStaysAwake": "画面は点灯したままです。",
  "settings.sleepSummary": "{style} · {minutes}分",
  "settings.applyingPercent": "{percent}%を適用中...",
  "settings.keyboardDefault": "キーボードは言語に追従。",
  "settings.tapToUse": "タップ",
  "nas.addShareHint": "共有音楽フォルダを追加。",
  "nas.editThenTest": "編集してからテスト。",
  "nas.requiredHint": "Server/IP と Share を入力。",
  "nas.trackCountReady": "{count}曲準備完了",
  "nas.readyHint": "ライブラリで利用可",
  "nas.manage": "管理"
});

Object.assign(dictionaries.es, {
  "playback.liveStream": "Stream en vivo",
  "settings.link": "Conectar",
  "settings.care": "Dispositivo",
  "settings.linkDesc": "Red, remoto y web players.",
  "settings.careDesc": "Reinicio y energia.",
  "settings.screenSleepOn": "Reposo activo",
  "settings.screenSleepOff": "Siempre encendida",
  "settings.screenStaysAwake": "La pantalla queda encendida.",
  "settings.sleepSummary": "{style} · {minutes} min",
  "settings.applyingPercent": "Aplicando {percent}%...",
  "settings.keyboardDefault": "Teclado sigue idioma.",
  "settings.tapToUse": "Tocar",
  "nas.addShareHint": "Anade una carpeta de musica compartida.",
  "nas.editThenTest": "Edita y prueba.",
  "nas.requiredHint": "Introduce Server/IP y Share.",
  "nas.trackCountReady": "{count} canciones listas",
  "nas.readyHint": "Listo en Biblioteca",
  "nas.manage": "Gestionar"
});

Object.assign(dictionaries.en, {
  "source.roonbridge": "Roon Bridge",
  "source.lyrion": "Lyrion",
  "source.tikpal_multiroom": "Tikpal Multi-room",
  "source.music_assistant": "Music Assistant",
  "playback.playingFromRoon": "Playing from Roon.",
  "playback.playingFromMultiroom": "Playing from {label}.",
  "settings.multiroomAudio": "Multi-room Audio",
  "settings.multiroomOffMeta": "Choose a room system",
  "settings.multiroomReadyMeta": "Start playback in your app",
  "settings.multiroomReadyCount": "{count} ready",
  "settings.multiroomPlaying": "Playing",
  "settings.multiroomReady": "Ready",
  "settings.multiroomStarting": "Starting",
  "settings.multiroomCheckSetup": "Check setup",
  "settings.multiroomComingSoon": "Coming soon",
  "settings.multiroomStart": "Start {label}",
  "settings.multiroomStop": "Stop {label}",
  "settings.multiroomStartHint": "Pauses Tikpal audio now.",
  "settings.multiroomStopHint": "Restores Tikpal audio after stop.",
  "settings.multiroomActiveHint": "{label} owns the DAC now.",
  "settings.multiroomComingSoonHint": "Reserved for a future update.",
  "settings.multiroomReleaseBody": "Starting one ecosystem pauses Radio or Library. Stopping it brings Tikpal back when no other room player is active.",
  "settings.multiroom.ecosystem.roon": "Roon",
  "settings.multiroom.ecosystem.lyrion": "Lyrion",
  "settings.multiroom.ecosystem.tikpal": "Tikpal Multi-room",
  "settings.multiroom.ecosystem.music_assistant": "Music Assistant",
  "settings.multiroom.stack.roon": "Based on: Roon Bridge / RAAT",
  "settings.multiroom.stack.lyrion": "Based on: Squeezelite / LMS",
  "settings.multiroom.stack.tikpal": "Based on: Snapcast endpoint",
  "settings.multiroom.stack.music_assistant": "Based on: Music Assistant planned",
  "settings.roonBridge": "Roon Bridge",
  "settings.roonBridgeMeta": "Start from the Roon app",
  "settings.roonBridgeDetail": "Start playback from the Roon app.",
  "settings.roonBridgeOffMeta": "Ready to start",
  "settings.roonBridgeOnMeta": "Use the Roon app",
  "settings.roonBridgeOffDetail": "Start Roon, then choose Tikpal in the Roon app.",
  "settings.roonBridgeOnDetail": "Tikpal audio is paused while Roon is ready.",
  "settings.roonBridgeOff": "Off",
  "settings.roonBridgeReady": "Ready",
  "settings.roonBridgePlaying": "Playing",
  "settings.roonBridgeCheckSetup": "Check setup",
  "settings.roonBridgeStart": "Start Roon",
  "settings.roonBridgeStop": "Stop Roon",
  "settings.roonBridgeStartHint": "Pauses Tikpal audio",
  "settings.roonBridgeStopHint": "Restores Tikpal audio",
  "settings.mpdQuality": "MPD Profile",
  "settings.mpdQualityMeta": "Pure, Everyday, Sleep, or Custom",
  "settings.standard": "Standard",
  "settings.bitPerfect": "Bit-perfect",
  "settings.bitPerfectHint": "Direct MPD output. Software volume and spectrum may be limited.",
  "settings.volumeLocked": "MPD volume is locked; output level still adjusts.",
  "settings.volumeCapped": "Volume is capped for Sleep.",
  "settings.audioProfile.pure": "Pure Listening",
  "settings.audioProfile.everyday": "Everyday",
  "settings.audioProfile.sleep": "Sleep / Meditation",
  "settings.audioProfile.custom": "Custom",
  "settings.audioProfile.pureHint": "Direct DAC path",
  "settings.audioProfile.everydayHint": "Comfortable daily playback",
  "settings.audioProfile.sleepHint": "Gentle and capped",
  "settings.audioProfile.customHint": "Your saved setup",
  "settings.audioProfile.pureTraits": "Bit-perfect · DAC exclusive · ReplayGain off",
  "settings.audioProfile.everydayTraits": "ReplayGain auto · Crossfade 2s · Preload on",
  "settings.audioProfile.sleepTraits": "48 kHz · Crossfade 5s · Stops in 60 min",
  "settings.audioProfile.customTraits": "Custom MPD output · Saved helper values",
  "settings.audioCustom.pureDirect": "Pure Direct",
  "settings.audioCustom.volumeNormalization": "Volume Normalization",
  "settings.audioCustom.smoothTransition": "Smooth Transition",
  "settings.audioCustom.automaticSampleRate": "Automatic Sample Rate",
  "settings.audioCustom.dsdMode": "DSD Mode",
  "settings.audioCustom.playbackStability": "Playback Stability",
  "settings.audioCustom.pureDirectHint": "Direct DAC output",
  "settings.audioCustom.volumeNormalizationHint": "Balance track loudness",
  "settings.audioCustom.smoothTransitionHint": "Gentle crossfade",
  "settings.audioCustom.automaticSampleRateHint": "Follow each track",
  "settings.audioCustom.dsdModeHint": "DoP for DSD DACs",
  "settings.audioCustom.playbackStabilityHint": "Safer buffering",
  "settings.audioCustom.warning": "Advanced controls. Use carefully.",
  "settings.audioProfileApplied": "Audio profile saved.",
  "settings.audioDiagnostics": "Audio Diagnostics",
  "settings.audioDiagnosticsHint": "Hold Audio Output to inspect.",
  "settings.audioDiagnosticsTitleHint": "Hold title for diagnostics",
  "settings.audioDiagnosticsLoading": "Reading audio diagnostics...",
  "settings.audioDiagnosticsUnavailable": "Diagnostics unavailable.",
  "settings.audioDiagnosticsProfile": "Profile",
  "settings.audioDiagnosticsUpdated": "Updated",
  "settings.audioDiagnosticsMpd": "MPD",
  "settings.audioDiagnosticsAlsa": "ALSA",
  "settings.audioDiagnosticsOwner": "Owner",
  "settings.audioDiagnosticsState": "Status",
  "settings.audioDiagnosticsOutput": "Output",
  "settings.audioDiagnosticsDevice": "Device",
  "settings.audioDiagnosticsReplayGain": "ReplayGain",
  "settings.audioDiagnosticsCrossfade": "Crossfade",
  "settings.audioDiagnosticsFormat": "Format",
  "settings.audioDiagnosticsRate": "Rate",
  "settings.audioDiagnosticsChannels": "Channels",
  "settings.audioDiagnosticsRaw": "Raw",
  "settings.audioDiagnosticsNoActiveStream": "No active stream",
  "settings.audioDiagnosticsNoDacOwner": "No DAC owner",
  "settings.audioDiagnosticsOwnerHint": "Current ALSA process",
  "settings.mpdStandardNoteTitle": "Everyday listening",
  "settings.mpdStandardNoteBody": "Keeps volume, spectrum, and shared audio comfortable.",
  "settings.mpdBitPerfectNoteTitle": "Direct output",
  "settings.mpdBitPerfectNoteBody": "Best for local files when you want MPD to avoid conversion.",
  "settings.roonBridgeNoteTitle": "Use the Roon app",
  "settings.roonBridgeNoteBody": "Tikpal appears as a Roon endpoint when this is on.",
  "settings.roonBridgeReleaseTitle": "Audio handoff",
  "settings.roonBridgeReleaseBody": "Starting Roon pauses Radio or Library now. Stopping Roon brings it back."
});

Object.assign(dictionaries["zh-CN"], {
  "source.roonbridge": "Roon Bridge",
  "source.lyrion": "Lyrion",
  "source.tikpal_multiroom": "Tikpal Multi-room",
  "source.music_assistant": "Music Assistant",
  "playback.playingFromRoon": "正在通过 Roon 播放。",
  "playback.playingFromMultiroom": "正在通过 {label} 播放。",
  "settings.multiroomAudio": "多房间音频",
  "settings.multiroomOffMeta": "选择房间音频生态",
  "settings.multiroomReadyMeta": "从对应 App 开始播放",
  "settings.multiroomReadyCount": "{count} 个已待命",
  "settings.multiroomPlaying": "播放中",
  "settings.multiroomReady": "就绪",
  "settings.multiroomStarting": "启动中",
  "settings.multiroomCheckSetup": "检查设置",
  "settings.multiroomComingSoon": "建设中",
  "settings.multiroomStart": "启动 {label}",
  "settings.multiroomStop": "停止 {label}",
  "settings.multiroomStartHint": "立即暂停 Tikpal 音频。",
  "settings.multiroomStopHint": "停止后恢复 Tikpal 音频。",
  "settings.multiroomActiveHint": "{label} 正在占用 DAC。",
  "settings.multiroomComingSoonHint": "后续版本开放。",
  "settings.multiroomReleaseBody": "启动任一生态会暂停电台或曲库。停止后，若没有其他房间播放器占用，Tikpal 会恢复。",
  "settings.multiroom.ecosystem.roon": "Roon",
  "settings.multiroom.ecosystem.lyrion": "Lyrion",
  "settings.multiroom.ecosystem.tikpal": "Tikpal Multi-room",
  "settings.multiroom.ecosystem.music_assistant": "Music Assistant",
  "settings.multiroom.stack.roon": "基于：Roon Bridge / RAAT",
  "settings.multiroom.stack.lyrion": "基于：Squeezelite / LMS",
  "settings.multiroom.stack.tikpal": "基于：Snapcast 端点",
  "settings.multiroom.stack.music_assistant": "基于：Music Assistant 规划中",
  "settings.roonBridge": "Roon Bridge",
  "settings.roonBridgeMeta": "从 Roon App 开始播放",
  "settings.roonBridgeDetail": "请从 Roon App 选择 Tikpal 播放。",
  "settings.roonBridgeOffMeta": "可以启动",
  "settings.roonBridgeOnMeta": "从 Roon App 播放",
  "settings.roonBridgeOffDetail": "启动 Roon 后，在 Roon App 里选择 Tikpal。",
  "settings.roonBridgeOnDetail": "Roon 待命时，Tikpal 音频已让出。",
  "settings.roonBridgeOff": "已关闭",
  "settings.roonBridgeReady": "就绪",
  "settings.roonBridgePlaying": "播放中",
  "settings.roonBridgeCheckSetup": "检查设置",
  "settings.roonBridgeStart": "启动 Roon",
  "settings.roonBridgeStop": "停止 Roon",
  "settings.roonBridgeStartHint": "暂停 Tikpal 音频",
  "settings.roonBridgeStopHint": "恢复 Tikpal 音频",
  "settings.mpdQuality": "MPD 预设",
  "settings.mpdQualityMeta": "Pure、Everyday、Sleep 或自定义",
  "settings.standard": "标准",
  "settings.bitPerfect": "Bit-perfect",
  "settings.bitPerfectHint": "MPD 硬件直出。软件音量和频谱可能受限。",
  "settings.volumeLocked": "MPD 音量已锁定，输出音量仍可调。",
  "settings.volumeCapped": "Sleep 会限制最大音量。",
  "settings.audioProfile.pure": "Pure Listening",
  "settings.audioProfile.everyday": "Everyday",
  "settings.audioProfile.sleep": "Sleep / Meditation",
  "settings.audioProfile.custom": "自定义",
  "settings.audioProfile.pureHint": "DAC 直出",
  "settings.audioProfile.everydayHint": "日常顺手播放",
  "settings.audioProfile.sleepHint": "柔和限音量",
  "settings.audioProfile.customHint": "使用你的保存配置",
  "settings.audioProfile.pureTraits": "Bit-perfect · DAC 独占 · ReplayGain 关",
  "settings.audioProfile.everydayTraits": "ReplayGain 自动 · 2 秒交叉淡化 · 预加载",
  "settings.audioProfile.sleepTraits": "48 kHz · 5 秒交叉淡化 · 60 分钟停止",
  "settings.audioProfile.customTraits": "自定义 MPD 输出 · 保留 helper 参数",
  "settings.audioCustom.pureDirect": "Pure Direct",
  "settings.audioCustom.volumeNormalization": "音量均衡",
  "settings.audioCustom.smoothTransition": "平滑切换",
  "settings.audioCustom.automaticSampleRate": "自动采样率",
  "settings.audioCustom.dsdMode": "DSD 模式",
  "settings.audioCustom.playbackStability": "播放稳定性",
  "settings.audioCustom.pureDirectHint": "DAC 直出",
  "settings.audioCustom.volumeNormalizationHint": "平衡曲目响度",
  "settings.audioCustom.smoothTransitionHint": "柔和交叉淡化",
  "settings.audioCustom.automaticSampleRateHint": "跟随每首歌",
  "settings.audioCustom.dsdModeHint": "给 DSD DAC 用 DoP",
  "settings.audioCustom.playbackStabilityHint": "更稳的缓冲",
  "settings.audioCustom.warning": "高级控制，请谨慎使用。",
  "settings.audioProfileApplied": "音频预设已保存。",
  "settings.audioDiagnostics": "音频诊断",
  "settings.audioDiagnosticsHint": "长按 Audio Output 查看。",
  "settings.audioDiagnosticsTitleHint": "长按标题查看诊断",
  "settings.audioDiagnosticsLoading": "正在读取音频诊断...",
  "settings.audioDiagnosticsUnavailable": "诊断不可用。",
  "settings.audioDiagnosticsProfile": "预设",
  "settings.audioDiagnosticsUpdated": "更新",
  "settings.audioDiagnosticsMpd": "MPD",
  "settings.audioDiagnosticsAlsa": "ALSA",
  "settings.audioDiagnosticsOwner": "占用",
  "settings.audioDiagnosticsState": "状态",
  "settings.audioDiagnosticsOutput": "输出",
  "settings.audioDiagnosticsDevice": "设备",
  "settings.audioDiagnosticsReplayGain": "ReplayGain",
  "settings.audioDiagnosticsCrossfade": "Crossfade",
  "settings.audioDiagnosticsFormat": "格式",
  "settings.audioDiagnosticsRate": "采样率",
  "settings.audioDiagnosticsChannels": "声道",
  "settings.audioDiagnosticsRaw": "原始信息",
  "settings.audioDiagnosticsNoActiveStream": "没有活动音频流",
  "settings.audioDiagnosticsNoDacOwner": "没有 DAC 占用",
  "settings.audioDiagnosticsOwnerHint": "当前 ALSA 进程",
  "settings.mpdStandardNoteTitle": "日常聆听",
  "settings.mpdStandardNoteBody": "保留音量、频谱和共享音频，使用更顺手。",
  "settings.mpdBitPerfectNoteTitle": "硬件直出",
  "settings.mpdBitPerfectNoteBody": "适合本地文件，尽量避免 MPD 转换。",
  "settings.roonBridgeNoteTitle": "从 Roon App 使用",
  "settings.roonBridgeNoteBody": "开启后，Tikpal 会作为 Roon endpoint 出现。",
  "settings.roonBridgeReleaseTitle": "音频交接",
  "settings.roonBridgeReleaseBody": "启动 Roon 会立刻暂停电台或曲库；停止后再恢复。"
});

Object.assign(dictionaries.de, {
  "source.roonbridge": "Roon Bridge",
  "source.lyrion": "Lyrion",
  "source.tikpal_multiroom": "Tikpal Multi-room",
  "source.music_assistant": "Music Assistant",
  "playback.playingFromRoon": "Wiedergabe von Roon.",
  "playback.playingFromMultiroom": "Wiedergabe von {label}.",
  "settings.multiroomAudio": "Multi-room Audio",
  "settings.multiroomOffMeta": "Raumsystem wählen",
  "settings.multiroomReadyMeta": "In der App starten",
  "settings.multiroomReadyCount": "{count} bereit",
  "settings.multiroomPlaying": "Wiedergabe",
  "settings.multiroomReady": "Bereit",
  "settings.multiroomStarting": "Startet",
  "settings.multiroomCheckSetup": "Setup prüfen",
  "settings.multiroomComingSoon": "Bald verfügbar",
  "settings.multiroomStart": "{label} starten",
  "settings.multiroomStop": "{label} stoppen",
  "settings.multiroomStartHint": "Pausiert Tikpal Audio sofort.",
  "settings.multiroomStopHint": "Stellt Tikpal Audio wieder her.",
  "settings.multiroomActiveHint": "{label} nutzt den DAC.",
  "settings.multiroomComingSoonHint": "Für ein späteres Update reserviert.",
  "settings.multiroomReleaseBody": "Beim Start pausiert Tikpal Radio oder Library. Stop stellt es wieder her, wenn kein anderer Room Player aktiv ist.",
  "settings.multiroom.ecosystem.roon": "Roon",
  "settings.multiroom.ecosystem.lyrion": "Lyrion",
  "settings.multiroom.ecosystem.tikpal": "Tikpal Multi-room",
  "settings.multiroom.ecosystem.music_assistant": "Music Assistant",
  "settings.multiroom.stack.roon": "Basiert auf: Roon Bridge / RAAT",
  "settings.multiroom.stack.lyrion": "Basiert auf: Squeezelite / LMS",
  "settings.multiroom.stack.tikpal": "Basiert auf: Snapcast Endpoint",
  "settings.multiroom.stack.music_assistant": "Basiert auf: Music Assistant geplant",
  "settings.roonBridge": "Roon Bridge",
  "settings.roonBridgeMeta": "Aus der Roon App starten",
  "settings.roonBridgeDetail": "Starte die Wiedergabe in der Roon App.",
  "settings.roonBridgeOffMeta": "Startbereit",
  "settings.roonBridgeOnMeta": "Roon App nutzen",
  "settings.roonBridgeOffDetail": "Starte Roon und wähle Tikpal in der Roon App.",
  "settings.roonBridgeOnDetail": "Tikpal Audio ist pausiert, während Roon bereit ist.",
  "settings.roonBridgeOff": "Aus",
  "settings.roonBridgeReady": "Bereit",
  "settings.roonBridgePlaying": "Wiedergabe",
  "settings.roonBridgeCheckSetup": "Setup prüfen",
  "settings.roonBridgeStart": "Roon starten",
  "settings.roonBridgeStop": "Roon stoppen",
  "settings.roonBridgeStartHint": "Pausiert Tikpal Audio",
  "settings.roonBridgeStopHint": "Stellt Tikpal Audio wieder her",
  "settings.mpdQuality": "MPD Profil",
  "settings.mpdQualityMeta": "Pure, Everyday, Sleep oder Custom",
  "settings.standard": "Standard",
  "settings.bitPerfect": "Bit-perfect",
  "settings.bitPerfectHint": "Direkter MPD Ausgang. Software-Lautstärke und Spektrum können begrenzt sein.",
  "settings.volumeLocked": "MPD-Lautstärke ist gesperrt; Ausgangspegel bleibt einstellbar.",
  "settings.volumeCapped": "Lautstärke ist für Sleep begrenzt.",
  "settings.audioProfile.pure": "Pure Listening",
  "settings.audioProfile.everyday": "Everyday",
  "settings.audioProfile.sleep": "Sleep / Meditation",
  "settings.audioProfile.custom": "Custom",
  "settings.audioProfile.pureHint": "Direkt zum DAC",
  "settings.audioProfile.everydayHint": "Bequemes tägliches Hören",
  "settings.audioProfile.sleepHint": "Sanft und begrenzt",
  "settings.audioProfile.customHint": "Dein gespeichertes Setup",
  "settings.audioProfile.pureTraits": "Bit-perfect · DAC exklusiv · ReplayGain aus",
  "settings.audioProfile.everydayTraits": "ReplayGain auto · Crossfade 2s · Preload an",
  "settings.audioProfile.sleepTraits": "48 kHz · Crossfade 5s · Stoppt in 60 min",
  "settings.audioProfile.customTraits": "Custom MPD Ausgang · Helper Werte",
  "settings.audioCustom.pureDirect": "Pure Direct",
  "settings.audioCustom.volumeNormalization": "Lautheit ausgleichen",
  "settings.audioCustom.smoothTransition": "Sanfte Übergänge",
  "settings.audioCustom.automaticSampleRate": "Automatische Samplerate",
  "settings.audioCustom.dsdMode": "DSD Modus",
  "settings.audioCustom.playbackStability": "Wiedergabe stabilisieren",
  "settings.audioCustom.pureDirectHint": "Direkt zum DAC",
  "settings.audioCustom.volumeNormalizationHint": "Titel-Lautheit anpassen",
  "settings.audioCustom.smoothTransitionHint": "Kurzer Crossfade",
  "settings.audioCustom.automaticSampleRateHint": "Folgt jedem Titel",
  "settings.audioCustom.dsdModeHint": "DoP für DSD DACs",
  "settings.audioCustom.playbackStabilityHint": "Sichererer Puffer",
  "settings.audioCustom.warning": "Erweiterte Steuerung. Bitte vorsichtig nutzen.",
  "settings.audioProfileApplied": "Audioprofil gespeichert.",
  "settings.audioDiagnostics": "Audio Diagnostics",
  "settings.audioDiagnosticsHint": "Audio Output halten zum Prüfen.",
  "settings.audioDiagnosticsTitleHint": "Titel halten für Diagnose",
  "settings.audioDiagnosticsLoading": "Audio Diagnostics werden gelesen...",
  "settings.audioDiagnosticsUnavailable": "Diagnostics nicht verfügbar.",
  "settings.audioDiagnosticsProfile": "Profil",
  "settings.audioDiagnosticsUpdated": "Aktualisiert",
  "settings.audioDiagnosticsMpd": "MPD",
  "settings.audioDiagnosticsAlsa": "ALSA",
  "settings.audioDiagnosticsOwner": "Belegung",
  "settings.audioDiagnosticsState": "Status",
  "settings.audioDiagnosticsOutput": "Ausgang",
  "settings.audioDiagnosticsDevice": "Gerät",
  "settings.audioDiagnosticsReplayGain": "ReplayGain",
  "settings.audioDiagnosticsCrossfade": "Crossfade",
  "settings.audioDiagnosticsFormat": "Format",
  "settings.audioDiagnosticsRate": "Rate",
  "settings.audioDiagnosticsChannels": "Kanäle",
  "settings.audioDiagnosticsRaw": "Raw",
  "settings.audioDiagnosticsNoActiveStream": "Kein aktiver Stream",
  "settings.audioDiagnosticsNoDacOwner": "Kein DAC Besitzer",
  "settings.audioDiagnosticsOwnerHint": "Aktueller ALSA Prozess",
  "settings.mpdStandardNoteTitle": "Alltag hören",
  "settings.mpdStandardNoteBody": "Behält Lautstärke, Spektrum und geteiltes Audio bequem.",
  "settings.mpdBitPerfectNoteTitle": "Direkter Ausgang",
  "settings.mpdBitPerfectNoteBody": "Für lokale Dateien, wenn MPD nicht wandeln soll.",
  "settings.roonBridgeNoteTitle": "Roon App nutzen",
  "settings.roonBridgeNoteBody": "Tikpal erscheint als Roon Endpoint, wenn dies aktiv ist.",
  "settings.roonBridgeReleaseTitle": "Audio Übergabe",
  "settings.roonBridgeReleaseBody": "Roon Start pausiert Radio oder Library sofort. Stop stellt es wieder her."
});

Object.assign(dictionaries.it, {
  "source.roonbridge": "Roon Bridge",
  "source.lyrion": "Lyrion",
  "source.tikpal_multiroom": "Tikpal Multi-room",
  "source.music_assistant": "Music Assistant",
  "playback.playingFromRoon": "Riproduzione da Roon.",
  "playback.playingFromMultiroom": "Riproduzione da {label}.",
  "settings.multiroomAudio": "Audio multi-room",
  "settings.multiroomOffMeta": "Scegli un ecosistema",
  "settings.multiroomReadyMeta": "Avvia dall'app",
  "settings.multiroomReadyCount": "{count} pronto",
  "settings.multiroomPlaying": "In riproduzione",
  "settings.multiroomReady": "Pronto",
  "settings.multiroomStarting": "Avvio",
  "settings.multiroomCheckSetup": "Controlla setup",
  "settings.multiroomComingSoon": "In arrivo",
  "settings.multiroomStart": "Avvia {label}",
  "settings.multiroomStop": "Ferma {label}",
  "settings.multiroomStartHint": "Mette in pausa Tikpal.",
  "settings.multiroomStopHint": "Ripristina Tikpal.",
  "settings.multiroomActiveHint": "{label} usa il DAC.",
  "settings.multiroomComingSoonHint": "Riservato a un aggiornamento futuro.",
  "settings.multiroomReleaseBody": "L'avvio mette in pausa Radio o Library. Lo stop ripristina Tikpal se nessun altro player room è attivo.",
  "settings.multiroom.ecosystem.roon": "Roon",
  "settings.multiroom.ecosystem.lyrion": "Lyrion",
  "settings.multiroom.ecosystem.tikpal": "Tikpal Multi-room",
  "settings.multiroom.ecosystem.music_assistant": "Music Assistant",
  "settings.multiroom.stack.roon": "Basato su: Roon Bridge / RAAT",
  "settings.multiroom.stack.lyrion": "Basato su: Squeezelite / LMS",
  "settings.multiroom.stack.tikpal": "Basato su: endpoint Snapcast",
  "settings.multiroom.stack.music_assistant": "Basato su: Music Assistant previsto",
  "settings.roonBridge": "Roon Bridge",
  "settings.roonBridgeMeta": "Avvia dall'app Roon",
  "settings.roonBridgeDetail": "Avvia la riproduzione dall'app Roon.",
  "settings.roonBridgeOffMeta": "Pronto ad avviare",
  "settings.roonBridgeOnMeta": "Usa l'app Roon",
  "settings.roonBridgeOffDetail": "Avvia Roon, poi scegli Tikpal nell'app Roon.",
  "settings.roonBridgeOnDetail": "L'audio Tikpal resta in pausa mentre Roon è pronto.",
  "settings.roonBridgeOff": "Off",
  "settings.roonBridgeReady": "Pronto",
  "settings.roonBridgePlaying": "In riproduzione",
  "settings.roonBridgeCheckSetup": "Controlla setup",
  "settings.roonBridgeStart": "Avvia Roon",
  "settings.roonBridgeStop": "Ferma Roon",
  "settings.roonBridgeStartHint": "Mette in pausa Tikpal",
  "settings.roonBridgeStopHint": "Ripristina Tikpal",
  "settings.mpdQuality": "Profilo MPD",
  "settings.mpdQualityMeta": "Pure, Everyday, Sleep o Custom",
  "settings.standard": "Standard",
  "settings.bitPerfect": "Bit-perfect",
  "settings.bitPerfectHint": "Uscita MPD diretta. Volume software e spettro possono essere limitati.",
  "settings.volumeLocked": "Volume MPD bloccato; il livello di uscita resta regolabile.",
  "settings.volumeCapped": "Volume limitato per Sleep.",
  "settings.audioProfile.pure": "Pure Listening",
  "settings.audioProfile.everyday": "Everyday",
  "settings.audioProfile.sleep": "Sleep / Meditation",
  "settings.audioProfile.custom": "Custom",
  "settings.audioProfile.pureHint": "Percorso DAC diretto",
  "settings.audioProfile.everydayHint": "Ascolto quotidiano comodo",
  "settings.audioProfile.sleepHint": "Dolce e limitato",
  "settings.audioProfile.customHint": "Configurazione salvata",
  "settings.audioProfile.pureTraits": "Bit-perfect · DAC esclusivo · ReplayGain off",
  "settings.audioProfile.everydayTraits": "ReplayGain auto · Crossfade 2s · Preload on",
  "settings.audioProfile.sleepTraits": "48 kHz · Crossfade 5s · Stop tra 60 min",
  "settings.audioProfile.customTraits": "Uscita MPD custom · Valori helper",
  "settings.audioCustom.pureDirect": "Pure Direct",
  "settings.audioCustom.volumeNormalization": "Normalizzazione volume",
  "settings.audioCustom.smoothTransition": "Transizione morbida",
  "settings.audioCustom.automaticSampleRate": "Sample rate automatico",
  "settings.audioCustom.dsdMode": "Modalità DSD",
  "settings.audioCustom.playbackStability": "Stabilità playback",
  "settings.audioCustom.pureDirectHint": "Uscita DAC diretta",
  "settings.audioCustom.volumeNormalizationHint": "Bilancia il volume",
  "settings.audioCustom.smoothTransitionHint": "Crossfade leggero",
  "settings.audioCustom.automaticSampleRateHint": "Segue ogni brano",
  "settings.audioCustom.dsdModeHint": "DoP per DAC DSD",
  "settings.audioCustom.playbackStabilityHint": "Buffer più sicuro",
  "settings.audioCustom.warning": "Controlli avanzati. Usa con cautela.",
  "settings.audioProfileApplied": "Profilo audio salvato.",
  "settings.audioDiagnostics": "Audio Diagnostics",
  "settings.audioDiagnosticsHint": "Tieni Audio Output per ispezionare.",
  "settings.audioDiagnosticsTitleHint": "Tieni il titolo per diagnosi",
  "settings.audioDiagnosticsLoading": "Lettura diagnostica audio...",
  "settings.audioDiagnosticsUnavailable": "Diagnostica non disponibile.",
  "settings.audioDiagnosticsProfile": "Profilo",
  "settings.audioDiagnosticsUpdated": "Aggiornato",
  "settings.audioDiagnosticsMpd": "MPD",
  "settings.audioDiagnosticsAlsa": "ALSA",
  "settings.audioDiagnosticsOwner": "Uso",
  "settings.audioDiagnosticsState": "Stato",
  "settings.audioDiagnosticsOutput": "Uscita",
  "settings.audioDiagnosticsDevice": "Dispositivo",
  "settings.audioDiagnosticsReplayGain": "ReplayGain",
  "settings.audioDiagnosticsCrossfade": "Crossfade",
  "settings.audioDiagnosticsFormat": "Formato",
  "settings.audioDiagnosticsRate": "Rate",
  "settings.audioDiagnosticsChannels": "Canali",
  "settings.audioDiagnosticsRaw": "Raw",
  "settings.audioDiagnosticsNoActiveStream": "Nessuno stream attivo",
  "settings.audioDiagnosticsNoDacOwner": "Nessun owner DAC",
  "settings.audioDiagnosticsOwnerHint": "Processo ALSA attuale",
  "settings.mpdStandardNoteTitle": "Ascolto quotidiano",
  "settings.mpdStandardNoteBody": "Mantiene volume, spettro e audio condiviso comodi.",
  "settings.mpdBitPerfectNoteTitle": "Uscita diretta",
  "settings.mpdBitPerfectNoteBody": "Per file locali quando vuoi evitare conversioni MPD.",
  "settings.roonBridgeNoteTitle": "Usa l'app Roon",
  "settings.roonBridgeNoteBody": "Tikpal appare come endpoint Roon quando è attivo.",
  "settings.roonBridgeReleaseTitle": "Passaggio audio",
  "settings.roonBridgeReleaseBody": "Avviare Roon ferma Radio o Library subito. Lo stop ripristina."
});

Object.assign(dictionaries.ko, {
  "source.roonbridge": "Roon Bridge",
  "source.lyrion": "Lyrion",
  "source.tikpal_multiroom": "Tikpal Multi-room",
  "source.music_assistant": "Music Assistant",
  "playback.playingFromRoon": "Roon에서 재생 중.",
  "playback.playingFromMultiroom": "{label}에서 재생 중.",
  "settings.multiroomAudio": "멀티룸 오디오",
  "settings.multiroomOffMeta": "룸 시스템 선택",
  "settings.multiroomReadyMeta": "앱에서 재생 시작",
  "settings.multiroomReadyCount": "{count}개 준비됨",
  "settings.multiroomPlaying": "재생 중",
  "settings.multiroomReady": "준비됨",
  "settings.multiroomStarting": "시작 중",
  "settings.multiroomCheckSetup": "설정 확인",
  "settings.multiroomComingSoon": "준비 중",
  "settings.multiroomStart": "{label} 시작",
  "settings.multiroomStop": "{label} 중지",
  "settings.multiroomStartHint": "Tikpal 오디오를 즉시 멈춥니다.",
  "settings.multiroomStopHint": "Tikpal 오디오를 복원합니다.",
  "settings.multiroomActiveHint": "{label}이 DAC를 사용 중입니다.",
  "settings.multiroomComingSoonHint": "향후 업데이트에 추가됩니다.",
  "settings.multiroomReleaseBody": "시작하면 Radio 또는 Library를 멈춥니다. 다른 룸 플레이어가 없으면 중지 후 Tikpal이 복원됩니다.",
  "settings.multiroom.ecosystem.roon": "Roon",
  "settings.multiroom.ecosystem.lyrion": "Lyrion",
  "settings.multiroom.ecosystem.tikpal": "Tikpal Multi-room",
  "settings.multiroom.ecosystem.music_assistant": "Music Assistant",
  "settings.multiroom.stack.roon": "기반: Roon Bridge / RAAT",
  "settings.multiroom.stack.lyrion": "기반: Squeezelite / LMS",
  "settings.multiroom.stack.tikpal": "기반: Snapcast 엔드포인트",
  "settings.multiroom.stack.music_assistant": "기반: Music Assistant 예정",
  "settings.roonBridge": "Roon Bridge",
  "settings.roonBridgeMeta": "Roon 앱에서 시작",
  "settings.roonBridgeDetail": "Roon 앱에서 재생을 시작하세요.",
  "settings.roonBridgeOffMeta": "시작 준비됨",
  "settings.roonBridgeOnMeta": "Roon 앱 사용",
  "settings.roonBridgeOffDetail": "Roon을 시작한 뒤 Roon 앱에서 Tikpal을 선택하세요.",
  "settings.roonBridgeOnDetail": "Roon이 준비되는 동안 Tikpal 오디오는 멈춥니다.",
  "settings.roonBridgeOff": "꺼짐",
  "settings.roonBridgeReady": "준비됨",
  "settings.roonBridgePlaying": "재생 중",
  "settings.roonBridgeCheckSetup": "설정 확인",
  "settings.roonBridgeStart": "Roon 시작",
  "settings.roonBridgeStop": "Roon 중지",
  "settings.roonBridgeStartHint": "Tikpal 오디오 일시정지",
  "settings.roonBridgeStopHint": "Tikpal 오디오 복원",
  "settings.mpdQuality": "MPD 프로필",
  "settings.mpdQualityMeta": "Pure, Everyday, Sleep 또는 Custom",
  "settings.standard": "표준",
  "settings.bitPerfect": "Bit-perfect",
  "settings.bitPerfectHint": "MPD 직접 출력. 소프트웨어 볼륨과 스펙트럼이 제한될 수 있습니다.",
  "settings.volumeLocked": "MPD 볼륨은 잠기고 출력 레벨은 조절됩니다.",
  "settings.volumeCapped": "Sleep에서는 볼륨이 제한됩니다.",
  "settings.audioProfile.pure": "Pure Listening",
  "settings.audioProfile.everyday": "Everyday",
  "settings.audioProfile.sleep": "Sleep / Meditation",
  "settings.audioProfile.custom": "사용자 설정",
  "settings.audioProfile.pureHint": "DAC 직접 경로",
  "settings.audioProfile.everydayHint": "편한 일상 재생",
  "settings.audioProfile.sleepHint": "부드럽고 제한됨",
  "settings.audioProfile.customHint": "저장된 설정 사용",
  "settings.audioProfile.pureTraits": "Bit-perfect · DAC 독점 · ReplayGain 끔",
  "settings.audioProfile.everydayTraits": "ReplayGain 자동 · Crossfade 2초 · Preload 켬",
  "settings.audioProfile.sleepTraits": "48 kHz · Crossfade 5초 · 60분 후 정지",
  "settings.audioProfile.customTraits": "사용자 MPD 출력 · Helper 값",
  "settings.audioCustom.pureDirect": "Pure Direct",
  "settings.audioCustom.volumeNormalization": "볼륨 정규화",
  "settings.audioCustom.smoothTransition": "부드러운 전환",
  "settings.audioCustom.automaticSampleRate": "자동 샘플레이트",
  "settings.audioCustom.dsdMode": "DSD 모드",
  "settings.audioCustom.playbackStability": "재생 안정성",
  "settings.audioCustom.pureDirectHint": "DAC 직접 출력",
  "settings.audioCustom.volumeNormalizationHint": "트랙 음량 균형",
  "settings.audioCustom.smoothTransitionHint": "짧은 크로스페이드",
  "settings.audioCustom.automaticSampleRateHint": "곡마다 맞춤",
  "settings.audioCustom.dsdModeHint": "DSD DAC용 DoP",
  "settings.audioCustom.playbackStabilityHint": "안정적인 버퍼",
  "settings.audioCustom.warning": "고급 제어입니다. 신중하게 사용하세요.",
  "settings.audioProfileApplied": "오디오 프로필 저장됨.",
  "settings.audioDiagnostics": "Audio Diagnostics",
  "settings.audioDiagnosticsHint": "Audio Output을 길게 눌러 확인.",
  "settings.audioDiagnosticsTitleHint": "제목을 길게 눌러 진단",
  "settings.audioDiagnosticsLoading": "오디오 진단 읽는 중...",
  "settings.audioDiagnosticsUnavailable": "진단을 사용할 수 없습니다.",
  "settings.audioDiagnosticsProfile": "프로필",
  "settings.audioDiagnosticsUpdated": "업데이트",
  "settings.audioDiagnosticsMpd": "MPD",
  "settings.audioDiagnosticsAlsa": "ALSA",
  "settings.audioDiagnosticsOwner": "점유",
  "settings.audioDiagnosticsState": "상태",
  "settings.audioDiagnosticsOutput": "출력",
  "settings.audioDiagnosticsDevice": "장치",
  "settings.audioDiagnosticsReplayGain": "ReplayGain",
  "settings.audioDiagnosticsCrossfade": "Crossfade",
  "settings.audioDiagnosticsFormat": "형식",
  "settings.audioDiagnosticsRate": "샘플레이트",
  "settings.audioDiagnosticsChannels": "채널",
  "settings.audioDiagnosticsRaw": "원본",
  "settings.audioDiagnosticsNoActiveStream": "활성 스트림 없음",
  "settings.audioDiagnosticsNoDacOwner": "DAC 점유 없음",
  "settings.audioDiagnosticsOwnerHint": "현재 ALSA 프로세스",
  "settings.mpdStandardNoteTitle": "일상 감상",
  "settings.mpdStandardNoteBody": "볼륨, 스펙트럼, 공유 오디오를 편하게 유지합니다.",
  "settings.mpdBitPerfectNoteTitle": "직접 출력",
  "settings.mpdBitPerfectNoteBody": "MPD 변환을 피하고 싶은 로컬 파일에 적합합니다.",
  "settings.roonBridgeNoteTitle": "Roon 앱 사용",
  "settings.roonBridgeNoteBody": "켜면 Tikpal이 Roon endpoint로 나타납니다.",
  "settings.roonBridgeReleaseTitle": "오디오 전환",
  "settings.roonBridgeReleaseBody": "Roon 시작 시 Radio 또는 Library를 바로 멈춥니다. 중지하면 복원합니다."
});

Object.assign(dictionaries.ja, {
  "source.roonbridge": "Roon Bridge",
  "source.lyrion": "Lyrion",
  "source.tikpal_multiroom": "Tikpal Multi-room",
  "source.music_assistant": "Music Assistant",
  "playback.playingFromRoon": "Roonから再生中。",
  "playback.playingFromMultiroom": "{label}から再生中。",
  "settings.multiroomAudio": "マルチルーム音声",
  "settings.multiroomOffMeta": "ルーム音声を選択",
  "settings.multiroomReadyMeta": "アプリから再生",
  "settings.multiroomReadyCount": "{count} 件準備完了",
  "settings.multiroomPlaying": "再生中",
  "settings.multiroomReady": "準備完了",
  "settings.multiroomStarting": "起動中",
  "settings.multiroomCheckSetup": "設定を確認",
  "settings.multiroomComingSoon": "準備中",
  "settings.multiroomStart": "{label}を開始",
  "settings.multiroomStop": "{label}を停止",
  "settings.multiroomStartHint": "Tikpal音声をすぐ一時停止。",
  "settings.multiroomStopHint": "Tikpal音声を復帰します。",
  "settings.multiroomActiveHint": "{label}がDACを使用中です。",
  "settings.multiroomComingSoonHint": "今後の更新で追加予定です。",
  "settings.multiroomReleaseBody": "開始するとRadio/Libraryを停止します。他のルーム再生がなければ停止後にTikpalへ戻ります。",
  "settings.multiroom.ecosystem.roon": "Roon",
  "settings.multiroom.ecosystem.lyrion": "Lyrion",
  "settings.multiroom.ecosystem.tikpal": "Tikpal Multi-room",
  "settings.multiroom.ecosystem.music_assistant": "Music Assistant",
  "settings.multiroom.stack.roon": "ベース: Roon Bridge / RAAT",
  "settings.multiroom.stack.lyrion": "ベース: Squeezelite / LMS",
  "settings.multiroom.stack.tikpal": "ベース: Snapcast エンドポイント",
  "settings.multiroom.stack.music_assistant": "ベース: Music Assistant 予定",
  "settings.roonBridge": "Roon Bridge",
  "settings.roonBridgeMeta": "Roonアプリから開始",
  "settings.roonBridgeDetail": "Roonアプリで再生を開始してください。",
  "settings.roonBridgeOffMeta": "開始できます",
  "settings.roonBridgeOnMeta": "Roonアプリで操作",
  "settings.roonBridgeOffDetail": "Roonを開始して、RoonアプリでTikpalを選びます。",
  "settings.roonBridgeOnDetail": "Roon待機中はTikpalの音声を一時停止します。",
  "settings.roonBridgeOff": "オフ",
  "settings.roonBridgeReady": "準備完了",
  "settings.roonBridgePlaying": "再生中",
  "settings.roonBridgeCheckSetup": "設定を確認",
  "settings.roonBridgeStart": "Roonを開始",
  "settings.roonBridgeStop": "Roonを停止",
  "settings.roonBridgeStartHint": "Tikpal音声を一時停止",
  "settings.roonBridgeStopHint": "Tikpal音声を復帰",
  "settings.mpdQuality": "MPDプロファイル",
  "settings.mpdQualityMeta": "Pure、Everyday、Sleep、Custom",
  "settings.standard": "標準",
  "settings.bitPerfect": "Bit-perfect",
  "settings.bitPerfectHint": "MPDを直接出力。ソフト音量とスペクトラムは制限されます。",
  "settings.volumeLocked": "MPD音量は固定し、出力レベルは調整できます。",
  "settings.volumeCapped": "Sleepでは音量を制限します。",
  "settings.audioProfile.pure": "Pure Listening",
  "settings.audioProfile.everyday": "Everyday",
  "settings.audioProfile.sleep": "Sleep / Meditation",
  "settings.audioProfile.custom": "カスタム",
  "settings.audioProfile.pureHint": "DACへ直接出力",
  "settings.audioProfile.everydayHint": "普段使いの再生",
  "settings.audioProfile.sleepHint": "穏やかで制限あり",
  "settings.audioProfile.customHint": "保存した設定",
  "settings.audioProfile.pureTraits": "Bit-perfect · DAC専有 · ReplayGainオフ",
  "settings.audioProfile.everydayTraits": "ReplayGain自動 · Crossfade 2秒 · Preloadオン",
  "settings.audioProfile.sleepTraits": "48 kHz · Crossfade 5秒 · 60分で停止",
  "settings.audioProfile.customTraits": "カスタムMPD出力 · Helper値",
  "settings.audioCustom.pureDirect": "Pure Direct",
  "settings.audioCustom.volumeNormalization": "音量ノーマライズ",
  "settings.audioCustom.smoothTransition": "なめらか切替",
  "settings.audioCustom.automaticSampleRate": "自動サンプルレート",
  "settings.audioCustom.dsdMode": "DSDモード",
  "settings.audioCustom.playbackStability": "再生安定性",
  "settings.audioCustom.pureDirectHint": "DACへ直接出力",
  "settings.audioCustom.volumeNormalizationHint": "曲ごとの音量を整える",
  "settings.audioCustom.smoothTransitionHint": "短いクロスフェード",
  "settings.audioCustom.automaticSampleRateHint": "曲に追従",
  "settings.audioCustom.dsdModeHint": "DSD DAC向けDoP",
  "settings.audioCustom.playbackStabilityHint": "安定したバッファ",
  "settings.audioCustom.warning": "高度な設定です。慎重に使用してください。",
  "settings.audioProfileApplied": "音声プロファイルを保存しました。",
  "settings.audioDiagnostics": "Audio Diagnostics",
  "settings.audioDiagnosticsHint": "Audio Output長押しで確認。",
  "settings.audioDiagnosticsTitleHint": "タイトル長押しで診断",
  "settings.audioDiagnosticsLoading": "音声診断を読み込み中...",
  "settings.audioDiagnosticsUnavailable": "診断を利用できません。",
  "settings.audioDiagnosticsProfile": "プロファイル",
  "settings.audioDiagnosticsUpdated": "更新",
  "settings.audioDiagnosticsMpd": "MPD",
  "settings.audioDiagnosticsAlsa": "ALSA",
  "settings.audioDiagnosticsOwner": "使用中",
  "settings.audioDiagnosticsState": "状態",
  "settings.audioDiagnosticsOutput": "出力",
  "settings.audioDiagnosticsDevice": "デバイス",
  "settings.audioDiagnosticsReplayGain": "ReplayGain",
  "settings.audioDiagnosticsCrossfade": "Crossfade",
  "settings.audioDiagnosticsFormat": "形式",
  "settings.audioDiagnosticsRate": "レート",
  "settings.audioDiagnosticsChannels": "チャンネル",
  "settings.audioDiagnosticsRaw": "Raw",
  "settings.audioDiagnosticsNoActiveStream": "再生中のストリームなし",
  "settings.audioDiagnosticsNoDacOwner": "DACの使用なし",
  "settings.audioDiagnosticsOwnerHint": "現在のALSAプロセス",
  "settings.mpdStandardNoteTitle": "普段の再生",
  "settings.mpdStandardNoteBody": "音量、スペクトラム、共有音声を使いやすく保ちます。",
  "settings.mpdBitPerfectNoteTitle": "直接出力",
  "settings.mpdBitPerfectNoteBody": "MPDの変換を避けたいローカル再生向けです。",
  "settings.roonBridgeNoteTitle": "Roonアプリで使用",
  "settings.roonBridgeNoteBody": "オンにするとTikpalがRoon endpointとして表示されます。",
  "settings.roonBridgeReleaseTitle": "音声の引き渡し",
  "settings.roonBridgeReleaseBody": "Roon開始でRadio/Libraryをすぐ停止。停止後に復帰します。"
});

Object.assign(dictionaries.es, {
  "source.roonbridge": "Roon Bridge",
  "source.lyrion": "Lyrion",
  "source.tikpal_multiroom": "Tikpal Multi-room",
  "source.music_assistant": "Music Assistant",
  "playback.playingFromRoon": "Reproduciendo desde Roon.",
  "playback.playingFromMultiroom": "Reproduciendo desde {label}.",
  "settings.multiroomAudio": "Audio multi-room",
  "settings.multiroomOffMeta": "Elige un sistema",
  "settings.multiroomReadyMeta": "Inicia desde la app",
  "settings.multiroomReadyCount": "{count} listo",
  "settings.multiroomPlaying": "Reproduciendo",
  "settings.multiroomReady": "Listo",
  "settings.multiroomStarting": "Iniciando",
  "settings.multiroomCheckSetup": "Revisar setup",
  "settings.multiroomComingSoon": "Próximamente",
  "settings.multiroomStart": "Iniciar {label}",
  "settings.multiroomStop": "Detener {label}",
  "settings.multiroomStartHint": "Pausa Tikpal ahora.",
  "settings.multiroomStopHint": "Restaura Tikpal.",
  "settings.multiroomActiveHint": "{label} usa el DAC.",
  "settings.multiroomComingSoonHint": "Reservado para una futura actualización.",
  "settings.multiroomReleaseBody": "Al iniciar, pausa Radio o Library. Al detener, Tikpal vuelve si no hay otro reproductor activo.",
  "settings.multiroom.ecosystem.roon": "Roon",
  "settings.multiroom.ecosystem.lyrion": "Lyrion",
  "settings.multiroom.ecosystem.tikpal": "Tikpal Multi-room",
  "settings.multiroom.ecosystem.music_assistant": "Music Assistant",
  "settings.multiroom.stack.roon": "Basado en: Roon Bridge / RAAT",
  "settings.multiroom.stack.lyrion": "Basado en: Squeezelite / LMS",
  "settings.multiroom.stack.tikpal": "Basado en: endpoint Snapcast",
  "settings.multiroom.stack.music_assistant": "Basado en: Music Assistant previsto",
  "settings.roonBridge": "Roon Bridge",
  "settings.roonBridgeMeta": "Inicia desde la app Roon",
  "settings.roonBridgeDetail": "Inicia la reproducción desde la app Roon.",
  "settings.roonBridgeOffMeta": "Listo para iniciar",
  "settings.roonBridgeOnMeta": "Usa la app Roon",
  "settings.roonBridgeOffDetail": "Inicia Roon y elige Tikpal en la app Roon.",
  "settings.roonBridgeOnDetail": "El audio de Tikpal se pausa mientras Roon está listo.",
  "settings.roonBridgeOff": "Off",
  "settings.roonBridgeReady": "Listo",
  "settings.roonBridgePlaying": "Reproduciendo",
  "settings.roonBridgeCheckSetup": "Revisar setup",
  "settings.roonBridgeStart": "Iniciar Roon",
  "settings.roonBridgeStop": "Detener Roon",
  "settings.roonBridgeStartHint": "Pausa audio Tikpal",
  "settings.roonBridgeStopHint": "Restaura audio Tikpal",
  "settings.mpdQuality": "Perfil MPD",
  "settings.mpdQualityMeta": "Pure, Everyday, Sleep o Custom",
  "settings.standard": "Standard",
  "settings.bitPerfect": "Bit-perfect",
  "settings.bitPerfectHint": "Salida MPD directa. Volumen software y espectro pueden limitarse.",
  "settings.volumeLocked": "El volumen MPD está bloqueado; la salida aún se ajusta.",
  "settings.volumeCapped": "Volumen limitado para Sleep.",
  "settings.audioProfile.pure": "Pure Listening",
  "settings.audioProfile.everyday": "Everyday",
  "settings.audioProfile.sleep": "Sleep / Meditation",
  "settings.audioProfile.custom": "Custom",
  "settings.audioProfile.pureHint": "Ruta directa al DAC",
  "settings.audioProfile.everydayHint": "Escucha diaria cómoda",
  "settings.audioProfile.sleepHint": "Suave y limitado",
  "settings.audioProfile.customHint": "Tu ajuste guardado",
  "settings.audioProfile.pureTraits": "Bit-perfect · DAC exclusivo · ReplayGain off",
  "settings.audioProfile.everydayTraits": "ReplayGain auto · Crossfade 2s · Preload on",
  "settings.audioProfile.sleepTraits": "48 kHz · Crossfade 5s · Se detiene en 60 min",
  "settings.audioProfile.customTraits": "Salida MPD custom · Valores helper",
  "settings.audioCustom.pureDirect": "Pure Direct",
  "settings.audioCustom.volumeNormalization": "Normalización de volumen",
  "settings.audioCustom.smoothTransition": "Transición suave",
  "settings.audioCustom.automaticSampleRate": "Frecuencia automática",
  "settings.audioCustom.dsdMode": "Modo DSD",
  "settings.audioCustom.playbackStability": "Estabilidad",
  "settings.audioCustom.pureDirectHint": "Salida directa al DAC",
  "settings.audioCustom.volumeNormalizationHint": "Equilibra el volumen",
  "settings.audioCustom.smoothTransitionHint": "Crossfade suave",
  "settings.audioCustom.automaticSampleRateHint": "Sigue cada pista",
  "settings.audioCustom.dsdModeHint": "DoP para DAC DSD",
  "settings.audioCustom.playbackStabilityHint": "Buffer más seguro",
  "settings.audioCustom.warning": "Controles avanzados. Úsalos con cuidado.",
  "settings.audioProfileApplied": "Perfil de audio guardado.",
  "settings.audioDiagnostics": "Audio Diagnostics",
  "settings.audioDiagnosticsHint": "Mantén Audio Output para inspeccionar.",
  "settings.audioDiagnosticsTitleHint": "Mantén el título para diagnóstico",
  "settings.audioDiagnosticsLoading": "Leyendo diagnóstico de audio...",
  "settings.audioDiagnosticsUnavailable": "Diagnóstico no disponible.",
  "settings.audioDiagnosticsProfile": "Perfil",
  "settings.audioDiagnosticsUpdated": "Actualizado",
  "settings.audioDiagnosticsMpd": "MPD",
  "settings.audioDiagnosticsAlsa": "ALSA",
  "settings.audioDiagnosticsOwner": "Uso",
  "settings.audioDiagnosticsState": "Estado",
  "settings.audioDiagnosticsOutput": "Salida",
  "settings.audioDiagnosticsDevice": "Dispositivo",
  "settings.audioDiagnosticsReplayGain": "ReplayGain",
  "settings.audioDiagnosticsCrossfade": "Crossfade",
  "settings.audioDiagnosticsFormat": "Formato",
  "settings.audioDiagnosticsRate": "Rate",
  "settings.audioDiagnosticsChannels": "Canales",
  "settings.audioDiagnosticsRaw": "Raw",
  "settings.audioDiagnosticsNoActiveStream": "Sin stream activo",
  "settings.audioDiagnosticsNoDacOwner": "Sin dueño del DAC",
  "settings.audioDiagnosticsOwnerHint": "Proceso ALSA actual",
  "settings.mpdStandardNoteTitle": "Escucha diaria",
  "settings.mpdStandardNoteBody": "Mantiene volumen, espectro y audio compartido cómodos.",
  "settings.mpdBitPerfectNoteTitle": "Salida directa",
  "settings.mpdBitPerfectNoteBody": "Para archivos locales cuando quieres evitar conversión MPD.",
  "settings.roonBridgeNoteTitle": "Usa la app Roon",
  "settings.roonBridgeNoteBody": "Tikpal aparece como endpoint Roon cuando está activo.",
  "settings.roonBridgeReleaseTitle": "Entrega de audio",
  "settings.roonBridgeReleaseBody": "Iniciar Roon pausa Radio o Library ahora. Detenerlo restaura."
});

Object.assign(dictionaries.en, {
  "settings.touchToWake": "Touch to wake",
  "settings.chooseAudioProfile": "Choose listening style",
  "settings.chooseFont": "Choose a display font",
  "settings.chooseSkin": "Choose the surface",
  "settings.chooseLyrics": "Tune lyric view",
  "settings.openAudioOutput": "Open audio settings",
  "settings.openFont": "Open font settings",
  "settings.openSkin": "Open skin settings",
  "settings.openLyrics": "Open lyric settings",
  "settings.manageRooms": "Manage rooms",
  "settings.audioDiagnosticsChip": "Advanced info",
  "settings.multiroomWaitingHint": "Waiting for app playback.",
  "settings.multiroomReadyToStartHint": "Start when you want this room available.",
  "nas.checkSetupNext": "Check server, then tap Mount."
});

Object.assign(dictionaries["zh-CN"], {
  "settings.touchToWake": "轻触唤醒",
  "settings.chooseAudioProfile": "选择听音方式",
  "settings.chooseFont": "选择显示字体",
  "settings.chooseSkin": "选择界面质感",
  "settings.chooseLyrics": "调整歌词显示",
  "settings.openAudioOutput": "打开音频设置",
  "settings.openFont": "打开字体设置",
  "settings.openSkin": "打开皮肤设置",
  "settings.openLyrics": "打开歌词设置",
  "settings.manageRooms": "管理多房间",
  "settings.audioDiagnosticsChip": "高级信息",
  "settings.multiroomWaitingHint": "等待 App 开始播放。",
  "settings.multiroomReadyToStartHint": "需要这个房间时再启动。",
  "nas.checkSetupNext": "检查服务器，然后点 Mount。"
});

Object.assign(dictionaries.de, {
  "settings.touchToWake": "Zum Aufwecken berühren",
  "settings.chooseAudioProfile": "Hörprofil wählen",
  "settings.chooseFont": "Schrift wählen",
  "settings.chooseSkin": "Oberfläche wählen",
  "settings.chooseLyrics": "Lyrics anpassen",
  "settings.openAudioOutput": "Audio öffnen",
  "settings.openFont": "Schrift öffnen",
  "settings.openSkin": "Design öffnen",
  "settings.openLyrics": "Lyrics öffnen",
  "settings.manageRooms": "Räume verwalten",
  "settings.audioDiagnosticsChip": "Erweiterte Info",
  "settings.multiroomWaitingHint": "Wartet auf App-Wiedergabe.",
  "settings.multiroomReadyToStartHint": "Starten, wenn dieser Raum bereit sein soll.",
  "nas.checkSetupNext": "Server prüfen, dann Mount tippen."
});

Object.assign(dictionaries.it, {
  "settings.touchToWake": "Tocca per riattivare",
  "settings.chooseAudioProfile": "Scegli stile di ascolto",
  "settings.chooseFont": "Scegli font",
  "settings.chooseSkin": "Scegli superficie",
  "settings.chooseLyrics": "Regola testi",
  "settings.openAudioOutput": "Apri audio",
  "settings.openFont": "Apri font",
  "settings.openSkin": "Apri tema",
  "settings.openLyrics": "Apri testi",
  "settings.manageRooms": "Gestisci stanze",
  "settings.audioDiagnosticsChip": "Info avanzate",
  "settings.multiroomWaitingHint": "In attesa della riproduzione dall'app.",
  "settings.multiroomReadyToStartHint": "Avvia quando vuoi usare questa stanza.",
  "nas.checkSetupNext": "Controlla il server, poi tocca Mount."
});

Object.assign(dictionaries.ko, {
  "settings.touchToWake": "터치하여 깨우기",
  "settings.chooseAudioProfile": "청취 스타일 선택",
  "settings.chooseFont": "표시 글꼴 선택",
  "settings.chooseSkin": "화면 스킨 선택",
  "settings.chooseLyrics": "가사 보기 조정",
  "settings.openAudioOutput": "오디오 설정 열기",
  "settings.openFont": "글꼴 설정 열기",
  "settings.openSkin": "스킨 설정 열기",
  "settings.openLyrics": "가사 설정 열기",
  "settings.manageRooms": "룸 관리",
  "settings.audioDiagnosticsChip": "고급 정보",
  "settings.multiroomWaitingHint": "앱 재생을 기다리는 중.",
  "settings.multiroomReadyToStartHint": "이 룸을 사용할 때 시작하세요.",
  "nas.checkSetupNext": "서버를 확인한 뒤 Mount를 누르세요."
});

Object.assign(dictionaries.ja, {
  "settings.touchToWake": "タッチで復帰",
  "settings.chooseAudioProfile": "聴き方を選択",
  "settings.chooseFont": "表示フォントを選択",
  "settings.chooseSkin": "表示スキンを選択",
  "settings.chooseLyrics": "歌詞表示を調整",
  "settings.openAudioOutput": "音声設定を開く",
  "settings.openFont": "フォント設定を開く",
  "settings.openSkin": "スキン設定を開く",
  "settings.openLyrics": "歌詞設定を開く",
  "settings.manageRooms": "ルーム管理",
  "settings.audioDiagnosticsChip": "詳細情報",
  "settings.multiroomWaitingHint": "アプリ再生を待っています。",
  "settings.multiroomReadyToStartHint": "この部屋を使う時に開始。",
  "nas.checkSetupNext": "サーバー確認後、Mountをタップ。"
});

Object.assign(dictionaries.es, {
  "settings.touchToWake": "Toca para despertar",
  "settings.chooseAudioProfile": "Elige estilo de escucha",
  "settings.chooseFont": "Elige fuente",
  "settings.chooseSkin": "Elige tema",
  "settings.chooseLyrics": "Ajusta letras",
  "settings.openAudioOutput": "Abrir audio",
  "settings.openFont": "Abrir fuente",
  "settings.openSkin": "Abrir tema",
  "settings.openLyrics": "Abrir letras",
  "settings.manageRooms": "Gestionar salas",
  "settings.audioDiagnosticsChip": "Info avanzada",
  "settings.multiroomWaitingHint": "Esperando reproducción desde la app.",
  "settings.multiroomReadyToStartHint": "Inicia cuando quieras usar esta sala.",
  "nas.checkSetupNext": "Revisa el servidor y toca Mount."
});

Object.assign(dictionaries.en, {
  "scene.clock.withContext": "{context} {mode} {dayPart}",
  "scene.clock.withoutContext": "{mode} {dayPart}",
  "scene.dayPart.morning": "morning",
  "scene.dayPart.afternoon": "afternoon",
  "scene.dayPart.evening": "evening",
  "scene.dayPart.night": "night",
  "scene.mode.focus": "focused",
  "scene.mode.calm": "calm",
  "scene.mode.sleep": "quiet",
  "scene.mode.hifi": "Hi-Fi listening",
  "scene.weather.clear": "Clear",
  "scene.weather.cloudy": "Cloudy",
  "scene.weather.foggy": "Foggy",
  "scene.weather.rainy": "Rainy",
  "scene.weather.snowy": "Snowy",
  "scene.weather.stormy": "Stormy"
});

Object.assign(dictionaries["zh-CN"], {
  "scene.clock.withContext": "{context} · {mode} · {dayPart}",
  "scene.clock.withoutContext": "{mode} · {dayPart}",
  "scene.dayPart.morning": "早晨",
  "scene.dayPart.afternoon": "午后",
  "scene.dayPart.evening": "傍晚",
  "scene.dayPart.night": "夜间",
  "scene.mode.focus": "专注",
  "scene.mode.calm": "放松",
  "scene.mode.sleep": "安静",
  "scene.mode.hifi": "Hi-Fi 聆听",
  "scene.weather.clear": "晴天",
  "scene.weather.cloudy": "多云",
  "scene.weather.foggy": "雾天",
  "scene.weather.rainy": "雨天",
  "scene.weather.snowy": "雪天",
  "scene.weather.stormy": "雷雨"
});

Object.assign(dictionaries.de, {
  "scene.clock.withContext": "{context} · {mode} · {dayPart}",
  "scene.clock.withoutContext": "{mode} · {dayPart}",
  "scene.dayPart.morning": "Morgen",
  "scene.dayPart.afternoon": "Nachmittag",
  "scene.dayPart.evening": "Abend",
  "scene.dayPart.night": "Nacht",
  "scene.mode.focus": "Fokus",
  "scene.mode.calm": "ruhig",
  "scene.mode.sleep": "leise",
  "scene.mode.hifi": "Hi-Fi",
  "scene.weather.clear": "Klar",
  "scene.weather.cloudy": "Bewölkt",
  "scene.weather.foggy": "Neblig",
  "scene.weather.rainy": "Regnerisch",
  "scene.weather.snowy": "Schnee",
  "scene.weather.stormy": "Stürmisch"
});

Object.assign(dictionaries.it, {
  "scene.clock.withContext": "{context} · {mode} · {dayPart}",
  "scene.clock.withoutContext": "{mode} · {dayPart}",
  "scene.dayPart.morning": "mattina",
  "scene.dayPart.afternoon": "pomeriggio",
  "scene.dayPart.evening": "sera",
  "scene.dayPart.night": "notte",
  "scene.mode.focus": "focus",
  "scene.mode.calm": "calma",
  "scene.mode.sleep": "quieto",
  "scene.mode.hifi": "Hi-Fi",
  "scene.weather.clear": "Sereno",
  "scene.weather.cloudy": "Nuvoloso",
  "scene.weather.foggy": "Nebbia",
  "scene.weather.rainy": "Pioggia",
  "scene.weather.snowy": "Neve",
  "scene.weather.stormy": "Temporale"
});

Object.assign(dictionaries.ko, {
  "scene.clock.withContext": "{context} · {mode} · {dayPart}",
  "scene.clock.withoutContext": "{mode} · {dayPart}",
  "scene.dayPart.morning": "아침",
  "scene.dayPart.afternoon": "오후",
  "scene.dayPart.evening": "저녁",
  "scene.dayPart.night": "밤",
  "scene.mode.focus": "집중",
  "scene.mode.calm": "휴식",
  "scene.mode.sleep": "고요한",
  "scene.mode.hifi": "Hi-Fi",
  "scene.weather.clear": "맑음",
  "scene.weather.cloudy": "흐림",
  "scene.weather.foggy": "안개",
  "scene.weather.rainy": "비",
  "scene.weather.snowy": "눈",
  "scene.weather.stormy": "폭풍"
});

Object.assign(dictionaries.ja, {
  "scene.clock.withContext": "{context} · {mode} · {dayPart}",
  "scene.clock.withoutContext": "{mode} · {dayPart}",
  "scene.dayPart.morning": "朝",
  "scene.dayPart.afternoon": "午後",
  "scene.dayPart.evening": "夕方",
  "scene.dayPart.night": "夜",
  "scene.mode.focus": "集中",
  "scene.mode.calm": "リラックス",
  "scene.mode.sleep": "静か",
  "scene.mode.hifi": "Hi-Fi",
  "scene.weather.clear": "晴れ",
  "scene.weather.cloudy": "曇り",
  "scene.weather.foggy": "霧",
  "scene.weather.rainy": "雨",
  "scene.weather.snowy": "雪",
  "scene.weather.stormy": "嵐"
});

Object.assign(dictionaries.es, {
  "scene.clock.withContext": "{context} · {mode} · {dayPart}",
  "scene.clock.withoutContext": "{mode} · {dayPart}",
  "scene.dayPart.morning": "mañana",
  "scene.dayPart.afternoon": "tarde",
  "scene.dayPart.evening": "atardecer",
  "scene.dayPart.night": "noche",
  "scene.mode.focus": "focus",
  "scene.mode.calm": "calma",
  "scene.mode.sleep": "tranquilo",
  "scene.mode.hifi": "Hi-Fi",
  "scene.weather.clear": "Despejado",
  "scene.weather.cloudy": "Nublado",
  "scene.weather.foggy": "Niebla",
  "scene.weather.rainy": "Lluvia",
  "scene.weather.snowy": "Nieve",
  "scene.weather.stormy": "Tormenta"
});

Object.assign(dictionaries.en, {
  "onboarding.ariaLabel": "Startup guide",
  "onboarding.title": "Welcome to Tikpal",
  "onboarding.subtitle": "Three quick gestures before you listen.",
  "onboarding.step1Title": "Tap once to show controls",
  "onboarding.step1Body": "In Ambient, one tap brings controls back without leaving the room view.",
  "onboarding.step1Note": "Use it for a quick check.",
  "onboarding.step2Title": "Slide the edges",
  "onboarding.step2Body": "Left edge controls brightness. Right edge controls volume.",
  "onboarding.step2Note": "Move slowly; Tikpal follows your finger.",
  "onboarding.step3Title": "Swipe down or hold",
  "onboarding.step3Body": "Swipe down for Player. Long press for Quick Menu.",
  "onboarding.step3Note": "Ambient is always your safe home view.",
  "onboarding.previewControls": "Preview",
  "onboarding.hideBackground": "Hide background",
  "onboarding.showBackground": "Show background",
  "onboarding.muteSound": "Mute sound",
  "onboarding.restoreSound": "Restore sound",
  "onboarding.practicePrompt": "Try the gesture in the sample",
  "onboarding.practiceSuccess": "Gesture recognized",
  "onboarding.footer": "This preview will not change your source or room mode.",
  "onboarding.scopeNote": "Gestures work on the room screen. Web players use their own controls.",
  "onboarding.previous": "Previous",
  "onboarding.next": "Next",
  "onboarding.getStarted": "Finish",
  "onboarding.sampleAria": "Practice this gesture",
  "onboarding.sampleTrack": "Warm room · Ambient",
  "onboarding.sampleBrightness": "Brightness",
  "onboarding.sampleVolume": "Volume",
  "onboarding.samplePlayer": "Player",
  "onboarding.sampleTry": "Try it here"
});

Object.assign(dictionaries["zh-CN"], {
  "onboarding.ariaLabel": "开机引导",
  "onboarding.title": "欢迎使用 Tikpal",
  "onboarding.subtitle": "先练三个手势，再开始听音乐。",
  "onboarding.step1Title": "轻点显示控制",
  "onboarding.step1Body": "在 Ambient 页面轻点一下，控制层会柔和出现。",
  "onboarding.step1Note": "想快速看一眼状态时用这个手势。",
  "onboarding.step2Title": "滑动左右边缘",
  "onboarding.step2Body": "左侧调节亮度，右侧调节音量。",
  "onboarding.step2Note": "慢慢滑动，数值会跟随手指变化。",
  "onboarding.step3Title": "下滑或长按",
  "onboarding.step3Body": "下滑进入 Player，长按打开 Quick Menu。",
  "onboarding.step3Note": "Ambient 始终是安全的主界面。",
  "onboarding.previewControls": "预览",
  "onboarding.hideBackground": "隐藏背景",
  "onboarding.showBackground": "显示背景",
  "onboarding.muteSound": "静音场景声",
  "onboarding.restoreSound": "恢复场景声",
  "onboarding.practicePrompt": "在示例里试一下",
  "onboarding.practiceSuccess": "手势已识别",
  "onboarding.footer": "这只是预览，不会改变音源或房间模式。",
  "onboarding.scopeNote": "这些手势用于房间主界面。网页播放器使用自己的控件。",
  "onboarding.previous": "上一步",
  "onboarding.next": "下一步",
  "onboarding.getStarted": "完成",
  "onboarding.sampleAria": "练习这个手势",
  "onboarding.sampleTrack": "温暖房间 · Ambient",
  "onboarding.sampleBrightness": "亮度",
  "onboarding.sampleVolume": "音量",
  "onboarding.samplePlayer": "Player",
  "onboarding.sampleTry": "在这里试"
});

Object.assign(dictionaries.de, {
  "onboarding.ariaLabel": "Startanleitung",
  "onboarding.title": "Willkommen bei Tikpal",
  "onboarding.subtitle": "Drei kurze Gesten, bevor die Musik beginnt.",
  "onboarding.step1Title": "Einmal tippen zeigt Steuerung",
  "onboarding.step1Body": "In Ambient bringt ein Tipp die Steuerung zurück, ohne die Raumansicht zu verlassen.",
  "onboarding.step1Note": "Gut für einen schnellen Blick.",
  "onboarding.step2Title": "Ränder als Regler nutzen",
  "onboarding.step2Body": "Links regelt Helligkeit. Rechts regelt Lautstärke.",
  "onboarding.step2Note": "Langsam ziehen; Tikpal folgt deinem Finger.",
  "onboarding.step3Title": "Wischen oder halten",
  "onboarding.step3Body": "Nach unten für Player. Lang drücken für Quick Menu.",
  "onboarding.step3Note": "Ambient bleibt deine sichere Startansicht.",
  "onboarding.previewControls": "Vorschau",
  "onboarding.hideBackground": "Hintergrund aus",
  "onboarding.showBackground": "Hintergrund an",
  "onboarding.muteSound": "Sound stumm",
  "onboarding.restoreSound": "Sound zurück",
  "onboarding.practicePrompt": "Geste im Beispiel testen",
  "onboarding.practiceSuccess": "Geste erkannt",
  "onboarding.footer": "Diese Vorschau ändert weder Quelle noch Raummodus.",
  "onboarding.scopeNote": "Gesten gelten für die Raumansicht. Webplayer nutzen eigene Steuerung.",
  "onboarding.previous": "Zurück",
  "onboarding.next": "Weiter",
  "onboarding.getStarted": "Fertig",
  "onboarding.sampleAria": "Diese Geste üben",
  "onboarding.sampleTrack": "Warmer Raum · Ambient",
  "onboarding.sampleBrightness": "Helligkeit",
  "onboarding.sampleVolume": "Lautstärke",
  "onboarding.samplePlayer": "Player",
  "onboarding.sampleTry": "Hier testen"
});

Object.assign(dictionaries.it, {
  "onboarding.ariaLabel": "Guida iniziale",
  "onboarding.title": "Benvenuto in Tikpal",
  "onboarding.subtitle": "Tre gesti rapidi prima di ascoltare.",
  "onboarding.step1Title": "Tocca per mostrare i controlli",
  "onboarding.step1Body": "In Ambient, un tocco riporta i controlli senza lasciare la vista stanza.",
  "onboarding.step1Note": "Usalo per un controllo veloce.",
  "onboarding.step2Title": "Usa i bordi come slider",
  "onboarding.step2Body": "Il bordo sinistro regola la luminosità. Il destro regola il volume.",
  "onboarding.step2Note": "Muovi lentamente; Tikpal segue il dito.",
  "onboarding.step3Title": "Scorri o tieni premuto",
  "onboarding.step3Body": "Scorri in basso per Player. Tieni premuto per Quick Menu.",
  "onboarding.step3Note": "Ambient resta la vista di casa.",
  "onboarding.previewControls": "Anteprima",
  "onboarding.hideBackground": "Nascondi sfondo",
  "onboarding.showBackground": "Mostra sfondo",
  "onboarding.muteSound": "Muta audio scena",
  "onboarding.restoreSound": "Ripristina audio",
  "onboarding.practicePrompt": "Prova il gesto nel campione",
  "onboarding.practiceSuccess": "Gesto riconosciuto",
  "onboarding.footer": "Questa anteprima non cambia fonte o modalità stanza.",
  "onboarding.scopeNote": "I gesti funzionano nella schermata stanza. I web player usano i propri controlli.",
  "onboarding.previous": "Indietro",
  "onboarding.next": "Avanti",
  "onboarding.getStarted": "Fine",
  "onboarding.sampleAria": "Esercita questo gesto",
  "onboarding.sampleTrack": "Stanza calda · Ambient",
  "onboarding.sampleBrightness": "Luminosità",
  "onboarding.sampleVolume": "Volume",
  "onboarding.samplePlayer": "Player",
  "onboarding.sampleTry": "Prova qui"
});

Object.assign(dictionaries.ko, {
  "onboarding.ariaLabel": "시작 안내",
  "onboarding.title": "Tikpal에 오신 것을 환영합니다",
  "onboarding.subtitle": "음악을 듣기 전 세 가지 손동작만 익혀보세요.",
  "onboarding.step1Title": "한 번 탭하면 제어가 보여요",
  "onboarding.step1Body": "Ambient에서 한 번 탭하면 화면을 떠나지 않고 제어가 다시 나타납니다.",
  "onboarding.step1Note": "상태만 빠르게 확인할 때 좋습니다.",
  "onboarding.step2Title": "양쪽 가장자리를 밀기",
  "onboarding.step2Body": "왼쪽은 밝기, 오른쪽은 볼륨을 조절합니다.",
  "onboarding.step2Note": "천천히 움직이면 Tikpal이 손가락을 따라갑니다.",
  "onboarding.step3Title": "아래로 쓸거나 길게 누르기",
  "onboarding.step3Body": "아래로 쓸면 Player, 길게 누르면 Quick Menu가 열립니다.",
  "onboarding.step3Note": "Ambient는 언제나 안전한 홈 화면입니다.",
  "onboarding.previewControls": "미리보기",
  "onboarding.hideBackground": "배경 숨기기",
  "onboarding.showBackground": "배경 보이기",
  "onboarding.muteSound": "장면음 끄기",
  "onboarding.restoreSound": "장면음 켜기",
  "onboarding.practicePrompt": "샘플에서 손동작을 해보세요",
  "onboarding.practiceSuccess": "손동작을 인식했습니다",
  "onboarding.footer": "이 미리보기는 소스나 룸 모드를 바꾸지 않습니다.",
  "onboarding.scopeNote": "손동작은 룸 화면에서 동작합니다. 웹 플레이어는 자체 컨트롤을 사용합니다.",
  "onboarding.previous": "이전",
  "onboarding.next": "다음",
  "onboarding.getStarted": "완료",
  "onboarding.sampleAria": "이 손동작 연습",
  "onboarding.sampleTrack": "따뜻한 방 · Ambient",
  "onboarding.sampleBrightness": "밝기",
  "onboarding.sampleVolume": "볼륨",
  "onboarding.samplePlayer": "Player",
  "onboarding.sampleTry": "여기서 연습"
});

Object.assign(dictionaries.ja, {
  "onboarding.ariaLabel": "起動ガイド",
  "onboarding.title": "Tikpalへようこそ",
  "onboarding.subtitle": "音楽を聴く前に、3つのジェスチャーだけ確認しましょう。",
  "onboarding.step1Title": "一度タップして操作を表示",
  "onboarding.step1Body": "Ambientで一度タップすると、画面を離れずに操作が戻ります。",
  "onboarding.step1Note": "状態をすばやく確認したい時に使います。",
  "onboarding.step2Title": "左右の端をスライド",
  "onboarding.step2Body": "左端は明るさ、右端は音量を調整します。",
  "onboarding.step2Note": "ゆっくり動かすと、Tikpalが指に合わせます。",
  "onboarding.step3Title": "下へスワイプ、または長押し",
  "onboarding.step3Body": "下へスワイプでPlayer。長押しでQuick Menu。",
  "onboarding.step3Note": "Ambientはいつでも安全なホームです。",
  "onboarding.previewControls": "プレビュー",
  "onboarding.hideBackground": "背景を隠す",
  "onboarding.showBackground": "背景を表示",
  "onboarding.muteSound": "シーン音をミュート",
  "onboarding.restoreSound": "シーン音を戻す",
  "onboarding.practicePrompt": "サンプルで試してください",
  "onboarding.practiceSuccess": "ジェスチャーを認識しました",
  "onboarding.footer": "このプレビューは音源やルームモードを変更しません。",
  "onboarding.scopeNote": "ジェスチャーはルーム画面で使います。Webプレイヤーは独自の操作を使います。",
  "onboarding.previous": "前へ",
  "onboarding.next": "次へ",
  "onboarding.getStarted": "完了",
  "onboarding.sampleAria": "このジェスチャーを練習",
  "onboarding.sampleTrack": "暖かい部屋 · Ambient",
  "onboarding.sampleBrightness": "明るさ",
  "onboarding.sampleVolume": "音量",
  "onboarding.samplePlayer": "Player",
  "onboarding.sampleTry": "ここで試す"
});

Object.assign(dictionaries.es, {
  "onboarding.ariaLabel": "Guía de inicio",
  "onboarding.title": "Bienvenido a Tikpal",
  "onboarding.subtitle": "Tres gestos rápidos antes de escuchar.",
  "onboarding.step1Title": "Toca una vez para ver controles",
  "onboarding.step1Body": "En Ambient, un toque trae los controles sin salir de la vista de sala.",
  "onboarding.step1Note": "Úsalo para una revisión rápida.",
  "onboarding.step2Title": "Desliza los bordes",
  "onboarding.step2Body": "El borde izquierdo cambia brillo. El derecho cambia volumen.",
  "onboarding.step2Note": "Muévete lento; Tikpal sigue tu dedo.",
  "onboarding.step3Title": "Desliza abajo o mantén",
  "onboarding.step3Body": "Desliza abajo para Player. Mantén pulsado para Quick Menu.",
  "onboarding.step3Note": "Ambient siempre es tu pantalla segura.",
  "onboarding.previewControls": "Vista previa",
  "onboarding.hideBackground": "Ocultar fondo",
  "onboarding.showBackground": "Mostrar fondo",
  "onboarding.muteSound": "Silenciar escena",
  "onboarding.restoreSound": "Restaurar escena",
  "onboarding.practicePrompt": "Prueba el gesto en la muestra",
  "onboarding.practiceSuccess": "Gesto reconocido",
  "onboarding.footer": "Esta vista previa no cambia fuente ni modo de sala.",
  "onboarding.scopeNote": "Los gestos funcionan en la pantalla de sala. Los web players usan sus propios controles.",
  "onboarding.previous": "Anterior",
  "onboarding.next": "Siguiente",
  "onboarding.getStarted": "Terminar",
  "onboarding.sampleAria": "Practicar este gesto",
  "onboarding.sampleTrack": "Sala cálida · Ambient",
  "onboarding.sampleBrightness": "Brillo",
  "onboarding.sampleVolume": "Volumen",
  "onboarding.samplePlayer": "Player",
  "onboarding.sampleTry": "Prueba aquí"
});

Object.assign(dictionaries.en, {
  "hifi.tapForMusicControls": "Tap for music controls"
});

Object.assign(dictionaries["zh-CN"], {
  "hifi.tapForMusicControls": "轻触选择播放"
});

Object.assign(dictionaries.de, {
  "hifi.tapForMusicControls": "Tippen für Musiksteuerung"
});

Object.assign(dictionaries.it, {
  "hifi.tapForMusicControls": "Tocca per controlli musica"
});

Object.assign(dictionaries.ko, {
  "hifi.tapForMusicControls": "음악 제어 열기"
});

Object.assign(dictionaries.ja, {
  "hifi.tapForMusicControls": "タップで音楽操作"
});

Object.assign(dictionaries.es, {
  "hifi.tapForMusicControls": "Toca para controles"
});

Object.assign(dictionaries.en, {
  "settings.exploreHelp": "Proxy URL saves automatically. Switching Proxy On/Off needs confirmation and a system restart.",
  "settings.proxyRestartConfirmTitle": "Confirm proxy setting",
  "settings.proxyRestartConfirmBody": "Switch to {state}? Confirm only if this setting is correct. The system will restart to apply it.",
  "settings.proxyRestartConfirmAction": "Confirm & restart",
  "settings.proxyRestarting": "Setting saved. Restarting system...",
  "settings.proxyRestartSavedManual": "Setting saved. Restart the system manually to apply it."
});

Object.assign(dictionaries["zh-CN"], {
  "settings.exploreHelp": "代理 URL 会自动保存。切换代理开关需确认并重启系统后生效。",
  "settings.proxyRestartConfirmTitle": "确认代理设置",
  "settings.proxyRestartConfirmBody": "将切换为 {state}。请确认设置正确；系统将重启以应用此设置。",
  "settings.proxyRestartConfirmAction": "确认并重启",
  "settings.proxyRestarting": "设置已保存，系统正在重启…",
  "settings.proxyRestartSavedManual": "设置已保存，请从系统设置手动重启后生效。"
});

Object.assign(dictionaries.de, {
  "settings.exploreHelp": "Die Proxy-URL wird automatisch gespeichert. Proxy An/Aus erfordert Bestätigung und einen Systemneustart.",
  "settings.proxyRestartConfirmTitle": "Proxy-Einstellung bestätigen",
  "settings.proxyRestartConfirmBody": "Zu {state} wechseln? Nur bestätigen, wenn diese Einstellung korrekt ist. Das System startet zum Anwenden neu.",
  "settings.proxyRestartConfirmAction": "Bestätigen & neu starten",
  "settings.proxyRestarting": "Einstellung gespeichert. System wird neu gestartet...",
  "settings.proxyRestartSavedManual": "Einstellung gespeichert. System zum Anwenden manuell neu starten."
});

Object.assign(dictionaries.it, {
  "settings.exploreHelp": "L'URL proxy viene salvato automaticamente. Proxy On/Off richiede conferma e riavvio del sistema.",
  "settings.proxyRestartConfirmTitle": "Conferma impostazione proxy",
  "settings.proxyRestartConfirmBody": "Passare a {state}? Conferma solo se questa impostazione è corretta. Il sistema si riavvierà per applicarla.",
  "settings.proxyRestartConfirmAction": "Conferma e riavvia",
  "settings.proxyRestarting": "Impostazione salvata. Riavvio del sistema...",
  "settings.proxyRestartSavedManual": "Impostazione salvata. Riavvia manualmente il sistema per applicarla."
});

Object.assign(dictionaries.ko, {
  "settings.exploreHelp": "프록시 URL은 자동 저장됩니다. 프록시 켜기/끄기는 확인 후 시스템을 재시작해야 적용됩니다.",
  "settings.proxyRestartConfirmTitle": "프록시 설정 확인",
  "settings.proxyRestartConfirmBody": "{state}(으)로 전환할까요? 설정이 올바른 경우에만 확인하세요. 적용하려면 시스템이 재시작됩니다.",
  "settings.proxyRestartConfirmAction": "확인 후 재시작",
  "settings.proxyRestarting": "설정이 저장되었습니다. 시스템을 재시작하는 중...",
  "settings.proxyRestartSavedManual": "설정이 저장되었습니다. 적용하려면 시스템을 수동으로 재시작하세요."
});

Object.assign(dictionaries.ja, {
  "settings.exploreHelp": "プロキシURLは自動保存されます。プロキシのオン/オフには確認とシステム再起動が必要です。",
  "settings.proxyRestartConfirmTitle": "プロキシ設定を確認",
  "settings.proxyRestartConfirmBody": "{state} に切り替えますか？設定が正しい場合のみ確認してください。適用するためシステムを再起動します。",
  "settings.proxyRestartConfirmAction": "確認して再起動",
  "settings.proxyRestarting": "設定を保存しました。システムを再起動しています...",
  "settings.proxyRestartSavedManual": "設定を保存しました。適用するにはシステムを手動で再起動してください。"
});

Object.assign(dictionaries.es, {
  "settings.exploreHelp": "La URL del proxy se guarda automáticamente. Activar o desactivar Proxy requiere confirmación y reiniciar el sistema.",
  "settings.proxyRestartConfirmTitle": "Confirmar ajuste de proxy",
  "settings.proxyRestartConfirmBody": "¿Cambiar a {state}? Confirma solo si este ajuste es correcto. El sistema se reiniciará para aplicarlo.",
  "settings.proxyRestartConfirmAction": "Confirmar y reiniciar",
  "settings.proxyRestarting": "Ajuste guardado. Reiniciando el sistema...",
  "settings.proxyRestartSavedManual": "Ajuste guardado. Reinicia el sistema manualmente para aplicarlo."
});

function template(value: string, params: TranslationParams = {}) {
  return value.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const replacement = params[key];
    return replacement === null || replacement === undefined ? "" : String(replacement);
  });
}

function translate(locale: UiLocale, key: string, params?: TranslationParams) {
  return template(dictionaries[locale][key] ?? dictionaries.en[key] ?? key, params);
}

export function localeFromValue(value: unknown): UiLocale {
  const candidate = String(value ?? "").trim();
  return languageOptions.some((option) => option.locale === candidate) ? candidate as UiLocale : "en";
}

function readStoredLocale(): UiLocale | null {
  const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (storedLocale === null) return null;
  const locale = localeFromValue(storedLocale);
  return languageOptions.some((option) => option.locale === storedLocale) ? locale : null;
}

function audioProfileFromMpdMode(mode: unknown): AudioOutputProfile {
  return String(mode ?? "").trim().toLowerCase() === "strict" ? "pure" : "everyday";
}

function mpdModeFromAudioProfile(profile: AudioOutputProfile): MpdBitPerfectMode {
  return profile === "pure" ? "strict" : "standard";
}

function normalizeAudioOutputCustomSettings(value: Partial<AudioOutputCustomSettings> | null | undefined): AudioOutputCustomSettings {
  return {
    pureDirect: value?.pureDirect === undefined ? defaultPreferences.audioOutputCustomSettings.pureDirect : value.pureDirect === true,
    volumeNormalization: value?.volumeNormalization === undefined ? defaultPreferences.audioOutputCustomSettings.volumeNormalization : value.volumeNormalization === true,
    smoothTransition: value?.smoothTransition === undefined ? defaultPreferences.audioOutputCustomSettings.smoothTransition : value.smoothTransition === true,
    automaticSampleRate: value?.automaticSampleRate === undefined ? defaultPreferences.audioOutputCustomSettings.automaticSampleRate : value.automaticSampleRate === true,
    dsdMode: value?.dsdMode === undefined ? defaultPreferences.audioOutputCustomSettings.dsdMode : value.dsdMode === true,
    playbackStability: value?.playbackStability === undefined ? defaultPreferences.audioOutputCustomSettings.playbackStability : value.playbackStability === true
  };
}

function normalizePreferences(value: UiPreferences): UiPreferences {
  const locale = localeFromValue(value?.locale);
  const fontTheme = String(value?.fontTheme ?? "").trim() as FontTheme;
  const rawAudioProfile = String(value?.audioOutputProfile ?? "").trim().toLowerCase() as AudioOutputProfile;
  const audioOutputProfile = audioOutputProfileOptions.includes(rawAudioProfile)
    ? rawAudioProfile
    : audioProfileFromMpdMode(value?.mpdBitPerfectMode);
  const minutes = Number(value?.displaySleepMinutes);
  const rawStyle = String(value?.displaySleepStyle ?? "").trim().toLowerCase().replaceAll("-", "_");
  const style = (rawStyle === "blank" || rawStyle === "dim_waves" ? "meteor_shower" : rawStyle === "dvd" || rawStyle === "dvd_bounce" ? "signal" : rawStyle) as DisplaySleepStyle;
  return {
    locale,
    inputMethodId: "keyboard-us",
    fontTheme: fontThemeOptions.includes(fontTheme) ? fontTheme : defaultPreferences.fontTheme,
    audioOutputProfile,
    audioOutputCustomSettings: normalizeAudioOutputCustomSettings(value?.audioOutputCustomSettings),
    mpdBitPerfectMode: mpdModeFromAudioProfile(audioOutputProfile),
    displaySleepEnabled: value?.displaySleepEnabled === undefined ? true : value.displaySleepEnabled !== false,
    displaySleepMinutes: displaySleepMinuteOptions.includes(minutes as typeof displaySleepMinuteOptions[number])
      ? minutes as typeof displaySleepMinuteOptions[number]
      : defaultPreferences.displaySleepMinutes,
    displaySleepStyle: displaySleepStyleOptions.includes(style) ? style : defaultPreferences.displaySleepStyle,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null,
    warning: value?.warning ?? null
  };
}

interface I18nContextValue {
  locale: UiLocale;
  preferences: UiPreferences;
  pending: boolean;
  error: string | null;
  t: (key: string, params?: TranslationParams) => string;
  setLocale: (locale: UiLocale) => Promise<UiPreferences>;
  setDisplaySleepPreferences: (patch: Partial<Pick<UiPreferences, "displaySleepEnabled" | "displaySleepMinutes" | "displaySleepStyle">>) => Promise<UiPreferences>;
  setAudioOutputProfile: (profile: AudioOutputProfile) => Promise<UiPreferences>;
  setAudioOutputCustomSettings: (settings: Partial<AudioOutputCustomSettings>) => Promise<UiPreferences>;
  setMpdBitPerfectMode: (mode: MpdBitPerfectMode) => Promise<UiPreferences>;
  refreshPreferences: () => Promise<UiPreferences | null>;
  sourceLabel: (sourceId: SourceState | string, fallback?: string | null) => string;
  roomLabel: (mode: RoomMode) => string;
  roomIntent: (mode: RoomMode) => string;
  storageLabel: (storage: AudioLibraryStorageId | string) => string;
  playbackStateLabel: (state: PlaybackState | string | null | undefined) => string;
  friendlyError: (message: string | null | undefined, fallbackKey?: string) => string | null;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [initialLocale] = useState<UiLocale | null>(readStoredLocale);
  const [preferences, setPreferences] = useState<UiPreferences>(() => ({
    ...defaultPreferences,
    locale: initialLocale ?? defaultPreferences.locale
  }));
  const [preferencesReady, setPreferencesReady] = useState(initialLocale !== null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = preferences.locale;

  const refreshPreferences = useCallback(async () => {
    try {
      const next = normalizePreferences(await fetchPreferences());
      setPreferences(next);
      setError(null);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Preferences unavailable");
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshPreferences().finally(() => setPreferencesReady(true));
    const timer = window.setInterval(() => void refreshPreferences(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshPreferences]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = "ltr";
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    document.documentElement.dataset.fontTheme = preferences.fontTheme;
    window.localStorage.setItem(FONT_THEME_STORAGE_KEY, preferences.fontTheme);
  }, [preferences.fontTheme]);

  const setLocale = useCallback(async (nextLocale: UiLocale) => {
    const normalized = localeFromValue(nextLocale);
    setPending(true);
    setError(null);
    setPreferences((current) => ({
      ...current,
      locale: normalized,
      inputMethodId: "keyboard-us",
      warning: null
    }));
    try {
      const next = normalizePreferences(await updatePreferences({ locale: normalized }));
      setPreferences(next);
      return next;
    } catch (caught) {
      await refreshPreferences();
      const message = caught instanceof Error ? caught.message : "Language did not save";
      setError(message);
      throw caught;
    } finally {
      setPending(false);
    }
  }, [refreshPreferences]);

  const setDisplaySleepPreferences = useCallback(async (
    patch: Partial<Pick<UiPreferences, "displaySleepEnabled" | "displaySleepMinutes" | "displaySleepStyle">>
  ) => {
    setPending(true);
    setError(null);
    setPreferences((current) => ({ ...current, ...patch, warning: null }));
    try {
      const next = normalizePreferences(await updatePreferences(patch));
      setPreferences(next);
      return next;
    } catch (caught) {
      await refreshPreferences();
      const message = caught instanceof Error ? caught.message : "Display preference did not save";
      setError(message);
      throw caught;
    } finally {
      setPending(false);
    }
  }, [refreshPreferences]);

  const setAudioOutputProfile = useCallback(async (profile: AudioOutputProfile) => {
    const normalizedProfile = audioOutputProfileOptions.includes(profile) ? profile : defaultPreferences.audioOutputProfile;
    setPending(true);
    setError(null);
    setPreferences((current) => ({
      ...current,
      audioOutputProfile: normalizedProfile,
      mpdBitPerfectMode: mpdModeFromAudioProfile(normalizedProfile),
      warning: null
    }));
    try {
      const next = normalizePreferences(await updatePreferences({ audioOutputProfile: normalizedProfile }));
      setPreferences(next);
      return next;
    } catch (caught) {
      await refreshPreferences();
      const message = caught instanceof Error ? caught.message : "Audio profile did not save";
      setError(message);
      throw caught;
    } finally {
      setPending(false);
    }
  }, [refreshPreferences]);

  const setAudioOutputCustomSettings = useCallback(async (settings: Partial<AudioOutputCustomSettings>) => {
    const normalizedSettings = normalizeAudioOutputCustomSettings({
      ...preferences.audioOutputCustomSettings,
      ...settings
    });
    setPending(true);
    setError(null);
    setPreferences((current) => ({
      ...current,
      audioOutputProfile: "custom",
      audioOutputCustomSettings: normalizedSettings,
      mpdBitPerfectMode: mpdModeFromAudioProfile("custom"),
      warning: null
    }));
    try {
      const next = normalizePreferences(await updatePreferences({
        audioOutputProfile: "custom",
        audioOutputCustomSettings: normalizedSettings
      }));
      setPreferences(next);
      return next;
    } catch (caught) {
      await refreshPreferences();
      const message = caught instanceof Error ? caught.message : "Custom audio settings did not save";
      setError(message);
      throw caught;
    } finally {
      setPending(false);
    }
  }, [preferences.audioOutputCustomSettings, refreshPreferences]);

  const setMpdBitPerfectMode = useCallback(async (mode: MpdBitPerfectMode) => {
    return setAudioOutputProfile(audioProfileFromMpdMode(mode));
  }, [setAudioOutputProfile]);

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: string, params?: TranslationParams) => translate(locale, key, params);
    const sourceLabel = (sourceId: SourceState | string, fallback?: string | null) => {
      const key = sourceId === "mpd" || sourceId === "library" ? "source.library" : `source.${sourceId}`;
      const translated = t(key);
      return translated === key ? fallback ?? String(sourceId) : translated;
    };
    const roomLabel = (mode: RoomMode) => t(`room.${mode}`);
    const roomIntent = (mode: RoomMode) => t(`room.${mode}Intent`);
    const storageLabel = (storage: AudioLibraryStorageId | string) => {
      const key = storage === "recently_added" ? "library.recentlyAdded" : `library.${storage}`;
      const translated = t(key);
      return translated === key ? String(storage) : translated;
    };
    const playbackStateLabel = (state: PlaybackState | string | null | undefined) => {
      if (state === "playing") return t("playback.playing");
      if (state === "paused") return t("playback.paused");
      if (state === "stopped") return t("playback.stopped");
      return t("common.ready");
    };
    const friendlyError = (message: string | null | undefined, fallbackKey = "error.generic") => {
      if (!message) return null;
      const normalized = message.toLowerCase();
      if (normalized.includes("unauthorized") || normalized.includes("forbidden") || normalized.includes("remote key")) return t("error.accessKey");
      if (normalized.includes("no ") && normalized.includes(" connection detected")) return t("error.noConnection");
      if (normalized.includes("seek")) return t("error.seek");
      if (normalized.includes("nas") || normalized.includes("cifs") || normalized.includes("smb")) return t("error.nas");
      if (normalized.includes("usb") || normalized.includes("drive")) return t("error.usb");
      if (normalized.includes("proxy")) return t("error.proxy");
      if (normalized.includes("brightness") || normalized.includes("ddc")) return t("error.brightness");
      if (normalized.includes("copy")) return t("error.copy");
      if (normalized.includes("delete") || normalized.includes("remove")) return t("error.delete");
      if (normalized.includes("favorite")) return t("error.favorite");
      if (normalized.includes("radio")) return t("error.radio");
      if (normalized.includes("library") || normalized.includes("manifest")) return t("error.library");
      if (normalized.includes("explore") || normalized.includes("provider")) return t("error.explore");
      if (normalized.includes("volume")) return t("error.volume");
      if (normalized.includes("timeout") || normalized.includes("timed out")) return t("error.timeout");
      if (normalized.includes("api") || normalized.includes("http") || normalized.includes("fetch")) return t("error.connection");
      if (message.length > 72 || normalized.includes("error") || normalized.includes("failed")) return t(fallbackKey);
      return message;
    };
    return {
      locale,
      preferences,
      pending,
      error,
      t,
      setLocale,
      setDisplaySleepPreferences,
      setAudioOutputProfile,
      setAudioOutputCustomSettings,
      setMpdBitPerfectMode,
      refreshPreferences,
      sourceLabel,
      roomLabel,
      roomIntent,
      storageLabel,
      playbackStateLabel,
      friendlyError
    };
  }, [error, locale, pending, preferences, refreshPreferences, setAudioOutputCustomSettings, setAudioOutputProfile, setDisplaySleepPreferences, setLocale, setMpdBitPerfectMode]);

  if (!preferencesReady) return null;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
