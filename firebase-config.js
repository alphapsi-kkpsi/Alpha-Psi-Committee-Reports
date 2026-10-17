const firebaseConfig = {
        apiKey: "AIzaSyA2I8qSLHJg1672k51cCQaHSFMblB4yUew",
        authDomain: "alphapsi-pointtracker.firebaseapp.com",
        projectId: "alphapsi-pointtracker",
        storageBucket: "alphapsi-pointtracker.firebasestorage.app",
        messagingSenderId: "428688680473",
        appId: "1:428688680473:web:e3e81709e8f4f1af8fac88",
        measurementId: "G-VJNGQ0LSHR"
      };

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
