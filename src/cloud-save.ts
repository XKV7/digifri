/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Optional cloud save sync for the offline (bypass-login) deployment.
 *
 * The game itself keeps saving to localStorage exactly as before; this module
 * mirrors the relevant localStorage keys to Firestore under the signed-in
 * Google account, so progress can be continued on any device.
 *
 * Data model: users/{uid}/saves/{localStorageKey} -> { v: string (lz-base64), t: number, del?: true }
 */

import { publishGiftProfile, setCloudSaveContext } from "#app/gift";
import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { collection, doc, getDocs, getFirestore, setDoc } from "firebase/firestore";
import { compressToBase64, decompressFromBase64 } from "lz-string";

const firebaseConfig = {
  apiKey: "AIzaSyDA2qk9TKCawXTpPcbiiB3PHNSuBXDBG3g",
  authDomain: "pokerogue-4818a.firebaseapp.com",
  projectId: "pokerogue-4818a",
  storageBucket: "pokerogue-4818a.firebasestorage.app",
  messagingSenderId: "445956050754",
  appId: "1:445956050754:web:25cbcc8b24ae8a3476c2db",
};

/** localStorage keys that are mirrored to the cloud */
function isSyncedKey(key: string): boolean {
  return (
    /^(data|sessionData\d*|runHistoryData|starterPrefs)_Guest$/.test(key)
    || ["settings", "tutorials", "prLang", "mappingConfigs", "daily"].includes(key)
  );
}

const TS_PREFIX = "cloudsave.t.";
const OPTOUT_KEY = "cloudsave.optout";
const UID_KEY = "cloudsave.uid";
const UPLOAD_DEBOUNCE_MS = 2500;

const rawSetItem = localStorage.setItem.bind(localStorage);
const rawRemoveItem = localStorage.removeItem.bind(localStorage);

function getMirrorTs(key: string): number {
  return Number(localStorage.getItem(TS_PREFIX + key)) || 0;
}

function setMirrorTs(key: string, t: number): void {
  rawSetItem(TS_PREFIX + key, String(t));
}

let badge: HTMLDivElement | undefined;
let pendingUploads = 0;
let cloudApp: ReturnType<typeof initializeApp> | undefined;
let cloudAuth: ReturnType<typeof getAuth> | undefined;

function setBadge(state: "off" | "ok" | "busy" | "error", tooltip: string): void {
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "cloud-save-badge";
    badge.style.cssText =
      "position:fixed;right:6px;bottom:6px;z-index:9999;font-size:14px;line-height:1;padding:4px 6px;"
      + "border-radius:6px;background:rgba(0,0,0,0.45);color:#fff;cursor:pointer;user-select:none;opacity:0.75;font-family:sans-serif;";
    document.body.appendChild(badge);
  }
  badge.textContent = { off: "☁️✕", ok: "☁️✓", busy: "☁️…", error: "☁️!" }[state];
  badge.title = tooltip;
}

function showLoginOverlay(): Promise<"google" | "local"> {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;"
      + "align-items:center;justify-content:center;gap:16px;font-family:sans-serif;color:#fff;text-align:center;padding:16px;";
    const title = document.createElement("div");
    title.style.cssText = "font-size:20px;font-weight:bold;";
    title.textContent = "클라우드 저장 (Cloud Save)";
    const desc = document.createElement("div");
    desc.style.cssText = "font-size:14px;opacity:0.85;max-width:420px;line-height:1.5;";
    desc.textContent =
      "Google 계정으로 로그인하면 세이브가 클라우드에 저장되어 다른 기기에서도 이어서 플레이할 수 있어요. "
      + "로그인하지 않으면 이 기기(브라우저)에만 저장됩니다.";
    const btnStyle =
      "font-size:16px;padding:12px 24px;border-radius:8px;border:none;cursor:pointer;min-width:260px;font-weight:bold;";
    const googleBtn = document.createElement("button");
    googleBtn.style.cssText = btnStyle + "background:#4285F4;color:#fff;";
    googleBtn.textContent = "Google 계정으로 로그인";
    const localBtn = document.createElement("button");
    localBtn.style.cssText = btnStyle + "background:#555;color:#fff;";
    localBtn.textContent = "이 기기에서만 플레이";
    const done = (choice: "google" | "local") => {
      overlay.remove();
      resolve(choice);
    };
    googleBtn.onclick = () => done("google");
    localBtn.onclick = () => done("local");
    overlay.append(title, desc, googleBtn, localBtn);
    document.body.appendChild(overlay);
  });
}

/** Wait for Firebase to restore the persisted auth session (first emission). */
function waitForAuthState(auth: ReturnType<typeof getAuth>): Promise<User | null> {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(
      auth,
      user => {
        unsub();
        resolve(user);
      },
      () => {
        unsub();
        resolve(null);
      },
    );
  });
}

export async function initCloudSave(): Promise<void> {
  let app: ReturnType<typeof initializeApp>;
  let auth: ReturnType<typeof getAuth>;
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);
  } catch (err) {
    console.error("Cloud save unavailable:", err);
    return;
  }
  cloudApp = app;
  cloudAuth = auth;

  try {
    await getRedirectResult(auth); // completes a signInWithRedirect round-trip, if any
  } catch (err) {
    console.error("Cloud login (redirect) failed:", err);
  }

  let user = await waitForAuthState(auth);

  if (!user && localStorage.getItem(OPTOUT_KEY) !== "1") {
    const choice = await showLoginOverlay();
    if (choice === "google") {
      user = await login(auth);
    } else {
      rawSetItem(OPTOUT_KEY, "1");
    }
  }

  if (!user) {
    setBadge("off", "클라우드 저장 꺼짐 — 클릭하여 Google 계정으로 로그인");
    badge!.onclick = () => void triggerCloudLogin();
    return;
  }

  await startSync(app, user);

  // allow signing out via the badge
  badge!.onclick = () => void triggerCloudLogout();
}

/** Starts the Google sign-in flow. Usable from the badge or the in-game menu (see menu-ui-handler.ts). */
export async function triggerCloudLogin(): Promise<void> {
  if (!cloudApp || !cloudAuth) {
    return;
  }
  const u = await login(cloudAuth);
  if (u) {
    localStorage.removeItem(OPTOUT_KEY);
    await startSync(cloudApp, u);
    // startSync() only reloads itself when it actually pulled in changed data; an interactive
    // login should always end in a reload regardless, so every screen (title username label,
    // in-game menu options, badge) picks up the newly signed-in state consistently. If startSync
    // already reloaded, execution never reaches here (it halts on an unresolved promise).
    window.location.reload();
  }
}

/**
 * Signs out of cloud save (after confirmation) and reloads. Usable from the badge or the in-game
 * menu. Clears (rather than sets) OPTOUT_KEY, so the Google-login-or-local-play choice screen
 * always reappears on the reload that follows, instead of silently landing back in local-only
 * play the way a first-time opt-out would.
 */
export async function triggerCloudLogout(): Promise<void> {
  if (!cloudAuth) {
    return;
  }
  if (!confirm("클라우드 저장에서 로그아웃할까요?\n(세이브는 이 기기와 클라우드 양쪽에 남아 있습니다)")) {
    return;
  }
  await signOut(cloudAuth).catch(() => {});
  rawRemoveItem(OPTOUT_KEY);
  window.location.reload();
}

async function login(auth: ReturnType<typeof getAuth>): Promise<User | null> {
  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (err) {
    console.error("Popup login failed, falling back to redirect:", err);
    try {
      await signInWithRedirect(auth, provider); // navigates away; resumes via getRedirectResult
    } catch (err2) {
      console.error("Cloud login failed:", err2);
      alert("Google 로그인에 실패했어요. 팝업 차단을 해제하고 다시 시도해 주세요.");
    }
    return null;
  }
}

async function startSync(app: ReturnType<typeof initializeApp>, user: User): Promise<void> {
  const db = getFirestore(app);
  const savesRef = collection(db, "users", user.uid, "saves");
  setBadge("busy", "클라우드 세이브 동기화 중…");

  setCloudSaveContext(app, user);
  void publishGiftProfile(app, user);

  // If this device last synced with a different account, resolve whose data wins
  const prevUid = localStorage.getItem(UID_KEY);
  const uidChanged = !!prevUid && prevUid !== user.uid;

  let remote: Map<string, { v?: string; t: number; del?: boolean }>;
  try {
    remote = new Map();
    const snapshot = await getDocs(savesRef);
    snapshot.forEach(d => remote.set(d.id, d.data() as { v?: string; t: number; del?: boolean }));
  } catch (err) {
    console.error("Cloud save download failed:", err);
    setBadge("error", "클라우드 동기화 실패 — 이 기기의 세이브로 플레이합니다");
    return;
  }

  const localKeys = Object.keys(localStorage).filter(isSyncedKey);
  const hasUnsyncedLocal = localKeys.some(k => !getMirrorTs(k));
  const dialogShown = !uidChanged && remote.size > 0 && hasUnsyncedLocal;
  let preferRemote = uidChanged;
  if (dialogShown) {
    // First login on a device that already has local progress: ask which side wins
    preferRemote = confirm(
      "클라우드에 저장된 세이브가 있습니다.\n\n"
        + "확인 = 클라우드 세이브 사용 (이 기기의 기존 세이브를 덮어씀)\n"
        + "취소 = 이 기기의 세이브를 클라우드에 업로드",
    );
  }
  const preferLocal = dialogShown && !preferRemote;

  let applied = 0;
  const toUpload: string[] = [];

  for (const [key, data] of remote) {
    if (!isSyncedKey(key)) {
      continue;
    }
    const localTs = getMirrorTs(key);
    const localVal = localStorage.getItem(key);
    const remoteWins = preferRemote || (!preferLocal && (data.t > localTs || localVal === null));
    if (remoteWins) {
      if (data.del) {
        if (localVal !== null) {
          rawRemoveItem(key);
          applied++;
        }
      } else if (data.v !== undefined) {
        const decompressed = decompressFromBase64(data.v);
        if (decompressed !== null && decompressed !== localVal) {
          rawSetItem(key, decompressed);
          applied++;
        }
      }
      setMirrorTs(key, data.t);
    } else if (localVal !== null && (preferLocal || localTs > data.t)) {
      toUpload.push(key);
    }
  }
  if (preferRemote) {
    // Make this device match the cloud exactly (drops local-only leftovers,
    // e.g. a previous account's data after switching accounts)
    for (const key of localKeys) {
      if (!remote.has(key)) {
        rawRemoveItem(key);
        rawRemoveItem(TS_PREFIX + key);
        applied++;
      }
    }
  } else {
    // local keys the cloud has never seen
    for (const key of localKeys) {
      if (!remote.has(key) && localStorage.getItem(key) !== null) {
        toUpload.push(key);
      }
    }
  }

  rawSetItem(UID_KEY, user.uid);

  const uploadKey = async (key: string): Promise<void> => {
    const t = Date.now();
    const value = localStorage.getItem(key);
    const payload = value === null ? { del: true, t } : { v: compressToBase64(value), t };
    pendingUploads++;
    setBadge("busy", "클라우드에 저장 중…");
    try {
      await setDoc(doc(db, "users", user.uid, "saves", key), payload);
      setMirrorTs(key, t);
    } catch (err) {
      console.error(`Cloud upload failed for ${key}:`, err);
      setBadge("error", "클라우드 업로드 실패 — 잠시 후 자동 재시도됩니다");
    } finally {
      pendingUploads--;
      if (pendingUploads === 0 && badge?.textContent !== "☁️!") {
        setBadge("ok", `클라우드 저장 사용 중 (${user.email ?? user.uid}) — 클릭하여 로그아웃`);
      }
    }
  };

  for (const key of toUpload) {
    void uploadKey(key);
  }

  // Mirror future writes/removals of synced keys to Firestore (debounced per key)
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const queueUpload = (key: string): void => {
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        void uploadKey(key);
      }, UPLOAD_DEBOUNCE_MS),
    );
  };
  localStorage.setItem = (key: string, value: string) => {
    rawSetItem(key, value);
    if (isSyncedKey(key)) {
      queueUpload(key);
    }
  };
  localStorage.removeItem = (key: string) => {
    rawRemoveItem(key);
    if (isSyncedKey(key)) {
      queueUpload(key);
    }
  };
  // Flush pending writes when the tab goes to background / closes
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      for (const [key, timer] of timers) {
        clearTimeout(timer);
        timers.delete(key);
        void uploadKey(key);
      }
    }
  });

  setBadge("ok", `클라우드 저장 사용 중 (${user.email ?? user.uid}) — 클릭하여 로그아웃`);

  if (applied > 0) {
    // Settings/language/saves were replaced after modules already read them; reload once so
    // the game boots from the freshly-synced data. Mirror timestamps prevent a reload loop.
    window.location.reload();
    await new Promise(() => {}); // halt startup while the page reloads
  }
}
