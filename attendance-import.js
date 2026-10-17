/* Attendance roster import. Explicit Admin action; read-only source. */
window.AttendanceImport = (() => {
  const sourceConfig = {
    apiKey: "AIzaSyA2I8qSLHJg1672k51cCQaHSFMblB4yUew",
    authDomain: "alphapsi-pointtracker.firebaseapp.com",
    projectId: "alphapsi-pointtracker",
    appId: "1:428688680473:web:e3e81709e8f4f1af8fac88"
  };
  const normalize = value => String(value || "").trim().toLowerCase();
  async function loadRoster(email, password) {
    const appName = "attendance-roster-" + Date.now();
    const app = firebase.initializeApp(sourceConfig, appName);
    try {
      const credential = await app.auth().signInWithEmailAndPassword(email, password);
      const snap = await app.firestore().doc("chapters/alpha-psi").get();
      if (!snap.exists) throw Error("Attendance chapter roster was not found.");
      const state = snap.data().state || {};
      const me = (state.members || []).find(m => normalize(m.email) === normalize(credential.user.email));
      if (!me || me.role !== "Admin") throw Error("Only an Attendance Site Admin can import its Executive roster.");
      const executives = (state.members || []).filter(m => m.role === "Executive Member" && m.email);
      return executives.map(m => ({
        name: String(m.name || [m.firstName,m.lastName].filter(Boolean).join(" ")).trim(),
        email: normalize(m.email),
        attendanceId: String(m.id || ""),
        committee: String(m.committee || m.committeeName || "")
      }));
    } finally {
      try { await app.auth().signOut(); } catch (_) {}
      await app.delete();
    }
  }
  return {loadRoster};
})();
