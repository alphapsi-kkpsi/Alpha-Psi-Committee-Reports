const {onRequest}=require("firebase-functions/v2/https");
const admin=require("firebase-admin");
const source=admin.initializeApp({projectId:"alphapsi-pointtracker"},"attendance");
const destination=admin.initializeApp({projectId:"alpha-psi-committee-reports"},"committee");
const normalize=v=>String(v||"").trim().toLowerCase();
exports.exchangeAttendanceLogin=onRequest({cors:["https://forms.alphapsi-kkpsi.org"],region:"us-central1",maxInstances:10},async(req,res)=>{
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 try{
  const token=String(req.body?.idToken||"");
  if(!token)return res.status(401).json({error:"Missing Attendance token"});
  const verified=await source.auth().verifyIdToken(token,true);
  const snap=await source.firestore().doc("chapters/alpha-psi").get();
  const member=(snap.data()?.state?.members||[]).find(m=>normalize(m.email)===normalize(verified.email));
  if(!member||member.role!=="Executive Member")return res.status(403).json({error:"Executive Member access required"});
  const email=normalize(verified.email);
  const uid="attendance_"+verified.uid;
  const existing=await destination.firestore().collection("users").doc(uid).get();
  const profile=existing.data()||{};
  await destination.firestore().collection("users").doc(uid).set({
   name:String(member.name||[member.firstName,member.lastName].filter(Boolean).join(" ")||email),
   email,role:"Executive Member",attendanceId:String(member.id||""),
   committeeId:profile.committeeId||null,source:"attendance",
   syncedAt:admin.firestore.FieldValue.serverTimestamp()
  },{merge:true});
  const customToken=await destination.auth().createCustomToken(uid);
  return res.json({customToken});
 }catch(error){console.error("Attendance exchange failed",error.code||error.message);return res.status(401).json({error:"Unable to verify Attendance account"});}
});
