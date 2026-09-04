const firebaseConfig = {
apiKey: "AIzaSyDln-EBg1toB11tat2dvX37tce9eJ_MFrM",
  authDomain: "alpha-psi-committee-reports.firebaseapp.com",
  projectId: "alpha-psi-committee-reports",
  storageBucket: "alpha-psi-committee-reports.firebasestorage.app",
  messagingSenderId: "446465113457",
  appId: "1:446465113457:web:7778e561496226f13acad0"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
