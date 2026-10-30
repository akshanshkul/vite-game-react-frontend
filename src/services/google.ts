// Google sign-in through Firebase Authentication. Firebase is loaded only when
// the player taps the button, so guests never download it. The ID token is
// exchanged for the game's own session cookie; Firebase is then signed out.
// These web config values are public identifiers, not secrets.
const config = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "AIzaSyBiJM_ZMzqNnB_Ab6iCGcgjUikd6NQUiZA",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    "vite-game.firebaseapp.com",
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID || "vite-game",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "vite-game.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "252915203336",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    "1:252915203336:web:eec532792694e22c3080bd",
};

const messages: Record<string, string> = {
  "auth/popup-closed-by-user": "Google sign-in was closed before finishing.",
  "auth/cancelled-popup-request": "Google sign-in was closed before finishing.",
  "auth/popup-blocked":
    "Your browser blocked the Google window. Allow pop-ups and try again.",
  "auth/unauthorized-domain":
    "This address is not allowed for Google sign-in yet. Add it under Firebase → Authentication → Settings → Authorized domains.",
  "auth/operation-not-allowed":
    "Google sign-in is not enabled for this Firebase project.",
  "auth/network-request-failed": "No connection. Google sign-in needs internet.",
};

/** Opens the Google account picker and returns a Firebase ID token. */
export async function googleIdToken(): Promise<string> {
  const [{ initializeApp, getApps }, auth] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const app = getApps()[0] ?? initializeApp(config);
  const a = auth.getAuth(app);
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const result = await auth.signInWithPopup(a, provider);
    return await result.user.getIdToken();
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    throw Error(messages[code] ?? "Google sign-in failed. Try again.");
  } finally {
    void auth.signOut(a).catch(() => {});
  }
}
