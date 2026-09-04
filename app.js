let currentUser = null;
let currentProfile = null;
let committees = [];
let meetings = [];
let reports = [];
let users = [];

const $ = (id) => document.getElementById(id);
const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(`${s}T12:00:00`);
  return d.toLocaleDateString(undefined,{weekday:"short",year:"numeric",month:"short",day:"numeric"});
};
const esc = (s="") => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const setMessage=(text,type="good",authMsg=false)=>{
  const el=$(authMsg?"authMessage":"message"); el.textContent=text; el.className=`message ${type}`; el.classList.remove("hidden");
  setTimeout(()=>el.classList.add("hidden"),5000);
};
const showView=(name)=>{
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  $(`${name}View`).classList.remove("hidden");
  document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
};

$("showBootstrapBtn").onclick=()=>{$("loginForm").classList.add("hidden");$("showBootstrapBtn").classList.add("hidden");$("bootstrapForm").classList.remove("hidden")};
$("cancelBootstrapBtn").onclick=()=>{$("bootstrapForm").classList.add("hidden");$("loginForm").classList.remove("hidden");$("showBootstrapBtn").classList.remove("hidden")};
$("logoutBtn").onclick=()=>auth.signOut();

$("loginForm").onsubmit=async(e)=>{
  e.preventDefault();
  try{await auth.signInWithEmailAndPassword($("loginEmail").value.trim(),$("loginPassword").value)}
  catch(err){setMessage(err.message,"error",true)}
};

$("bootstrapForm").onsubmit=async(e)=>{
  e.preventDefault();
  const name=$("bootstrapName").value.trim(), email=$("bootstrapEmail").value.trim(), password=$("bootstrapPassword").value;
  let cred=null;
  try{
    cred=await auth.createUserWithEmailAndPassword(email,password);
    const uid=cred.user.uid;
    await db.runTransaction(async tx=>{
      const setupRef=db.doc("setup/bootstrap"), userRef=db.doc(`users/${uid}`);
      const snap=await tx.get(setupRef);
      if(!snap.exists || snap.data().initialized!==false) throw new Error("First-time setup has already been completed.");
      tx.set(userRef,{name,email,role:"Admin",committeeId:null,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      tx.update(setupRef,{initialized:true,initializedBy:uid,initializedAt:firebase.firestore.FieldValue.serverTimestamp()});
    });
    setMessage("Admin account created.","good",true);
  }catch(err){
    if(cred?.user){try{await cred.user.delete()}catch(_){}}
    setMessage(err.message,"error",true);
  }
};

auth.onAuthStateChanged(async user=>{
  currentUser=user;
  if(!user){
    currentProfile=null;
    $("mainScreen").classList.remove("active"); $("authScreen").classList.add("active"); return;
  }
  try{
    const snap=await db.doc(`users/${user.uid}`).get();
    if(!snap.exists){
      // Allow bootstrap form transaction to finish without flashing access denied.
      if(!$("bootstrapForm").classList.contains("hidden")) return;
      setMessage("This account does not have approved Committee Reports access.","error",true);
      await auth.signOut(); return;
    }
    currentProfile={id:snap.id,...snap.data()};
    $("authScreen").classList.remove("active"); $("mainScreen").classList.add("active");
    $("userSummary").textContent=`${currentProfile.name} · ${currentProfile.role}`;
    buildNav();
    await loadData();
    renderAll();
    showView("dashboard");
  }catch(err){setMessage(err.message,"error",true)}
});

function buildNav(){
  const admin=currentProfile.role==="Admin";
  const items=admin
    ? [["dashboard","Dashboard"],["submissions","Submissions"],["committees","Committees"],["meetings","Meeting Dates"],["users","Users"]]
    : [["dashboard","Dashboard"],["report","Committee Report"],["submissions","My Reports"]];
  $("nav").innerHTML=items.map(([v,l])=>`<button data-view="${v}">${l}</button>`).join("");
  $("nav").querySelectorAll("button").forEach(b=>b.onclick=()=>{showView(b.dataset.view);renderAll()});
}

async function loadData(){
  const admin=currentProfile.role==="Admin";
  const [cSnap,mSnap]=await Promise.all([
    db.collection("committees").orderBy("name").get(),
    db.collection("meetingDates").orderBy("date").get()
  ]);
  committees=cSnap.docs.map(d=>({id:d.id,...d.data()}));
  meetings=mSnap.docs.map(d=>({id:d.id,...d.data()}));

  let rQuery=db.collection("committeeReports");
  if(!admin) rQuery=rQuery.where("committeeId","==",currentProfile.committeeId);
  const rSnap=await rQuery.get();
  reports=rSnap.docs.map(d=>({id:d.id,...d.data()}));

  if(admin){
    const uSnap=await db.collection("users").orderBy("name").get();
    users=uSnap.docs.map(d=>({id:d.id,...d.data()}));
  } else users=[];
}

function renderAll(){
  renderDashboard();
  renderReport();
  renderSubmissions();
  if(currentProfile.role==="Admin"){renderCommittees();renderMeetings();renderUsers()}
}

function renderDashboard(){
  const admin=currentProfile.role==="Admin";
  if(admin){
    const totalPossible=committees.length*meetings.length, submitted=reports.length, missing=Math.max(0,totalPossible-submitted);
    $("dashboardView").innerHTML=`<div class="section-head"><h2>Admin Dashboard</h2></div>
      <div class="grid">
        <div class="metric"><strong>${committees.length}</strong><span>Committees</span></div>
        <div class="metric"><strong>${meetings.length}</strong><span>Meeting Dates</span></div>
        <div class="metric"><strong>${submitted}</strong><span>Reports Submitted</span></div>
        <div class="metric"><strong>${missing}</strong><span>Reports Missing</span></div>
      </div>
      <div class="panel"><h3>Setup</h3><p class="muted">Add committees first, then meeting dates, then Executive Members. Everything after the first Admin account can be managed here.</p></div>`;
  } else {
    const committee=committees.find(c=>c.id===currentProfile.committeeId);
    const submittedIds=new Set(reports.map(r=>r.meetingId));
    const next=meetings.find(m=>!submittedIds.has(m.id));
    $("dashboardView").innerHTML=`<div class="section-head"><h2>${esc(committee?.name||"Assigned Committee")}</h2></div>
      <div class="grid">
        <div class="metric"><strong>${reports.length}</strong><span>Reports Submitted</span></div>
        <div class="metric"><strong>${Math.max(0,meetings.length-reports.length)}</strong><span>Reports Remaining</span></div>
      </div>
      <div class="panel"><h3>${next?"Next report due":"You're caught up"}</h3>
      <p>${next?fmtDate(next.date):"No missing preset meeting reports."}</p></div>`;
  }
}

function getSelectedMeeting(){
  const missing=meetings.filter(m=>!reports.some(r=>r.meetingId===m.id && r.committeeId===currentProfile.committeeId));
  return missing[0]||meetings[meetings.length-1]||null;
}

function renderReport(){
  if(currentProfile.role==="Admin"){ $("reportView").innerHTML=""; return; }
  const committee=committees.find(c=>c.id===currentProfile.committeeId), meeting=getSelectedMeeting();
  if(!committee){$("reportView").innerHTML=`<div class="panel"><h2>No committee assigned</h2><p class="muted">Ask an Admin to assign your account to a committee.</p></div>`;return}
  if(!meeting){$("reportView").innerHTML=`<div class="panel"><h2>No meeting dates yet</h2><p class="muted">An Admin must add a preset chapter meeting date first.</p></div>`;return}
  const existing=reports.find(r=>r.meetingId===meeting.id && r.committeeId===committee.id);
  $("reportView").innerHTML=`<div class="panel">
    <div class="section-head"><h2>Alpha Psi Chapter Committee Report</h2></div>
    <form id="reportForm" class="form-grid">
      <label>Committee<input class="readonly" value="${esc(committee.name)}" readonly></label>
      <label>Meeting Date<input class="readonly" value="${esc(fmtDate(meeting.date))}" readonly></label>
      <div><span class="muted">Did you meet?</span><div class="radio-row">
        <label><input type="radio" name="didMeet" value="Yes" ${existing?.didMeet==="Yes"?"checked":""} required> YES</label>
        <label><input type="radio" name="didMeet" value="No" ${existing?.didMeet==="No"?"checked":""}> No</label>
        <label><input type="radio" name="didMeet" value="Other" ${existing?.didMeet==="Other"?"checked":""}> Other</label>
      </div></div>
      <label id="otherReasonWrap" class="${existing?.didMeet==="Other"?"":"hidden"}">Other<input id="didMeetOther" value="${esc(existing?.didMeetOther||"")}"></label>
      <label>Committee Head / Officer<input class="readonly" value="${esc(currentProfile.name)}" readonly></label>
      <label>Other Members Attended <span class="muted">(one name per line)</span><textarea id="attendees">${esc((existing?.attendees||[]).join("\n"))}</textarea></label>
      <label>What was discussed in this meeting?<textarea id="discussion" required>${esc(existing?.discussion||"")}</textarea></label>
      <label class="certify"><input id="certified" type="checkbox" ${existing?.certified?"checked":""} required><span>I certify that this report is accurate. My logged-in account and submission timestamp serve as my signature and date.</span></label>
      <button class="primary" type="submit">${existing?"Update Report":"Submit Report"}</button>
    </form></div>`;
  document.querySelectorAll('input[name="didMeet"]').forEach(r=>r.onchange=()=>$("otherReasonWrap").classList.toggle("hidden",r.value!=="Other"||!r.checked));
  $("reportForm").onsubmit=async e=>{
    e.preventDefault();
    const didMeet=document.querySelector('input[name="didMeet"]:checked')?.value;
    const attendees=$("attendees").value.split("\n").map(x=>x.trim()).filter(Boolean);
    const data={
      committeeId:committee.id,committeeName:committee.name,meetingId:meeting.id,meetingDate:meeting.date,
      didMeet,didMeetOther:didMeet==="Other"?$("didMeetOther").value.trim():"",
      committeeHead:currentProfile.name,attendees,discussion:$("discussion").value.trim(),
      certified:$("certified").checked,submittedBy:currentUser.uid,submittedByName:currentProfile.name,
      submittedAt:firebase.firestore.FieldValue.serverTimestamp()
    };
    try{
      await db.doc(`committeeReports/${meeting.id}_${committee.id}`).set(data,{merge:true});
      await loadData(); renderAll(); setMessage("Committee report saved.");
    }catch(err){setMessage(err.message,"error")}
  };
}

function renderSubmissions(){
  const admin=currentProfile.role==="Admin";
  if(!admin){
    const rows=[...reports].sort((a,b)=>(b.meetingDate||"").localeCompare(a.meetingDate||"")).map(r=>`<tr><td>${fmtDate(r.meetingDate)}</td><td>${esc(r.didMeet)}</td><td>${esc(r.discussion||"")}</td><td><span class="badge good">Submitted</span></td></tr>`).join("");
    $("submissionsView").innerHTML=`<div class="panel"><div class="section-head"><h2>My Reports</h2></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Met?</th><th>Discussion</th><th>Status</th></tr></thead><tbody>${rows||'<tr><td colspan="4" class="muted">No reports submitted yet.</td></tr>'}</tbody></table></div></div>`;
    return;
  }
  const rows=[];
  [...meetings].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).forEach(m=>{
    committees.forEach(c=>{
      const r=reports.find(x=>x.meetingId===m.id&&x.committeeId===c.id);
      rows.push(`<tr><td>${fmtDate(m.date)}</td><td>${esc(c.name)}</td><td>${r?esc(r.submittedByName||"—"):"—"}</td><td>${r?`<span class="badge good">Submitted</span>`:`<span class="badge missing">Missing</span>`}</td><td>${r?esc(r.discussion||""):""}</td></tr>`);
    });
  });
  $("submissionsView").innerHTML=`<div class="panel"><div class="section-head"><h2>All Committee Reports</h2></div><div class="table-wrap"><table><thead><tr><th>Meeting Date</th><th>Committee</th><th>Submitted By</th><th>Status</th><th>Discussion</th></tr></thead><tbody>${rows.join("")||'<tr><td colspan="5" class="muted">Add committees and meeting dates to begin tracking.</td></tr>'}</tbody></table></div></div>`;
}

function renderCommittees(){
  const rows=committees.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.description||"")}</td></tr>`).join("");
  $("committeesView").innerHTML=`<div class="panel"><div class="section-head"><h2>Committees</h2></div>
    <form id="committeeForm" class="form-grid"><label>Committee Name<input id="committeeName" required></label><label>Description (optional)<input id="committeeDesc"></label><button class="primary">Add Committee</button></form></div>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Description</th></tr></thead><tbody>${rows||'<tr><td colspan="2" class="muted">No committees yet.</td></tr>'}</tbody></table></div></div>`;
  $("committeeForm").onsubmit=async e=>{
    e.preventDefault(); const name=$("committeeName").value.trim(), id=slug(name);
    if(!id)return;
    try{await db.doc(`committees/${id}`).set({name,description:$("committeeDesc").value.trim(),createdAt:firebase.firestore.FieldValue.serverTimestamp()});await loadData();renderAll();setMessage("Committee added.")}
    catch(err){setMessage(err.message,"error")}
  };
}

function renderMeetings(){
  const rows=meetings.map(m=>`<tr><td>${fmtDate(m.date)}</td><td>${m.active===false?"Inactive":"Active"}</td></tr>`).join("");
  $("meetingsView").innerHTML=`<div class="panel"><div class="section-head"><h2>Meeting Dates</h2></div>
    <form id="meetingForm" class="form-grid"><label>Chapter Meeting Date<input id="meetingDate" type="date" required></label><button class="primary">Add Meeting Date</button></form></div>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>${rows||'<tr><td colspan="2" class="muted">No dates yet.</td></tr>'}</tbody></table></div></div>`;
  $("meetingForm").onsubmit=async e=>{
    e.preventDefault(); const date=$("meetingDate").value; if(!date)return;
    try{await db.doc(`meetingDates/${date}`).set({date,active:true,createdAt:firebase.firestore.FieldValue.serverTimestamp()});await loadData();renderAll();setMessage("Meeting date added.")}
    catch(err){setMessage(err.message,"error")}
  };
}

function renderUsers(){
  const options=committees.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("");
  const rows=users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(committees.find(c=>c.id===u.committeeId)?.name||"—")}</td></tr>`).join("");
  $("usersView").innerHTML=`<div class="panel"><div class="section-head"><h2>Add Executive Member</h2></div>
    <form id="userForm" class="form-grid">
      <label>Name<input id="newUserName" required></label>
      <label>Email<input id="newUserEmail" type="email" required></label>
      <label>Temporary Password<input id="newUserPassword" type="password" minlength="6" required></label>
      <label>Committee<select id="newUserCommittee" required><option value="">Choose committee…</option>${options}</select></label>
      <button class="primary">Create Executive Member</button>
    </form></div>
    <div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Committee</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  $("userForm").onsubmit=async e=>{
    e.preventDefault();
    let secondary=null;
    try{
      secondary=firebase.initializeApp(firebaseConfig,`Secondary-${Date.now()}`);
      const cred=await secondary.auth().createUserWithEmailAndPassword($("newUserEmail").value.trim(),$("newUserPassword").value);
      await db.doc(`users/${cred.user.uid}`).set({
        name:$("newUserName").value.trim(),email:$("newUserEmail").value.trim(),
        role:"Executive Member",committeeId:$("newUserCommittee").value,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      await secondary.auth().signOut(); await secondary.delete();
      await loadData();renderAll();setMessage("Executive Member account created.");
    }catch(err){
      try{if(secondary){await secondary.auth().signOut();await secondary.delete()}}catch(_){}
      setMessage(err.message,"error");
    }
  };
}
