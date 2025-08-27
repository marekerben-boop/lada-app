
// firebase.js
;(function () {
  if (!window.firebase) {
    console.error('Firebase SDK není načtená. Vlož firebase-*compat.js před tento soubor.');
    return;
  }

  // 🔧 VYPLŇ SVŮJ KONFIG (stejný pro admin i student)
  const firebaseConfig = {
      apiKey: "AIzaSyDxLM9oc3-zmhJRGYTDa04Wkjk7qS3gtl8",
      authDomain:"lada-anglictina-app.firebaseapp.com",
      projectId: "lada-anglictina-app",
      storageBucket:"lada-anglictina-app.firebasestorage.app",
      messagingSenderId: "281293994339",
      appId: "1:281293994339:web:e4f798ff03c9a867b97b56",
      measurementId: "G-64SV0CKN0P"
  };

  try {
    // Inicializace přes guard – nevadí, když je firebase.js na více stránkách
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);

    // Zpřístupníme služby globálně
    window.auth = firebase.auth(app);
    window.db   = firebase.firestore(app);

    console.log('Firebase init OK:', app.name);
  } catch (e) {
    console.error('Firebase init fail:', e);
  }
})();
