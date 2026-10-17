let currentUser = null;
let currentProfile = null;
let committees = [];
let reports = [];
let users = [];
let selectedReportDate = null;
let submissionsStatusFilter = 'all';

const $ = (id) => document.getElementById(id);

const esc = (s = "") =>
  String(s).replace(
    /[&<>"']/g,
    c =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[c]
  );

const slug = s =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDate(dateString) {
  return new Date(`${dateString}T12:00:00`);
}

function fmtDate(s) {
  if (!s) return "";
  return parseLocalDate(s).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function fmtTime(time) {
  if (!time) return "—";

  return new Date(`2000-01-01T${time}`).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function setMessage(text, type = "good", authMsg = false) {
  const el = $(authMsg ? "authMessage" : "message");

  el.textContent = text;
  el.className = `message ${type}`;
  el.classList.remove("hidden");

  setTimeout(() => el.classList.add("hidden"), 5000);
}

function showView(name) {
  document
    .querySelectorAll(".view")
    .forEach(v => v.classList.add("hidden"));

  const view = $(`${name}View`);
  if (view) view.classList.remove("hidden");

  document.querySelectorAll("#nav button").forEach(b => {
    b.classList.toggle("active", b.dataset.view === name);
  });
}

const dayNumbers = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

/*
  Returns all required committee meeting dates from the date
  tracking began through today.

  A report becomes required once that committee's meeting
  date occurs.
*/
function getRequiredDates(committee) {
  if (!committee?.meetingDay) return [];

  const wantedDay = dayNumbers[committee.meetingDay];

  if (wantedDay === undefined) return [];

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  let start;

  if (committee.trackingStartDate) {
    start = parseLocalDate(committee.trackingStartDate);
  } else if (committee.createdAt?.toDate) {
    start = committee.createdAt.toDate();
  } else {
    start = new Date();
  }

  start.setHours(12, 0, 0, 0);

  while (start.getDay() !== wantedDay) {
    start.setDate(start.getDate() + 1);
  }

  const dates = [];
  const cursor = new Date(start);

  while (cursor <= today) {
    dates.push(localDateString(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  return dates;
}

function getNextMeetingDate(committee) {
  if (!committee?.meetingDay) return null;

  const wantedDay = dayNumbers[committee.meetingDay];

  if (wantedDay === undefined) return null;

  const now = new Date();
  const next = new Date(now);

  next.setHours(12, 0, 0, 0);

  let daysAhead = (wantedDay - next.getDay() + 7) % 7;

  if (daysAhead === 0 && committee.meetingTime) {
    const [hours, minutes] = committee.meetingTime.split(":").map(Number);

    const meetingToday = new Date();
    meetingToday.setHours(hours, minutes, 0, 0);

    if (now > meetingToday) {
      daysAhead = 7;
    }
  }

  next.setDate(next.getDate() + daysAhead);

  return localDateString(next);
}

function getCommitteeMissingDates(committee) {
  const requiredDates = getRequiredDates(committee);

  return requiredDates.filter(date => {
    return !reports.some(
      r =>
        r.committeeId === committee.id &&
        r.meetingDate === date
    );
  });
}

/* ---------- AUTH SCREEN ---------- */

$("showBootstrapBtn").onclick = () => {
  $("loginForm").classList.add("hidden");
  $("showBootstrapBtn").classList.add("hidden");
  $("bootstrapForm").classList.remove("hidden");
};

$("cancelBootstrapBtn").onclick = () => {
  $("bootstrapForm").classList.add("hidden");
  $("loginForm").classList.remove("hidden");
  $("showBootstrapBtn").classList.remove("hidden");
};

$("logoutBtn").onclick = () => auth.signOut();

$("loginForm").onsubmit = async e => {
  e.preventDefault();
  const email = $("loginEmail").value.trim().toLowerCase();
  const password = $("loginPassword").value;
  try {
    await auth.signInWithEmailAndPassword(email,password);
  } catch (err) {
    if (!["auth/user-not-found","auth/invalid-credential"].includes(err.code)) {
      setMessage(err.message,"error",true); return;
    }
    try {
      const approval = await db.collection("approvedExecutives").doc(email).get();
      if (!approval.exists || approval.data().active !== true) throw Error("An Admin must first import your Executive profile from Attendance.");
      const sourceApp = firebase.initializeApp({
        apiKey:"AIzaSyA2I8qSLHJg1672k51cCQaHSFMblB4yUew",
        authDomain:"alphapsi-pointtracker.firebaseapp.com",
        projectId:"alphapsi-pointtracker",
        appId:"1:428688680473:web:e3e81709e8f4f1af8fac88"
      },"attendance-verify-"+Date.now());
      try {
        await sourceApp.auth().signInWithEmailAndPassword(email,password);
        const snap = await sourceApp.firestore().doc("chapters/alpha-psi").get();
        const member = (snap.data()?.state?.members||[]).find(m=>String(m.email||"").toLowerCase()===email && m.role==="Executive Member");
        if (!member) throw Error("Your Attendance account is not an Executive Member.");
        await auth.createUserWithEmailAndPassword(email,password);
        await db.doc("users/"+auth.currentUser.uid).set({
          name:approval.data().name||member.name||email,email,role:"Executive Member",
          committeeId:approval.data().committeeId||null,source:"attendance",
          createdAt:firebase.firestore.FieldValue.serverTimestamp()
        });
      } finally {await sourceApp.auth().signOut().catch(()=>{});await sourceApp.delete();}
    } catch (error) {setMessage(error.message,"error",true);}
  }
};

$("bootstrapForm").onsubmit = async e => {
  e.preventDefault();

  const name = $("bootstrapName").value.trim();
  const email = $("bootstrapEmail").value.trim();
  const password = $("bootstrapPassword").value;

  let cred = null;

  try {
    cred = await auth.createUserWithEmailAndPassword(email, password);

    const uid = cred.user.uid;

    await db.runTransaction(async tx => {
      const setupRef = db.doc("setup/bootstrap");
      const userRef = db.doc(`users/${uid}`);

      const snap = await tx.get(setupRef);

      if (!snap.exists || snap.data().initialized !== false) {
        throw new Error(
          "First-time setup has already been completed."
        );
      }

      tx.set(userRef, {
        name,
        email,
        role: "Admin",
        committeeId: null,
        createdAt:
          firebase.firestore.FieldValue.serverTimestamp()
      });

      tx.update(setupRef, {
        initialized: true,
        initializedBy: uid,
        initializedAt:
          firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    setMessage("Admin account created.", "good", true);
  } catch (err) {
    if (cred?.user) {
      try {
        await cred.user.delete();
      } catch (_) {}
    }

    setMessage(err.message, "error", true);
  }
};

/* ---------- AUTH STATE ---------- */

auth.onAuthStateChanged(async user => {
  currentUser = user;

  if (!user) {
    currentProfile = null;

    $("mainScreen").classList.remove("active");
    $("authScreen").classList.add("active");

    return;
  }

  try {
    const snap = await db.doc(`users/${user.uid}`).get();

    if (!snap.exists) {
      if (!$("bootstrapForm").classList.contains("hidden")) {
        return;
      }

      setMessage(
        "This account does not have approved Committee Reports access.",
        "error",
        true
      );

      await auth.signOut();
      return;
    }

    currentProfile = {
      id: snap.id,
      ...snap.data()
    };

    $("authScreen").classList.remove("active");
    $("mainScreen").classList.add("active");

    $("userSummary").textContent =
      `${currentProfile.name} · ${currentProfile.role}`;

    buildNav();

    await loadData();

    renderAll();
    showView("dashboard");
  } catch (err) {
    setMessage(err.message, "error", true);
  }
});

/* ---------- NAV ---------- */

function buildNav() {
  const admin = currentProfile.role === "Admin";

  const items = admin
    ? [
        ["dashboard", "Dashboard"],
        ["submissions", "Submissions"],
        ["committees", "Committees"],
        ["users", "Users"]
      ]
    : [
        ["dashboard", "Dashboard"],
        ["report", "Committee Report"],
        ["submissions", "My Reports"]
      ];

  $("nav").innerHTML = items
    .map(
      ([view, label]) =>
        `<button data-view="${view}">${label}</button>`
    )
    .join("");

  $("nav")
    .querySelectorAll("button")
    .forEach(button => {
      button.onclick = () => {
        showView(button.dataset.view);
        renderAll();
      };
    });
}

/* ---------- LOAD DATA ---------- */

async function loadData() {
  const admin = currentProfile.role === "Admin";

  const committeeSnap = await db
    .collection("committees")
    .orderBy("name")
    .get();

  committees = committeeSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  let reportQuery = db.collection("committeeReports");

  if (!admin) {
    reportQuery = reportQuery.where(
      "committeeId",
      "==",
      currentProfile.committeeId
    );
  }

  const reportSnap = await reportQuery.get();

  reports = reportSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  if (admin) {
    const userSnap = await db
      .collection("users")
      .orderBy("name")
      .get();

    users = userSnap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } else {
    users = [];
  }
}

/* ---------- RENDER ALL ---------- */

function renderAll() {
  renderDashboard();
  renderReport();
  renderSubmissions();

  if (currentProfile.role === "Admin") {
    renderCommittees();
    renderUsers();
  }
}

/* ---------- DASHBOARD ---------- */

function renderDashboard() {
  const admin = currentProfile.role === "Admin";

  if (admin) {
    let expected = 0;

    committees.forEach(committee => {
      expected += getRequiredDates(committee).length;
    });

    const submitted = reports.length;
    const missing = Math.max(0, expected - submitted);

    $("dashboardView").innerHTML = `
      <div class="section-head">
        <h2>Admin Dashboard</h2>
      </div>

      <div class="grid">
        <div class="metric">
          <strong>${committees.length}</strong>
          <span>Committees</span>
        </div>

        <div class="metric">
          <strong>${submitted}</strong>
          <span>Reports Submitted</span>
        </div>

        <div class="metric">
          <strong>${missing}</strong>
          <span>Reports Missing</span>
        </div>

        <div class="metric">
          <strong>${users.filter(
            u => u.role === "Executive Member"
          ).length}</strong>
          <span>Executive Members</span>
        </div>
      </div>

      <div class="panel">
        <h3>Weekly Committee Reporting</h3>
        <p class="muted">
          Each committee has its own recurring meeting day and
          time. A committee report is required every week,
          including weeks when the committee does not meet.
        </p>
      </div>
      <div class="panel"><h3>Missing Reports by Committee</h3>${committees.map(c => `<p><strong>${esc(c.name)}</strong> — ${getCommitteeMissingDates(c).length} missing ${getCommitteeMissingDates(c).slice(0,5).map(d => `<span class="badge missing">${esc(d)}</span>`).join(" ")}</p>`).join("") || "<p>No committees configured.</p>"}</div>
    `;

    return;
  }

  const committee = committees.find(
    c => c.id === currentProfile.committeeId
  );

  if (!committee) {
    $("dashboardView").innerHTML = `
      <div class="panel">
        <h2>No committee assigned</h2>
        <p class="muted">
          Ask an Admin to assign your account to a committee.
        </p>
      </div>
    `;

    return;
  }

  const missing = getCommitteeMissingDates(committee);
  const nextMeeting = getNextMeetingDate(committee);

  $("dashboardView").innerHTML = `
    <div class="section-head">
      <h2>${esc(committee.name)}</h2>
    </div>

    <div class="grid">
      <div class="metric">
        <strong>${reports.length}</strong>
        <span>Reports Submitted</span>
      </div>

      <div class="metric">
        <strong>${missing.length}</strong>
        <span>Reports Missing</span>
      </div>
    </div>

    <div class="panel">
      <h3>Committee Schedule</h3>
      <p>
        ${esc(committee.meetingDay || "Schedule not set")}
        ${
          committee.meetingTime
            ? ` at ${fmtTime(committee.meetingTime)}`
            : ""
        }
      </p>
    </div>

    <div class="panel">
      <h3>
        ${
          missing.length
            ? "Report Needed"
            : "Next Committee Meeting"
        }
      </h3>

      <p>
        ${
          missing.length
            ? fmtDate(missing[0])
            : nextMeeting
              ? fmtDate(nextMeeting)
              : "Schedule not configured."
        }
      </p>
    </div>
  `;
}

/* ---------- EXECUTIVE REPORT ---------- */

function getSelectedReportDate(committee) {
  const missing = getCommitteeMissingDates(committee);

  const eligible = getRequiredDates(committee);
  if (selectedReportDate && eligible.includes(selectedReportDate)) return selectedReportDate;
  if (missing.length) {
    return missing[0];
  }

  const required = getRequiredDates(committee);

  if (required.length) {
    return required[required.length - 1];
  }

  return null;
}

function renderReport() {
  if (currentProfile.role === "Admin") {
    $("reportView").innerHTML = "";
    return;
  }

  const committee = committees.find(
    c => c.id === currentProfile.committeeId
  );

  if (!committee) {
    $("reportView").innerHTML = `
      <div class="panel">
        <h2>No committee assigned</h2>
        <p class="muted">
          Ask an Admin to assign your account to a committee.
        </p>
      </div>
    `;

    return;
  }

  if (!committee.meetingDay || !committee.meetingTime) {
    $("reportView").innerHTML = `
      <div class="panel">
        <h2>Committee schedule not configured</h2>
        <p class="muted">
          An Admin must set your committee's weekly meeting
          day and time.
        </p>
      </div>
    `;

    return;
  }

  const meetingDate = getSelectedReportDate(committee);

  if (!meetingDate) {
    const next = getNextMeetingDate(committee);

    $("reportView").innerHTML = `
      <div class="panel">
        <h2>No report due yet</h2>
        <p class="muted">
          Your next scheduled meeting is
          ${next ? fmtDate(next) : "not available"}.
        </p>
      </div>
    `;

    return;
  }

  const existing = reports.find(
    r =>
      r.committeeId === committee.id &&
      r.meetingDate === meetingDate
  );

  $("reportView").innerHTML = `
    <div class="panel">

      <div class="section-head">
        <h2>Alpha Psi Chapter Committee Report</h2>
      </div>

      <label class="date-selector">Select Meeting Date
        <select id="reportDateSelect">${getRequiredDates(committee).slice().reverse().map(date => `<option value="${date}" ${date === meetingDate ? "selected" : ""}>${esc(fmtDate(date))}${reports.some(r => r.committeeId === committee.id && r.meetingDate === date) ? " · Submitted" : " · Missing"}</option>`).join("")}</select>
      </label>
      <form id="reportForm" class="form-grid">

        <label>
          Committee
          <input
            class="readonly"
            value="${esc(committee.name)}"
            readonly
          >
        </label>

        <label>
          Meeting Date
          <input
            class="readonly"
            value="${esc(fmtDate(meetingDate))}"
            readonly
          >
        </label>

        <label>
          Scheduled Meeting Time
          <input
            class="readonly"
            value="${esc(
              `${committee.meetingDay} at ${fmtTime(
                committee.meetingTime
              )}`
            )}"
            readonly
          >
        </label>

        <div>
          <span class="muted">Did you meet?</span>

          <div class="radio-row">

            <label>
              <input
                type="radio"
                name="didMeet"
                value="Yes"
                ${
                  existing?.didMeet === "Yes"
                    ? "checked"
                    : ""
                }
                required
              >
              YES
            </label>

            <label>
              <input
                type="radio"
                name="didMeet"
                value="No"
                ${
                  existing?.didMeet === "No"
                    ? "checked"
                    : ""
                }
              >
              No
            </label>

            <label>
              <input
                type="radio"
                name="didMeet"
                value="Other"
                ${
                  existing?.didMeet === "Other"
                    ? "checked"
                    : ""
                }
              >
              Other
            </label>

          </div>
        </div>

        <label
          id="otherReasonWrap"
          class="${
            existing?.didMeet === "Other"
              ? ""
              : "hidden"
          }"
        >
          Other
          <input
            id="didMeetOther"
            value="${esc(
              existing?.didMeetOther || ""
            )}"
          >
        </label>

        <label>
          Committee Head / Officer
          <input
            class="readonly"
            value="${esc(currentProfile.name)}"
            readonly
          >
        </label>

        <label>
          Other Members Attended
          <span class="muted">
            (one name per line)
          </span>

          <textarea id="attendees">${esc(
            (existing?.attendees || []).join("\n")
          )}</textarea>
        </label>

        <label>
          What was discussed in this meeting?

          <textarea
            id="discussion"
            required
          >${esc(existing?.discussion || "")}</textarea>
        </label>

        <label class="certify">
          <input
            id="certified"
            type="checkbox"
            ${existing?.certified ? "checked" : ""}
            required
          >

          <span>
            I certify that this report is accurate.
            My logged-in account and submission
            timestamp serve as my signature and date.
          </span>
        </label>

        <button class="primary" type="submit">
          ${existing ? "Update Report" : "Submit Report"}
        </button>

      </form>
    </div>
  `;

  $("reportDateSelect").onchange = e => { selectedReportDate = e.target.value; renderReport(); };

  document
    .querySelectorAll('input[name="didMeet"]')
    .forEach(radio => {
      radio.onchange = () => {
        const selected =
          document.querySelector(
            'input[name="didMeet"]:checked'
          )?.value;

        $("otherReasonWrap").classList.toggle(
          "hidden",
          selected !== "Other"
        );
      };
    });

  $("reportForm").onsubmit = async e => {
    e.preventDefault();

    const didMeet =
      document.querySelector(
        'input[name="didMeet"]:checked'
      )?.value;

    const attendees = $("attendees")
      .value
      .split("\n")
      .map(x => x.trim())
      .filter(Boolean);

    const data = {
      committeeId: committee.id,
      committeeName: committee.name,

      meetingId: meetingDate,
      meetingDate,

      scheduledDay: committee.meetingDay,
      scheduledTime: committee.meetingTime,

      didMeet,

      didMeetOther:
        didMeet === "Other"
          ? $("didMeetOther").value.trim()
          : "",

      committeeHead: currentProfile.name,

      attendees,

      discussion:
        $("discussion").value.trim(),

      certified:
        $("certified").checked,

      submittedBy:
        currentUser.uid,

      submittedByName:
        currentProfile.name,

      submittedAt:
        firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
      await db
        .doc(
          `committeeReports/${meetingDate}_${committee.id}`
        )
        .set(data, { merge: true });

      await loadData();
      renderAll();

      setMessage("Committee report saved.");
    } catch (err) {
      setMessage(err.message, "error");
    }
  };
}

/* ---------- SUBMISSIONS ---------- */

function renderSubmissions() {
  const admin = currentProfile.role === "Admin";

  if (!admin) {
    const rows = [...reports]
      .sort((a, b) =>
        (b.meetingDate || "").localeCompare(
          a.meetingDate || ""
        )
      )
      .map(
        r => `
          <tr>
            <td>${fmtDate(r.meetingDate)}</td>
            <td>${esc(r.didMeet)}</td>
            <td>${esc(r.discussion || "")}</td>
            <td>
              <span class="badge good">
                Submitted
              </span>
            </td>
          </tr>
        `
      )
      .join("");

    $("submissionsView").innerHTML = `
      <div class="panel">

        <div class="section-head">
          <h2>My Reports</h2>
        </div>

        <div class="table-wrap">
          <table>

            <thead>
              <tr>
                <th>Date</th>
                <th>Met?</th>
                <th>Discussion</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              ${
                rows ||
                `
                <tr>
                  <td colspan="4" class="muted">
                    No reports submitted yet.
                  </td>
                </tr>
                `
              }
            </tbody>

          </table>
        </div>
      </div>
    `;

    return;
  }

  const expected = [];

  committees.forEach(committee => {
    getRequiredDates(committee).forEach(date => {
      expected.push({
        committee,
        date
      });
    });
  });

  expected.sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  const visibleExpected = expected.filter(({committee,date}) => {
    const submitted = reports.some(r => r.committeeId === committee.id && r.meetingDate === date);
    return submissionsStatusFilter === "all" || (submissionsStatusFilter === "submitted" ? submitted : !submitted);
  });

  const rows = visibleExpected
    .map(({ committee, date }) => {
      const report = reports.find(
        r =>
          r.committeeId === committee.id &&
          r.meetingDate === date
      );

      return `
        <tr>
          <td>${fmtDate(date)}</td>

          <td>
            ${esc(committee.name)}
          </td>

          <td>
            ${esc(
              `${committee.meetingDay || "—"} ${
                committee.meetingTime
                  ? `at ${fmtTime(
                      committee.meetingTime
                    )}`
                  : ""
              }`
            )}
          </td>

          <td>
            ${
              report
                ? esc(
                    report.submittedByName || "—"
                  )
                : "—"
            }
          </td>

          <td>
            ${
              report
                ? `
                  <span class="badge good">
                    Submitted
                  </span>
                `
                : `
                  <span class="badge missing">
                    Missing
                  </span>
                `
            }
          </td>

          <td>
            ${
              report
                ? esc(report.discussion || "")
                : ""
            }
          </td>
        </tr>
      `;
    })
    .join("");

  $("submissionsView").innerHTML = `
    <div class="panel">

      <div class="section-head">
        <h2>All Committee Reports</h2><button id="exportReportsBtn" class="secondary" type="button">Export CSV</button><button id="printReportsBtn" class="secondary" type="button">Print / Save PDF</button>
        <label>Show <select id="submissionStatusFilter"><option value="all">All reports</option><option value="missing">Missing only</option><option value="submitted">Submitted only</option></select></label>
      </div>

      <div class="table-wrap">
        <table>

          <thead>
            <tr>
              <th>Meeting Date</th>
              <th>Committee</th>
              <th>Schedule</th>
              <th>Submitted By</th>
              <th>Status</th>
              <th>Discussion</th>
            </tr>
          </thead>

          <tbody>
            ${
              rows ||
              `
              <tr>
                <td colspan="6" class="muted">
                  Add committee schedules to begin
                  tracking weekly reports.
                </td>
              </tr>
              `
            }
          </tbody>

        </table>
      </div>
    </div>
  `;
  $("exportReportsBtn").onclick = () => {
    const fields = ["meetingDate","committeeName","scheduledDay","scheduledTime","submittedByName","didMeet","didMeetOther","attendees","discussion","certified"];
    const csv = [fields.join(","),...reports.map(r => fields.map(f => '"' + String(Array.isArray(r[f]) ? r[f].join("; ") : (r[f] ?? "")).replace(/"/g,'""') + '"').join(","))].join("\\r\\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})); link.download = "alpha-psi-committee-reports.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href),1000);
  };
  $("printReportsBtn").onclick = () => window.print();
  $("submissionStatusFilter").value = submissionsStatusFilter;
  $("submissionStatusFilter").onchange = e => { submissionsStatusFilter = e.target.value; renderSubmissions(); };
}

/* ---------- COMMITTEES ---------- */

function renderCommittees() {
  const rows = committees
    .map(
      committee => `
        <tr>
          <td>
            ${esc(committee.name)}
          </td>

          <td>
            ${esc(
              committee.meetingDay || "Not set"
            )}
          </td>

          <td>
            ${fmtTime(committee.meetingTime)}
          </td>

          <td>
            ${esc(
              committee.description || ""
            )}
          </td>

          <td>
            <button
              type="button"
              class="secondary editCommitteeBtn"
              data-id="${committee.id}"
            >
              Edit
            </button>
          </td>
        </tr>
      `
    )
    .join("");

  $("committeesView").innerHTML = `
    <div class="panel">

      <div class="section-head">
        <h2>Committees</h2>
      </div>

      <form
        id="committeeForm"
        class="form-grid"
      >

        <input
          id="editingCommitteeId"
          type="hidden"
        >

        <label>
          Committee Name

          <input
            id="committeeName"
            required
          >
        </label>

        <label>
          Weekly Meeting Day

          <select
            id="committeeDay"
            required
          >
            <option value="">
              Select day
            </option>

            <option value="Sunday">
              Sunday
            </option>

            <option value="Monday">
              Monday
            </option>

            <option value="Tuesday">
              Tuesday
            </option>

            <option value="Wednesday">
              Wednesday
            </option>

            <option value="Thursday">
              Thursday
            </option>

            <option value="Friday">
              Friday
            </option>

            <option value="Saturday">
              Saturday
            </option>

          </select>
        </label>

        <label>
          Weekly Meeting Time

          <input
            id="committeeTime"
            type="time"
            required
          >
        </label>

        <label>
          Description (optional)

          <input id="committeeDesc">
        </label>

        <button
          id="committeeSubmitBtn"
          class="primary"
          type="submit"
        >
          Add Committee
        </button>

        <button
          id="cancelCommitteeEdit"
          class="secondary hidden"
          type="button"
        >
          Cancel Edit
        </button>

      </form>
    </div>

    <div class="panel">

      <div class="table-wrap">

        <table>

          <thead>
            <tr>
              <th>Name</th>
              <th>Meeting Day</th>
              <th>Meeting Time</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            ${
              rows ||
              `
              <tr>
                <td
                  colspan="5"
                  class="muted"
                >
                  No committees yet.
                </td>
              </tr>
              `
            }
          </tbody>

        </table>
      </div>
    </div>
  `;

  document
    .querySelectorAll(".editCommitteeBtn")
    .forEach(button => {
      button.onclick = () => {
        const committee = committees.find(
          c => c.id === button.dataset.id
        );

        if (!committee) return;

        $("editingCommitteeId").value =
          committee.id;

        $("committeeName").value =
          committee.name || "";

        $("committeeDay").value =
          committee.meetingDay || "";

        $("committeeTime").value =
          committee.meetingTime || "";

        $("committeeDesc").value =
          committee.description || "";

        $("committeeSubmitBtn").textContent =
          "Save Committee";

        $("cancelCommitteeEdit")
          .classList.remove("hidden");
      };
    });

  $("cancelCommitteeEdit").onclick = () => {
    renderCommittees();
  };

  $("committeeForm").onsubmit = async e => {
    e.preventDefault();

    const name =
      $("committeeName").value.trim();

    const existingId =
      $("editingCommitteeId").value;

    const id = existingId || slug(name);

    if (!id) return;

    const existingCommittee =
      committees.find(c => c.id === id);

    const data = {
      name,

      meetingDay:
        $("committeeDay").value,

      meetingTime:
        $("committeeTime").value,

      description:
        $("committeeDesc").value.trim(),

      updatedAt:
        firebase.firestore.FieldValue.serverTimestamp()
    };

    /*
      Reports begin when the committee schedule
      is first configured. Editing the committee
      later will not reset its reporting history.
    */
    if (
      !existingCommittee?.trackingStartDate
    ) {
      data.trackingStartDate =
        localDateString(new Date());
    }

    if (!existingCommittee?.createdAt) {
      data.createdAt =
        firebase.firestore.FieldValue.serverTimestamp();
    }

    try {
      await db
        .doc(`committees/${id}`)
        .set(data, { merge: true });

      await loadData();
      renderAll();

      setMessage(
        existingCommittee
          ? "Committee updated."
          : "Committee added."
      );
    } catch (err) {
      setMessage(err.message, "error");
    }
  };
}

/* ---------- USERS ---------- */

function renderUsers() {
  const options = committees
    .map(
      committee => `
        <option value="${committee.id}">
          ${esc(committee.name)}
        </option>
      `
    )
    .join("");

  const rows = users
    .map(
      user => `
        <tr>
          <td>${esc(user.name)}</td>
          <td>${esc(user.email)}</td>
          <td>${esc(user.role)}</td>
          <td>
            ${esc(
              committees.find(
                c =>
                  c.id === user.committeeId
              )?.name || "—"
            )}
          </td>
          <td>${user.role === "Executive Member" ? `<button class="secondary editUserBtn" data-id="${esc(user.id)}">Change Assignment</button>` : "—"}</td>
        </tr>
      `
    )
    .join("");

  $("usersView").innerHTML = `
    <div class="panel"><h2>Import from Attendance Site</h2><p class="muted">Sign in with an Attendance Site Admin account to preview Executive Members. Import approved Executive profiles. Members can then create their Committee Reports login automatically using their Attendance credentials.</p><form id="attendanceImportForm" class="form-grid"><label>Attendance Admin email<input id="attendanceImportEmail" type="email" autocomplete="off" required></label><label>Attendance Admin password<input id="attendanceImportPassword" type="password" autocomplete="off" required></label><button class="primary" type="submit">Preview Executive Roster</button></form><div id="attendanceImportPreview"></div></div>
    <div class="panel">

      <div class="section-head">
        <h2>Add Executive Member</h2>
      </div>

      <form
        id="userForm"
        class="form-grid"
      >

        <label>
          Name
          <input
            id="newUserName"
            required
          >
        </label>

        <label>
          Email
          <input
            id="newUserEmail"
            type="email"
            required
          >
        </label>

        <label>
          Temporary Password
          <input
            id="newUserPassword"
            type="password"
            minlength="6"
            required
          >
        </label>

        <label>
          Committee

          <select
            id="newUserCommittee"
            required
          >
            <option value="">
              Choose committee…
            </option>

            ${options}
          </select>
        </label>

        <button
          class="primary"
          type="submit"
        >
          Create Executive Member
        </button>

      </form>
    </div>

    <div class="panel">

      <div class="table-wrap">

        <table>

          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Committee</th><th>Actions</th>
            </tr>
          </thead>

          <tbody>
            ${
              rows ||
              `
              <tr>
                <td
                  colspan="5"
                  class="muted"
                >
                  No users yet.
                </td>
              </tr>
              `
            }
          </tbody>

        </table>
      </div>
    </div>
  `;

  $("attendanceImportForm").onsubmit = async e => {
    e.preventDefault();
    const button = e.target.querySelector("button"); button.disabled = true;
    try {
      const roster = await AttendanceImport.loadRoster($("attendanceImportEmail").value.trim(), $("attendanceImportPassword").value);
      $("attendanceImportPassword").value = "";
      const existingEmails = new Set(users.map(u => String(u.email || "").toLowerCase()));
      const pending = roster.filter(m => !existingEmails.has(m.email));
      $("attendanceImportPreview").innerHTML = "<h3>Executive Members found: " + roster.length + "</h3><p>" + pending.length + " new profiles; existing users will not be overwritten.</p>" + pending.map(m => "<p>" + esc(m.name) + " — " + esc(m.email) + "</p>").join("") + (pending.length ? '<button id="confirmAttendanceImport" class="primary" type="button">Import Profiles</button>' : "");
      const confirm = $("confirmAttendanceImport");
      if (confirm) confirm.onclick = async () => {
        confirm.disabled = true;
        try {
          let imported = 0;
          for (const member of pending) {
            const id = "attendance-" + member.attendanceId.replace(/[^a-zA-Z0-9_-]/g, "");
            if (!member.attendanceId) continue;
            await db.collection("attendanceImports").doc(id).set({
              name: member.name, email: member.email, attendanceId: member.attendanceId,
              committee: member.committee, importedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, {merge:true});
            await db.collection("approvedExecutives").doc(member.email).set({
              name:member.name,email:member.email,attendanceId:member.attendanceId,
              active:true,approvedAt:firebase.firestore.FieldValue.serverTimestamp()
            },{merge:true});
            imported++;
          }
          setMessage(imported + " Executive profiles imported. Members can now sign in with their Attendance credentials; assign their committees in Users.");
          $("attendanceImportPreview").innerHTML = "";
        } catch (error) { setMessage(error.message, "error"); confirm.disabled = false; }
      };
    } catch (error) { setMessage(error.message, "error"); }
    finally { button.disabled = false; }
  };
  document.querySelectorAll(".editUserBtn").forEach(button => button.onclick = async () => {
    const user = users.find(u => u.id === button.dataset.id);
    if (!user) return;
    const choice = prompt("Enter the committee ID for " + user.name + ":\n" + committees.map(c => c.id + " — " + c.name).join("\n"), user.committeeId || "");
    if (choice === null) return;
    if (!committees.some(c => c.id === choice.trim())) { setMessage("Choose a valid committee ID.", "error"); return; }
    try { await db.doc(`users/${user.id}`).update({committeeId:choice.trim()}); await loadData(); renderAll(); setMessage("Committee assignment updated."); } catch (err) { setMessage(err.message,"error"); }
  });

  $("userForm").onsubmit = async e => {
    e.preventDefault();

    let secondary = null;

    try {
      secondary =
        firebase.initializeApp(
          firebaseConfig,
          `Secondary-${Date.now()}`
        );

      const cred =
        await secondary
          .auth()
          .createUserWithEmailAndPassword(
            $("newUserEmail")
              .value
              .trim(),

            $("newUserPassword").value
          );

      await db
        .doc(`users/${cred.user.uid}`)
        .set({
          name:
            $("newUserName")
              .value
              .trim(),

          email:
            $("newUserEmail")
              .value
              .trim(),

          role:
            "Executive Member",

          committeeId:
            $("newUserCommittee").value,

          createdAt:
            firebase.firestore.FieldValue.serverTimestamp()
        });

      await secondary.auth().signOut();
      await secondary.delete();

      await loadData();
      renderAll();

      setMessage(
        "Executive Member account created."
      );
    } catch (err) {
      try {
        if (secondary) {
          await secondary.auth().signOut();
          await secondary.delete();
        }
      } catch (_) {}

      setMessage(err.message, "error");
    }
  };
}
