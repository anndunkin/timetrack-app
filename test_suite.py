"""
TimeTrack v1.2.1 — Full Functionality + Security Test Suite
Run against a live server on port 5001.
"""
import urllib.request, urllib.error, json, os, sqlite3, sys, threading

BASE = "http://127.0.0.1:5001"
func_results = []
sec_results  = []

def req(method, path, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    hdrs = {"Content-Type":"application/json"} if data else {}
    r = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            raw = resp.read().decode()
            hdr = dict(resp.headers)
            try: parsed = json.loads(raw)
            except: parsed = raw
            return resp.status, parsed, hdr
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        hdr = dict(e.headers)
        try: parsed = json.loads(raw)
        except: parsed = raw
        return e.code, parsed, hdr

def ft(name, ok, detail=""):
    outcome = "PASS" if ok else "FAIL"
    func_results.append((outcome, name, detail))
    print(f"  [{outcome}] {name}" + (f"  — {detail}" if not ok else ""))

def st(name, ok, detail=""):
    outcome = "PASS" if ok else "FAIL"
    sec_results.append((outcome, name, detail))
    print(f"  [{outcome}] {name}" + (f"  — {detail}" if not ok else ""))

def api(method, path, body=None):
    s, d, h = req(method, path, body)
    return s, d, h

# ═══════════════════════════════════════════════════════════════════════════
print("\n══════════════════════════════════════════════════")
print("  TimeTrack v1.2.1 — Functionality Tests")
print("══════════════════════════════════════════════════\n")

# ── 1. SETTINGS ─────────────────────────────────────────────────────────────
print("── 1. Settings ──")
_, s, _ = api("GET", "/api/settings")
ft("GET /api/settings → 200",       isinstance(s, dict))
ft("yearStartMonth present",        "yearStartMonth" in s)
ft("yearStartDay present",          "yearStartDay" in s)
_, s2, _ = api("PUT", "/api/settings", {"yearStartMonth":7,"yearStartDay":1})
_, s3, _ = api("GET", "/api/settings")
ft("PUT persists yearStartMonth=7", s3.get("yearStartMonth")==7)
api("PUT", "/api/settings", {"yearStartMonth":1,"yearStartDay":1})
_, s4, _ = api("GET", "/api/settings")
ft("Reset to yearStartMonth=1",     s4.get("yearStartMonth")==1)

# ── 2. ORGANIZATIONS ─────────────────────────────────────────────────────────
print("\n── 2. Organizations ──")
_, ol, _ = api("GET", "/api/organizations")
ft("GET /api/organizations → list",   isinstance(ol, list))
_, o1, _ = api("POST", "/api/organizations", {"name":"Georgia Tech","color":"#B3A369"})
ft("POST creates org with id",        "id" in o1)
ft("POST org name stored correctly",  o1.get("name")=="Georgia Tech")
ft("POST org color stored",           o1.get("color")=="#B3A369")
OID1 = o1["id"]
_, o2, _ = api("POST", "/api/organizations", {"name":"Dunkin Global Advisors","color":"#01696F"})
ft("POST second org created",         "id" in o2)
OID2 = o2["id"]
api("PUT", f"/api/organizations/{OID1}", {"name":"Georgia Tech (GT)","color":"#B3A369"})
_, orgs, _ = api("GET", "/api/organizations")
ft("PUT updates org name",            any(o["name"]=="Georgia Tech (GT)" for o in orgs))
ft("Both orgs in list",               len([o for o in orgs if o["id"] in [OID1,OID2]])==2)

# ── 3. DEPARTMENTS ────────────────────────────────────────────────────────────
print("\n── 3. Departments ──")
_, d1, _ = api("POST", "/api/departments",
               {"name":"School of Cybersecurity","organizationId":OID1})
ft("POST dept with id",            "id" in d1)
ft("dept organizationId link",     d1.get("organizationId")==OID1)
DID1 = d1["id"]
_, d2, _ = api("POST", "/api/departments", {"name":"Advisory","organizationId":OID2})
ft("POST second dept",             "id" in d2)
DID2 = d2["id"]
_, byorg, _ = api("GET", f"/api/departments/by-org/{OID1}")
ft("by-org only returns org1",     all(x["organizationId"]==OID1 for x in byorg))
ft("by-org count correct",         len(byorg)==1)
api("PUT", f"/api/departments/{DID1}",
    {"name":"School of Cybersecurity & Privacy","organizationId":OID1})
_, depts, _ = api("GET", "/api/departments")
ft("PUT updates dept name",        any(d["name"]=="School of Cybersecurity & Privacy" for d in depts))

# ── 4. PROJECTS ───────────────────────────────────────────────────────────────
print("\n── 4. Projects ──")
_, p1, _ = api("POST", "/api/projects",
               {"name":"Curriculum Dev","color":"#20808D",
                "departmentIds":[DID1],"budgetHours":100})
ft("POST project with id",          "id" in p1)
ft("departmentIds is array",        isinstance(p1.get("departmentIds"),list))
ft("budgetHours stored",            p1.get("budgetHours")==100)
ft("project color stored",          p1.get("color")=="#20808D")
PID1 = p1["id"]
_, p2, _ = api("POST", "/api/projects",
               {"name":"Joint Research","color":"#964219",
                "departmentIds":[DID1,DID2]})
ft("POST multi-dept project",       len(p2.get("departmentIds",[]))==2)
PID2 = p2["id"]
_, bydept, _ = api("GET", f"/api/projects/by-department/{DID1}")
ft("by-department returns list",    isinstance(bydept,list) and len(bydept)>=1)
ft("by-department contains DID1",  all(DID1 in p["departmentIds"] for p in bydept))
api("PUT", f"/api/projects/{PID1}",
    {"name":"Curriculum Dev","color":"#20808D","departmentIds":[DID1],"budgetHours":120})
_, pf, _ = api("GET", "/api/projects")
ft("PUT updates budgetHours",       next((p for p in pf if p["id"]==PID1),{}).get("budgetHours")==120)

# ── 5. TIME ENTRIES ───────────────────────────────────────────────────────────
print("\n── 5. Time Entries ──")
_, te1, _ = api("POST", "/api/time-entries",
                {"date":"2026-04-01","minutes":90,"organizationId":OID1,
                 "departmentIds":[DID1],"projectId":PID1,"description":"Lecture prep"})
ft("POST entry with id",           "id" in te1)
ft("minutes stored correctly",     te1.get("minutes")==90)
ft("departmentIds is array",       isinstance(te1.get("departmentIds"),list))
ft("description stored",           te1.get("description")=="Lecture prep")
ft("date stored",                  te1.get("date")=="2026-04-01")
ft("organizationId linked",        te1.get("organizationId")==OID1)
TEID1 = te1["id"]
_, te2, _ = api("POST", "/api/time-entries",
                {"date":"2026-04-02","minutes":60,"organizationId":OID2,
                 "departmentIds":[DID2],"projectId":PID2,"description":"Client meeting"})
ft("POST entry for org2",          "id" in te2)
TEID2 = te2["id"]
_, te3, _ = api("POST", "/api/time-entries",
                {"date":"2026-04-08","minutes":120,"organizationId":OID1,
                 "departmentIds":[DID1,DID2],"projectId":PID2,
                 "description":"Joint session\nLine 2"})
ft("POST multi-dept entry",        "id" in te3)
ft("multi-line description",       "\n" in te3.get("description",""))
TEID3 = te3["id"]
_, week, _ = api("GET", "/api/time-entries?start=2026-04-01&end=2026-04-07")
ft("Date range filter returns list",    isinstance(week,list) and len(week)>=1)
ft("Date range excludes after end",     not any(e["date"]>"2026-04-07" for e in week))
ft("Date range includes start date",    any(e["date"]=="2026-04-01" for e in week))
api("PUT", f"/api/time-entries/{TEID1}",
    {"date":"2026-04-01","minutes":120,"organizationId":OID1,
     "departmentIds":[DID1],"projectId":PID1,"description":"Lecture prep (extended)"})
_, allte, _ = api("GET", "/api/time-entries?start=2026-04-01&end=2026-04-30")
ute = next((e for e in allte if e["id"]==TEID1),{})
ft("PUT updates minutes",          ute.get("minutes")==120)
ft("PUT updates description",      ute.get("description")=="Lecture prep (extended)")

# ── 5b. ENTRY HISTORY (pagination + edit-any-entry) ───────────────────────────
print("\n── 5b. Entry History (pagination + edit any entry) ──")

# Seed a batch of entries spread across several months so pagination and
# date-range filtering have something to work with. The oldest of these acts
# as a stand-in for an "old, non-recent" entry that must remain editable.
HIST_IDS = []
for i in range(1, 31):
    mo = ((i - 1) % 6) + 1            # months 1..6
    day = ((i - 1) % 27) + 1
    _, he, _ = api("POST", "/api/time-entries",
                   {"date": f"2025-{mo:02d}-{day:02d}", "minutes": 15 + i,
                    "organizationId": OID1, "departmentIds": [DID1],
                    "projectId": PID1, "description": f"History seed {i}"})
    if isinstance(he, dict) and "id" in he:
        HIST_IDS.append(he["id"])
ft("Seeded 30 history entries", len(HIST_IDS) == 30, f"only {len(HIST_IDS)}")
OLD_ENTRY_ID = min(HIST_IDS) if HIST_IDS else None  # earliest-created = oldest id

# Paginated envelope shape
_, pg1, _ = api("GET", "/api/time-entries?page=1&pageSize=10")
ft("Paged response is envelope dict", isinstance(pg1, dict))
ft("Envelope has entries array",      isinstance(pg1.get("entries"), list))
ft("Envelope has total count",        isinstance(pg1.get("total"), int))
ft("Page 1 returns pageSize rows",    len(pg1.get("entries", [])) == 10)
ft("Total reflects all entries",      pg1.get("total", 0) >= 30)
ft("Echoes page=1",                   pg1.get("page") == 1)
ft("Echoes pageSize=10",              pg1.get("pageSize") == 10)

# Page 2 is disjoint from page 1 (stable ordering, no overlap)
_, pg2, _ = api("GET", "/api/time-entries?page=2&pageSize=10")
ids1 = {e["id"] for e in pg1.get("entries", [])}
ids2 = {e["id"] for e in pg2.get("entries", [])}
ft("Page 2 distinct from page 1", len(ids1 & ids2) == 0 and len(ids2) == 10)

# Ordering: entries are newest-date first
dates_pg1 = [e["date"] for e in pg1.get("entries", [])]
ft("Page 1 sorted by date DESC", dates_pg1 == sorted(dates_pg1, reverse=True))

# pageSize clamping (>200 clamps to 200, <1 clamps to 1)
_, pgbig, _ = api("GET", "/api/time-entries?page=1&pageSize=9999")
ft("pageSize clamped to <=200", pgbig.get("pageSize", 0) <= 200)
_, pgzero, _ = api("GET", "/api/time-entries?page=0&pageSize=0")
ft("page clamped to >=1",       pgzero.get("page") == 1)
ft("pageSize clamped to >=1",   pgzero.get("pageSize", 0) >= 1)

# Date-range filter combined with pagination
_, pgr, _ = api("GET", "/api/time-entries?start=2025-01-01&end=2025-02-28&page=1&pageSize=50")
ft("Filtered+paged returns envelope", isinstance(pgr, dict) and isinstance(pgr.get("entries"), list))
ft("Filtered total <= overall total", pgr.get("total", 0) <= pg1.get("total", 0))
ft("Filtered rows within range",
   all("2025-01-01" <= e["date"] <= "2025-02-28" for e in pgr.get("entries", [])))

# Edit an OLD (non-recent) entry by id and confirm it persists
if OLD_ENTRY_ID is not None:
    s_edit, edited, _ = api("PUT", f"/api/time-entries/{OLD_ENTRY_ID}",
        {"date": "2025-01-05", "minutes": 222, "organizationId": OID1,
         "departmentIds": [DID1], "projectId": PID1,
         "description": "Edited old entry"})
    ft("Edit old entry → 200",        s_edit == 200)
    ft("Edit old entry minutes",      isinstance(edited, dict) and edited.get("minutes") == 222)
    ft("Edit old entry description",  isinstance(edited, dict) and edited.get("description") == "Edited old entry")
    # Confirm via a fresh fetch (broad range so the edited entry is included)
    _, allh, _ = api("GET", "/api/time-entries?start=2025-01-01&end=2025-12-31&page=1&pageSize=200")
    found = next((e for e in allh.get("entries", []) if e["id"] == OLD_ENTRY_ID), {})
    ft("Old-entry edit persisted in fetch", found.get("minutes") == 222)
else:
    for lbl in ["Edit old entry → 200", "Edit old entry minutes",
                "Edit old entry description", "Old-entry edit persisted in fetch"]:
        ft(lbl, False, "no old entry id")

# Validation still enforced when editing an arbitrary entry
if OLD_ENTRY_ID is not None:
    s_bad, _, _ = api("PUT", f"/api/time-entries/{OLD_ENTRY_ID}",
        {"date": "nope", "minutes": 30, "organizationId": OID1,
         "departmentIds": [DID1], "projectId": PID1})
    ft("Edit with bad date rejected (400)", s_bad == 400)
    s_neg, _, _ = api("PUT", f"/api/time-entries/{OLD_ENTRY_ID}",
        {"date": "2025-01-05", "minutes": -5, "organizationId": OID1,
         "departmentIds": [DID1], "projectId": PID1})
    ft("Edit with negative minutes rejected (400)", s_neg == 400)
    s_empty, _, _ = api("PUT", f"/api/time-entries/{OLD_ENTRY_ID}",
        {"date": "2025-01-05", "minutes": 30, "organizationId": OID1,
         "departmentIds": [], "projectId": PID1})
    ft("Edit with empty departmentIds rejected (400)", s_empty == 400)

# Invalid / non-numeric id guard on the update endpoint
s_invalid, _, _ = api("PUT", "/api/time-entries/abc",
    {"date": "2025-01-05", "minutes": 30, "organizationId": OID1,
     "departmentIds": [DID1], "projectId": PID1})
ft("Edit with non-numeric id rejected (400)", s_invalid == 400)

# ── 6. RECURRING TASKS ────────────────────────────────────────────────────────
print("\n── 6. Recurring Tasks ──")
_, rt1, _ = api("POST", "/api/recurring",
                {"organizationId":OID1,"departmentIds":[DID1],"projectId":PID1,
                 "description":"Weekly standup","minutes":30,"frequency":"weekly",
                 "startDate":"2026-03-02","enabled":1})
ft("POST weekly recurring task",       "id" in rt1)
ft("frequency=weekly stored",          rt1.get("frequency")=="weekly")
ft("enabled=1 stored",                 rt1.get("enabled")==1)
ft("startDate stored",                 rt1.get("startDate")=="2026-03-02")
RTID1 = rt1["id"]
_, rt2, _ = api("POST", "/api/recurring",
                {"organizationId":OID2,"departmentIds":[DID2],"projectId":PID2,
                 "description":"Monthly report","minutes":60,"frequency":"monthly",
                 "startDate":"2026-01-15","enabled":1})
ft("POST monthly recurring task",      "id" in rt2)
RTID2 = rt2["id"]
_, rtl, _ = api("GET", "/api/recurring")
ft("GET /api/recurring returns list",  isinstance(rtl,list) and len(rtl)>=2)
api("PUT", f"/api/recurring/{RTID1}",
    {"enabled":0,"organizationId":OID1,"departmentIds":[DID1],"projectId":PID1,
     "description":"Weekly standup","minutes":30,"frequency":"weekly","startDate":"2026-03-02"})
_, rtl2, _ = api("GET", "/api/recurring")
ft("PUT disables task (enabled=0)",    next((r for r in rtl2 if r["id"]==RTID1),{}).get("enabled")==0)
_, rr, _ = api("POST", "/api/recurring/run")
ft("POST /api/recurring/run succeeds", isinstance(rr,(dict,list)))
_, after, _ = api("GET", "/api/time-entries?start=2026-01-01&end=2026-04-30")
monthly = [e for e in after if e.get("description")=="Monthly report"]
ft("Monthly recurrence generated ≥3 past entries", len(monthly)>=3)
print(f"  [INFO] Monthly recurring generated {len(monthly)} entries (Jan–Apr)")

# ── 7. ORG EXPORT ─────────────────────────────────────────────────────────────
print("\n── 7. Org Export ──")
EPATH = "/tmp/test-org-export.db"
if os.path.exists(EPATH): os.remove(EPATH)
_, ex, _ = api("POST", f"/api/organizations/{OID1}/export", {"path":EPATH})
ft("Export returns ok=True",          ex.get("ok")==True)
ft("Export file created on disk",     os.path.exists(EPATH))
if os.path.exists(EPATH):
    ft("Export file > 4 KB",          os.path.getsize(EPATH)>4096)
    conn = sqlite3.connect(EPATH)
    ex_orgs    = conn.execute("SELECT id FROM organizations").fetchall()
    ex_depts   = conn.execute("SELECT id FROM departments").fetchall()
    ex_proj    = conn.execute("SELECT id FROM projects").fetchall()
    ex_entries = conn.execute("SELECT organization_id FROM time_entries").fetchall()
    ex_recur   = conn.execute("SELECT id FROM recurring_tasks").fetchall()
    conn.close()
    ft("Export contains exactly 1 org",     len(ex_orgs)==1)
    ft("Export org id = OID1",              ex_orgs[0][0]==OID1)
    ft("Export contains org1 departments",  len(ex_depts)>=1)
    ft("Export contains projects",          len(ex_proj)>=1)
    ft("Export entries all belong to org1", all(r[0]==OID1 for r in ex_entries))
    ft("Export excludes org2 entries",      not any(r[0]==OID2 for r in ex_entries))
    ft("Export contains recurring tasks",   len(ex_recur)>=1)
    print(f"  [INFO] Export: {len(ex_orgs)} org, {len(ex_depts)} depts, "
          f"{len(ex_proj)} projs, {len(ex_entries)} entries, {len(ex_recur)} recurring")
else:
    for lbl in ["Export file > 4 KB","Export contains exactly 1 org","Export org id = OID1",
                "Export contains org1 departments","Export contains projects",
                "Export entries all belong to org1","Export excludes org2 entries",
                "Export contains recurring tasks"]:
        ft(lbl, False, "file not created")

# ── 8. DELETES ────────────────────────────────────────────────────────────────
print("\n── 8. Delete Operations ──")
api("DELETE", f"/api/time-entries/{TEID3}")
_, tefin, _ = api("GET", "/api/time-entries?start=2026-01-01&end=2026-12-31")
ft("Deleted time entry gone",      not any(e["id"]==TEID3 for e in tefin))
api("DELETE", f"/api/recurring/{RTID2}")
_, rtfin, _ = api("GET", "/api/recurring")
ft("Deleted recurring task gone",  not any(r["id"]==RTID2 for r in rtfin))
api("DELETE", f"/api/projects/{PID2}")
_, pfin, _ = api("GET", "/api/projects")
ft("Deleted project gone",         not any(p["id"]==PID2 for p in pfin))
api("DELETE", f"/api/departments/{DID2}")
_, dfin, _ = api("GET", "/api/departments")
ft("Deleted department gone",      not any(d["id"]==DID2 for d in dfin))
api("DELETE", f"/api/organizations/{OID2}")
_, ofin, _ = api("GET", "/api/organizations")
ft("Deleted organization gone",    not any(o["id"]==OID2 for o in ofin))

# ═══════════════════════════════════════════════════════════════════════════
print("\n══════════════════════════════════════════════════")
print("  TimeTrack v1.2.1 — Security Tests")
print("══════════════════════════════════════════════════\n")

_, _, HDR = req("GET", "/api/organizations")

# ── A. SECURITY HEADERS ───────────────────────────────────────────────────────
print("── A. Security Headers ──")
st("X-Content-Type-Options: nosniff",    HDR.get("X-Content-Type-Options","").lower()=="nosniff")
st("X-Frame-Options: DENY",             HDR.get("X-Frame-Options","").upper()=="DENY")
csp = HDR.get("Content-Security-Policy","")
st("CSP header present",                len(csp)>0)
st("CSP: default-src 'self'",           "default-src 'self'" in csp)
st("CSP: script-src 'self'",            "script-src 'self'" in csp)
st("CSP: connect-src 'self'",           "connect-src 'self'" in csp)
st("CSP: img-src 'self' data:",         "img-src 'self' data:" in csp)
_, _, POST_HDR = req("POST", "/api/organizations", {"name":"HdrTest","color":"#aaa"})
st("Security headers on POST",          POST_HDR.get("X-Content-Type-Options","").lower()=="nosniff")
_, hall, _ = req("GET", "/api/organizations")
for o in (hall if isinstance(hall,list) else []):
    if o.get("name")=="HdrTest": req("DELETE", f"/api/organizations/{o['id']}")

# ── B. PATH TRAVERSAL ─────────────────────────────────────────────────────────
print("\n── B. Path Traversal Validation ──")
for bad in ["../../../etc/passwd.db","..\\..\\evil.db","/tmp/valid/../../../etc/passwd.db",
            "not-a-db.txt",""]:
    s, _, _ = req("POST", "/api/files/switch", {"path":bad})
    st(f"files/switch rejects '{bad[:30]}'", s==400)
for bad in ["../evil.db","C:\\Windows\\system32\\evil.db"]:
    s, _, _ = req("POST", "/api/files/save-as", {"path":bad})
    st(f"files/save-as rejects '{bad}'", s==400)

# ── C. EXPORT PATH VALIDATION ─────────────────────────────────────────────────
print("\n── C. Export Path Validation ──")
s, _, _ = req("POST", f"/api/organizations/{OID1}/export", {"path":"../evil.db"})
st("Export rejects traversal path",   s==400)
s, _, _ = req("POST", f"/api/organizations/{OID1}/export", {"path":"noextension"})
st("Export rejects non-.db path",     s==400)
s, _, _ = req("POST", f"/api/organizations/{OID1}/export", {})
st("Export rejects missing path",     s==400)
s, _, _ = req("POST", "/api/organizations/99999/export", {"path":"/tmp/ghost.db"})
st("Export rejects nonexistent org",  s in (400,404,500))

# ── D. INPUT VALIDATION ───────────────────────────────────────────────────────
print("\n── D. Input Validation ──")
s, _, _ = req("POST", "/api/organizations", {"name":"","color":"#aaa"})
st("Empty org name rejected",         s==400)
s, _, _ = req("POST", "/api/organizations", {"color":"#aaa"})
st("Missing org name rejected",       s==400)
s, _, _ = req("POST", "/api/departments", {"name":"NullOrg"})
st("Missing orgId in dept rejected",  s==400)
s, _, _ = req("POST", "/api/time-entries",
              {"date":"not-a-date","minutes":60,"organizationId":OID1,
               "departmentIds":[DID1],"projectId":PID1})
st("Invalid date format rejected",    s==400)
s, _, _ = req("POST", "/api/time-entries",
              {"date":"2026-04-01","minutes":-10,"organizationId":OID1,
               "departmentIds":[DID1],"projectId":PID1})
st("Negative minutes rejected",       s==400)
s, _, _ = req("PUT", "/api/settings", {"yearStartMonth":13,"yearStartDay":1})
st("yearStartMonth=13 rejected",      s==400)
s, _, _ = req("PUT", "/api/settings", {"yearStartMonth":0,"yearStartDay":1})
st("yearStartMonth=0 rejected",       s==400)
s, _, _ = req("POST", "/api/recurring",
              {"organizationId":OID1,"departmentIds":[DID1],"projectId":PID1,
               "description":"bad","minutes":30,"frequency":"hourly",
               "startDate":"2026-01-01","enabled":1})
st("Invalid recur frequency rejected", s==400)

# ── E. SQL INJECTION ──────────────────────────────────────────────────────────
print("\n── E. SQL Injection Probes ──")
injects = [
    "'; DROP TABLE organizations; --",
    "\" OR 1=1 --",
    "Robert'); DROP TABLE students;--",
    "1; SELECT * FROM sqlite_master--",
]
for name in injects:
    s, d, _ = req("POST", "/api/organizations", {"name":name,"color":"#aaa"})
    # Must not 500; if created, data should be stored literally
    st(f"Injection handled safely: {name[:40]}", s!=500)
    if s in (200,201) and isinstance(d,dict) and "id" in d:
        _, check, _ = req("GET", "/api/organizations")
        if isinstance(check,list):
            match = next((o for o in check if o["id"]==d["id"]),None)
            if match:
                st(f"Injection stored literally (not executed): {name[:30]}",
                   match.get("name")==name)
        req("DELETE", f"/api/organizations/{d['id']}")

_, orgs_after, _ = req("GET", "/api/organizations")
st("DB intact after injection probes", isinstance(orgs_after,list) and len(orgs_after)>=1)

# Injection probes against the History pagination/date-range query params.
# Malicious strings must not 500 or alter/leak data — params are bound, not
# string-concatenated. Numeric params coerce to safe defaults; the date filter
# is bound as a literal so it simply matches nothing.
from urllib.parse import quote
for bad in ["1; DROP TABLE time_entries; --", "1 OR 1=1", "abc", "-1"]:
    s, _, _ = req("GET", f"/api/time-entries?page={quote(bad)}&pageSize=5")
    st(f"History page param safe: {bad[:30]}", s == 200)
# The date filter is a BOUND literal, so an injected "' OR '1'='1" is compared
# as a plain string — it is never executed as SQL. It must (a) never 500,
# (b) never drop the table, and (c) never return MORE rows than the full
# unfiltered total (i.e. it can't bypass the WHERE to leak everything).
_, full_te, _ = req("GET", "/api/time-entries?page=1&pageSize=1")
overall_total = full_te.get("total", 0) if isinstance(full_te, dict) else 0
for bad in ["2025-01-01' OR '1'='1", "'; DROP TABLE time_entries; --"]:
    s, d, _ = req("GET", f"/api/time-entries?start={quote(bad)}&end=2025-12-31&page=1&pageSize=5")
    st(f"History date filter safe: {bad[:30]}",
       s == 200 and isinstance(d, dict)
       and isinstance(d.get("total"), int)
       and d.get("total") <= overall_total)
_, te_intact, _ = req("GET", "/api/time-entries?page=1&pageSize=1")
st("time_entries table intact after probes",
   isinstance(te_intact, dict) and isinstance(te_intact.get("entries"), list)
   and te_intact.get("total", 0) >= 30)

# ── F. 404 HANDLING ───────────────────────────────────────────────────────────
print("\n── F. Not-Found Handling ──")
s, _, _ = req("PUT",    "/api/organizations/99999", {"name":"x","color":"#aaa"})
st("PUT nonexistent org → 404",         s==404)
s, _, _ = req("DELETE", "/api/organizations/99999")
st("DELETE nonexistent org → 404",      s==404)
s, _, _ = req("DELETE", "/api/time-entries/99999")
st("DELETE nonexistent entry → 404",    s==404)
s, _, _ = req("DELETE", "/api/departments/99999")
st("DELETE nonexistent dept → 404",     s==404)
s, _, _ = req("DELETE", "/api/projects/99999")
st("DELETE nonexistent project → 404",  s==404)

# ── G. CONCURRENT WRITE SAFETY ────────────────────────────────────────────────
print("\n── G. Concurrent Write Safety ──")
errors_c, created_c = [], []
def make_entry(i):
    try:
        s, d, _ = req("POST", "/api/time-entries",
                      {"date":f"2026-03-{i:02d}","minutes":30,"organizationId":OID1,
                       "departmentIds":[DID1],"projectId":PID1,"description":f"Concurrent {i}"})
        if s in (200,201) and isinstance(d,dict) and "id" in d:
            created_c.append(d["id"])
        else:
            errors_c.append(f"entry {i}: status {s}")
    except Exception as ex:
        errors_c.append(str(ex))

threads = [threading.Thread(target=make_entry, args=(i,)) for i in range(1,11)]
for t in threads: t.start()
for t in threads: t.join()
st("10 concurrent writes — no server errors", len(errors_c)==0,
   ", ".join(errors_c) if errors_c else "")
st("All 10 entries created successfully",     len(created_c)==10,
   f"only {len(created_c)}" if len(created_c)!=10 else "")
for eid in created_c: req("DELETE", f"/api/time-entries/{eid}")

# ═══════════════════════════════════════════════════════════════════════════
fp = sum(1 for r in func_results if r[0]=="PASS")
ff = sum(1 for r in func_results if r[0]=="FAIL")
sp = sum(1 for r in sec_results  if r[0]=="PASS")
sf = sum(1 for r in sec_results  if r[0]=="FAIL")
ft_total = len(func_results)
st_total = len(sec_results)

print(f"\n{'═'*52}")
print(f"  Functionality : {fp}/{ft_total} passed  |  {ff} failed")
print(f"  Security      : {sp}/{st_total} passed  |  {sf} failed")
print(f"  Overall       : {fp+sp}/{ft_total+st_total} passed")
print(f"{'═'*52}")

all_failed = [(r,"FUNC") for r in func_results if r[0]=="FAIL"] + \
             [(r,"SEC")  for r in sec_results  if r[0]=="FAIL"]
if all_failed:
    print("\n  Failed:")
    for r, kind in all_failed:
        print(f"    [{kind}] ✗ {r[1]}: {r[2]}")

with open("/tmp/test_results.json","w") as f:
    json.dump({"functionality":{"passed":fp,"failed":ff,"total":ft_total},
               "security":{"passed":sp,"failed":sf,"total":st_total},
               "func_details":func_results,"sec_details":sec_results}, f)

sys.exit(0 if (ff+sf)==0 else 1)
