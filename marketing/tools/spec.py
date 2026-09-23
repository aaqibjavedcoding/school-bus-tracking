"""KidBus marketing videos — copy + scene spec (source of truth).

Owner: ZeroMileSystems.com  |  Product: KidBus
Voice: female, English (Indian), one VO file per video.
Every scene has a word-weight `w`; scene durations are derived from it so the
on-screen feature text tracks the narration.
"""

BRAND = {
    "product": "KidBus",
    "company": "ZeroMileSystems.com",
    "email": "zeromilesystems@gmail.com",
    "tagline": "School transport, completely visible.",
    "cta": "Free pilot for your school",
}

NAVY = (15, 23, 42)
NAVY_DEEP = (6, 11, 25)
GOLD = (245, 166, 35)
AMBER = (245, 158, 11)

ACCENTS = {
    "gold": ((245, 166, 35), (253, 224, 71)),
    "amber": ((217, 119, 6), (252, 211, 77)),
    "green": ((22, 163, 74), (74, 222, 128)),
    "red": ((220, 38, 38), (252, 165, 165)),
    "blue": ((37, 99, 235), (147, 197, 253)),
    "slate": ((71, 85, 105), (203, 213, 225)),
}

VIDEOS = [
    # ------------------------------------------------------------------ 15s
    {
        "id": "K1_15s_live_tracking",
        "title": "Live GPS tracking",
        "duration": 15.0,
        "vo": (
            "Where is my child's bus? KidBus shows the live location and the exact ETA for every stop. "
            "Safer journeys, calmer mornings. KidBus, by ZeroMileSystems.com."
        ),
        "scenes": [
            {
                "img": "01-hook-mother",
                "motion": "zoom_in",
                "accent": "gold",
                "hl": "7:00 AM.",
                "chips": [],
                "cap": ("EVERY PARENT'S QUESTION", "Where is my child's bus right now?"),
                "w": 9,
            },
            {
                "img": "07-mockup-screen",
                "motion": "zoom_out",
                "accent": "blue",
                "hl": "Live GPS tracking",
                "chips": ["Live map", "Breadcrumb trail", "Exact bus & driver"],
                "cap": ("LIVE TRACKING", "Watch the bus move, second by second"),
                "w": 10,
                "ding": True,
            },
            {
                "img": "06-bus-street",
                "motion": "pan_left",
                "accent": "green",
                "hl": "ETA for every stop",
                "chips": ["Next stop", "Auto-recomputed", "Geofence arrival"],
                "cap": ("SMART ETA", "Know the exact arrival time"),
                "w": 10,
            },
            {
                "img": "04-reunion",
                "motion": "zoom_in",
                "accent": "green",
                "hl": "Calmer mornings",
                "chips": ["No more waiting calls"],
                "cap": ("PEACE OF MIND", "Safer journeys, calmer mornings"),
                "w": 8,
            },
            {"kind": "cta", "w": 8},
        ],
    },
    # ------------------------------------------------------------------ 20s
    {
        "id": "K2_20s_boarding_verification",
        "title": "Boarding & drop verification",
        "duration": 20.0,
        "vo": (
            "Is my child really on the bus? KidBus verifies every boarding and every drop "
            "in one tap by the conductor, and sends parents an instant alert the moment it happens. "
            "No registers. No phone calls. KidBus, by ZeroMileSystems.com."
        ),
        "scenes": [
            {
                "img": "03-boarding",
                "motion": "zoom_in",
                "accent": "gold",
                "hl": "Boarding. Verified.",
                "chips": ["One tap", "No registers"],
                "cap": ("CONDUCTOR APP", "Every child is marked as boarded"),
                "w": 11,
            },
            {
                "img": "01-hook-mother",
                "motion": "zoom_in",
                "accent": "green",
                "hl": "Instant parent alert",
                "chips": ["Push notification", "In-app centre"],
                "cap": ("PARENTS NOTIFIED", "The moment it happens"),
                "w": 13,
                "ding": True,
            },
            {
                "img": "06-bus-street",
                "motion": "pan_right",
                "accent": "blue",
                "hl": "Right child. Right stop.",
                "chips": ["Manifest by stop", "Live summary"],
                "cap": ("MANIFEST", "Roster ordered by stop sequence"),
                "w": 12,
            },
            {
                "img": "02-office-chaos",
                "motion": "zoom_out",
                "accent": "green",
                "hl": "No registers. No calls.",
                "chips": ["Tamper-proof trail", "One-tap drops"],
                "cap": ("ZERO PAPERWORK", "Boarded to dropped, fully logged"),
                "w": 11,
            },
            {"kind": "cta", "w": 8},
        ],
    },
    # ------------------------------------------------------------------ 30s
    {
        "id": "K3_30s_sos_compliance",
        "title": "SOS & emergency response",
        "duration": 30.0,
        "vo": (
            "A medical emergency. A breakdown. A security concern. KidBus puts one SOS button "
            "in the driver's hand. The alarm reaches every school admin instantly, with the bus, "
            "the trip and the live location attached. An alarm sounds on the admin's screen until "
            "someone responds. Status moves from open, to acknowledged, to resolved. Plus automatic "
            "expiry alerts for insurance, fitness and driving licences. KidBus, by ZeroMileSystems.com."
        ),
        "scenes": [
            {
                "img": "05-driver-cab",
                "motion": "zoom_in",
                "accent": "red",
                "hl": "One tap. SOS.",
                "chips": ["Accident", "Breakdown", "Medical", "Security"],
                "cap": ("CREW PANIC BUTTON", "Bus, trip & live location attached"),
                "w": 10,
            },
            {
                "img": "02-office-chaos",
                "motion": "zoom_out",
                "accent": "red",
                "hl": "Admin alarm, instantly",
                "chips": ["Siren on screen", "Web + mobile", "Repeat until muted"],
                "cap": ("EMERGENCY BROADCAST", "Every school admin, at once"),
                "w": 14,
                "ding": True,
                "flash": [0.4, 2.8, 0.6],
            },
            {
                "img": "06-bus-street",
                "motion": "pan_left",
                "accent": "amber",
                "hl": "A trail you can prove",
                "chips": ["Open", "Acknowledged", "Resolved"],
                "cap": ("CLEAR STATUS", "From raised to resolved, logged"),
                "w": 14,
            },
            {
                "img": "05-driver-cab",
                "motion": "pan_right",
                "accent": "blue",
                "hl": "Compliance on autopilot",
                "chips": ["Insurance", "Fitness", "Licences", "30-day alerts"],
                "cap": ("DOCUMENTS", "Expiry alerts before it lapses"),
                "w": 12,
            },
            {
                "img": "04-reunion",
                "motion": "zoom_in",
                "accent": "green",
                "hl": "Safety, end to end",
                "chips": ["Parents trust it", "Schools prove it"],
                "cap": ("EMERGENCY READY", "Compliance proof, every day"),
                "w": 8,
            },
            {"kind": "cta", "w": 8},
        ],
    },
    # ------------------------------------------------------------------ 20s
    {
        "id": "K4_20s_compliance_documents",
        "title": "Bus & driver document compliance",
        "duration": 20.0,
        "vo": (
            "Insurance expiring next week? Fitness certificate missing? KidBus tracks every bus "
            "and driver document with automatic alerts, thirty days before expiry. One school-wide "
            "compliance overview. No more lost files. KidBus, by ZeroMileSystems.com."
        ),
        "scenes": [
            {
                "img": "02-office-chaos",
                "motion": "zoom_in",
                "accent": "red",
                "hl": "Insurance expiring?",
                "chips": ["Fitness due", "Licence lapse"],
                "cap": ("THE PAPER TRAP", "One missed date grounds a bus"),
                "w": 10,
            },
            {
                "img": "05-driver-cab",
                "motion": "pan_right",
                "accent": "gold",
                "hl": "Documents, tracked",
                "chips": ["Bus + driver", "Upload in seconds"],
                "cap": ("DIGITAL STORE", "RC, insurance, permit, licence"),
                "w": 12,
            },
            {
                "img": "07-mockup-screen",
                "motion": "zoom_out",
                "accent": "blue",
                "hl": "30-day expiry alerts",
                "chips": ["Valid", "Expiring soon", "Expired"],
                "cap": ("AUTO STATUS", "Derived from the expiry date"),
                "w": 13,
                "ding": True,
            },
            {
                "img": "06-bus-street",
                "motion": "zoom_in",
                "accent": "green",
                "hl": "School-wide overview",
                "chips": ["Per-bus", "Per-driver"],
                "cap": ("COMPLIANCE READY", "Always inspection-ready"),
                "w": 10,
            },
            {"kind": "cta", "w": 8},
        ],
    },
    # ------------------------------------------------------------------ 30s
    {
        "id": "K5_30s_school_operations",
        "title": "For schools: import, reports, subscriptions",
        "duration": 30.0,
        "vo": (
            "Running a school transport desk should not mean registers and phone calls. KidBus imports "
            "your students, parents, buses and routes from Excel in minutes, exports any report in one "
            "click, and gives you attendance, trip and bus utilisation data. One dashboard for your "
            "entire fleet. Every school gets its own subscription plan, limits and privacy. "
            "KidBus, by ZeroMileSystems.com."
        ),
        "scenes": [
            {
                "img": "02-office-chaos",
                "motion": "zoom_in",
                "accent": "red",
                "hl": "Registers & phone calls?",
                "chips": ["Paper attendance", "Follow-up calls"],
                "cap": ("THE TRANSPORT DESK", "There is a better way"),
                "w": 11,
            },
            {
                "img": "06-bus-street",
                "motion": "pan_left",
                "accent": "gold",
                "hl": "Excel in. Minutes out.",
                "chips": ["Students", "Parents", "Buses", "Routes"],
                "cap": ("BULK IMPORT", "Validate, review, then commit"),
                "w": 16,
            },
            {
                "img": "07-mockup-screen",
                "motion": "zoom_out",
                "accent": "blue",
                "hl": "Any report, one click",
                "chips": ["Attendance", "Trips", "Bus utilisation"],
                "cap": ("EXPORTS", "Excel or CSV, always in sync"),
                "w": 16,
            },
            {
                "img": "01-hook-mother",
                "motion": "zoom_in",
                "accent": "green",
                "hl": "Every school, its own plan",
                "chips": ["Usage limits", "Tenant isolation", "Data privacy"],
                "cap": ("SUBSCRIPTIONS", "Per-school plans and limits"),
                "w": 14,
            },
            {
                "img": "04-reunion",
                "motion": "zoom_in",
                "accent": "gold",
                "hl": "Built for Indian schools",
                "chips": ["Web + mobile", "Trained in a day"],
                "cap": ("ZEROMILESYSTEMS", "Made in India, for India"),
                "w": 9,
            },
            {"kind": "cta", "w": 8},
        ],
    },
    # ------------------------------------------------------------------ 30s
    {
        "id": "K6_30s_all_in_one",
        "title": "Everything in one platform",
        "duration": 30.0,
        "vo": (
            "One platform for your entire school transport operation. Live GPS tracking, boarding and "
            "drop verification, ETA and stop arrivals, SOS with an admin siren, compliance documents, "
            "and one-click reports. For school admins, drivers, conductors and parents. On web, on "
            "mobile, and in Hindi for your crew. One app your whole school can actually use. "
            "KidBus, by ZeroMileSystems.com."
        ),
        "scenes": [
            {
                "img": "06-bus-street",
                "motion": "zoom_in",
                "accent": "gold",
                "hl": "Your whole fleet. One app.",
                "chips": ["Admins", "Drivers", "Conductors", "Parents"],
                "cap": ("THE KIDBUS PLATFORM", "Every role, one system"),
                "w": 11,
            },
            {
                "img": "07-mockup-screen",
                "motion": "zoom_out",
                "accent": "blue",
                "hl": "Live GPS tracking",
                "chips": ["Live map", "ETA", "Stop arrivals"],
                "cap": ("TRACKING", "Room-scoped privacy by default"),
                "w": 12,
                "ding": True,
            },
            {
                "img": "03-boarding",
                "motion": "zoom_in",
                "accent": "green",
                "hl": "Boarding & drops",
                "chips": ["One tap", "Parent alerts", "Hindi + voice"],
                "cap": ("ATTENDANCE", "Verified, never assumed"),
                "w": 11,            },
            {
                "img": "05-driver-cab",
                "motion": "pan_right",
                "accent": "red",
                "hl": "SOS with a siren",
                "chips": ["Panic button", "Admin alarm"],
                "cap": ("EMERGENCY", "Response in seconds"),
                "w": 11,
            },
            {
                "img": "02-office-chaos",
                "motion": "pan_left",
                "accent": "blue",
                "hl": "Documents & reports",
                "chips": ["Expiry alerts", "15 reports", "Excel export"],
                "cap": ("COMPLIANCE + INSIGHT", "Audit-ready, always"),
                "w": 14,
            },
            {"kind": "cta", "w": 8},
        ],
    },
    # ------------------------------------------------------------------ 20s
    {
        "id": "K7_20s_geofence_eta",
        "title": "Geofenced stops & smart ETA",
        "duration": 20.0,
        "vo": (
            "Your bus enters the stop geofence, and every waiting parent is notified instantly. "
            "KidBus calculates an ETA for every remaining stop and marks arrivals automatically. "
            "Drivers drive. The system does the talking. KidBus, by ZeroMileSystems.com."
        ),
        "scenes": [
            {
                "img": "06-bus-street",
                "motion": "zoom_in",
                "accent": "gold",
                "hl": "Geofence arrival",
                "chips": ["Stop radius", "Auto-detected"],
                "cap": ("NO MANUAL MARKS", "Arrival is logged automatically"),
                "w": 12,
            },
            {
                "img": "01-hook-mother",
                "motion": "zoom_in",
                "accent": "green",
                "hl": "Parents notified",
                "chips": ["Push + in-app"],
                "cap": ("INSTANT ALERT", "\"Your stop is next\" - without a single call"),
                "w": 11,
                "ding": True,
            },
            {
                "img": "07-mockup-screen",
                "motion": "zoom_out",
                "accent": "blue",
                "hl": "ETA to every stop",
                "chips": ["Live GPS speed", "Recomputed per fix"],
                "cap": ("SMART ETA", "Approximate, honest, live"),
                "w": 13,
            },
            {
                "img": "05-driver-cab",
                "motion": "pan_right",
                "accent": "gold",
                "hl": "Drivers drive.",
                "chips": ["Fewer calls", "Clear manifest"],
                "cap": ("THE SYSTEM TALKS", "Less radio chatter, safer roads"),
                "w": 10,
            },
            {"kind": "cta", "w": 8},
        ],
    },
    # ------------------------------------------------------------------ 30s
    {
        "id": "K8_30s_reports_data",
        "title": "Attendance data, reports & Excel",
        "duration": 30.0,
        "vo": (
            "Attendance you cannot argue with. KidBus logs every boarding, drop, trip and stop arrival "
            "with timestamps. Fifteen built-in reports, each exportable to Excel in one click. Bulk import "
            "your whole school from a spreadsheet, with a validation dry run first. No more registers. "
            "No more re-typing. Reports that match the screen, every single time. "
            "KidBus, by ZeroMileSystems.com."
        ),
        "scenes": [
            {
                "img": "02-office-chaos",
                "motion": "zoom_in",
                "accent": "blue",
                "hl": "Attendance you can prove",
                "chips": ["Timestamps", "Per trip", "Per stop"],
                "cap": ("EVIDENCE, NOT MEMORY", "Every action is logged"),
                "w": 13,
            },
            {
                "img": "07-mockup-screen",
                "motion": "zoom_out",
                "accent": "blue",
                "hl": "15 built-in reports",
                "chips": ["By route", "By bus", "By stop", "Crew load"],
                "cap": ("REPORTS", "Same filters as the screen"),
                "w": 13,
                "ding": True,
            },
            {
                "img": "06-bus-street",
                "motion": "pan_left",
                "accent": "gold",
                "hl": "Export in one click",
                "chips": ["Excel", "CSV", "Streamed"],
                "cap": ("EXPORTS", "The file and the UI never disagree"),
                "w": 11,
            },
            {
                "img": "05-driver-cab",
                "motion": "pan_right",
                "accent": "gold",
                "hl": "Spreadsheet import",
                "chips": ["Dry-run first", "One transaction"],
                "cap": ("BULK IMPORT", "Rollback-safe, up to 5,000 rows"),
                "w": 17,
            },
            {"kind": "cta", "w": 8},
        ],
    },
    # ------------------------------------------------------------------ 20s
    {
        "id": "K9_20s_role_privacy",
        "title": "One platform, four experiences",
        "duration": 20.0,
        "vo": (
            "KidBus keeps every family in the loop, but only their own. Parents see their children, "
            "their bus and their stop. School admins see the whole fleet. Drivers get a simple crew app. "
            "One platform, four experiences, complete privacy. KidBus, by ZeroMileSystems.com."
        ),
        "scenes": [
            {
                "img": "04-reunion",
                "motion": "zoom_in",
                "accent": "green",
                "hl": "Every family in the loop",
                "chips": ["Their child", "Their bus", "Their stop"],
                "cap": ("PARENTS", "Only what is theirs to see"),
                "w": 15,
            },
            {
                "img": "02-office-chaos",
                "motion": "pan_right",
                "accent": "blue",
                "hl": "Admins see the fleet",
                "chips": ["Buses", "Routes", "Staff", "Shifts"],
                "cap": ("SCHOOL ADMINS", "Whole-school control"),
                "w": 11,
            },
            {
                "img": "05-driver-cab",
                "motion": "zoom_in",
                "accent": "gold",
                "hl": "Crew gets it simple",
                "chips": ["Trip", "Manifest", "SOS"],
                "cap": ("DRIVERS & CONDUCTORS", "Two-tap trip flow"),
                "w": 10,
                "ding": True,
            },
            {
                "img": "07-mockup-screen",
                "motion": "zoom_out",
                "accent": "blue",
                "hl": "Four apps. One truth.",
                "chips": ["Row-level tenancy", "Verified access"],
                "cap": ("PRIVACY BY DESIGN", "No cross-school data, ever"),
                "w": 11,
            },
            {"kind": "cta", "w": 8},
        ],
    },
    # ------------------------------------------------------------------ 15s
    {
        "id": "K10_15s_brand_tagline",
        "title": "Brand tagline film",
        "duration": 15.0,
        "vo": (
            "KidBus. School transport, completely visible. Live tracking, verified boarding, instant SOS, "
            "and reports your school will love. Free pilot for your school today. "
            "KidBus, by ZeroMileSystems.com."
        ),
        "scenes": [
            {
                "img": "06-bus-street",
                "motion": "zoom_in",
                "accent": "gold",
                "hl": "Completely visible.",
                "chips": ["Live tracking", "Verified boarding", "Instant SOS"],
                "cap": ("KIDBUS", "Everything in one place"),
                "w": 12,
            },
            {
                "img": "04-reunion",
                "motion": "zoom_in",
                "accent": "blue",
                "hl": "Reports your school will love",
                "chips": ["Excel exports", "15 reports"],
                "cap": ("FOR SCHOOLS", "Runs your whole operation"),
                "w": 11,
            },
            {"kind": "cta", "w": 9},
        ],
    },
    # ------------------------------------------------------------------ 60s
    {
        "id": "K11_60s_sales_film",
        "title": "Sales film: the whole platform, end to end",
        "duration": 60.0,
        "vo": (
            "Every morning, thousands of school buses leave the gate, and nobody really knows what "
            "happens next. Paper registers, phone calls, parents waiting with no information. "
            "KidBus changes that. The driver's app shares live GPS, and starts on its own when the trip "
            "begins. The conductor marks every boarding and drop in one tap, and parents are notified "
            "instantly. Parents see their child's bus on a live map, with alerts the moment it matters. "
            "Every stop arrival is detected automatically, and every remaining stop gets a live ETA. "
            "If something goes wrong, one tap raises an SOS on every admin's screen, with the trip and "
            "the location attached. In the office, every bus and driver document is tracked, with alerts "
            "thirty days before expiry. Attendance, trips and vehicle utilisation become reports you can "
            "export to Excel in one click. Your entire school, onboarded from a spreadsheet in minutes. "
            "KidBus, by ZeroMileSystems.com. Book a free thirty-day pilot for your school today."
        ),
        "scenes": [
            {
                "img": "02-office-chaos",
                "motion": "zoom_in",
                "accent": "blue",
                "hl": "Nobody really knows.",
                "chips": ["Paper registers", "Phone calls", "Waiting parents"],
                "cap": ("THE MORNING PROBLEM", "Three hundred children, zero visibility"),
                "w": 26,
            },
            {
                "img": "06-bus-street",
                "motion": "zoom_in",
                "accent": "gold",
                "hl": "One tap to start",
                "chips": ["Live GPS", "Background sharing"],
                "cap": ("CREW APP", "GPS starts with the trip itself"),
                "w": 18,
            },
            {
                "img": "03-boarding",
                "motion": "zoom_in",
                "accent": "green",
                "hl": "Every boarding logged",
                "chips": ["One tap", "Parent alerted"],
                "cap": ("ATTENDANCE", "Boarded and dropped, verified"),
                "w": 16,
                "ding": True,
            },
            {
                "img": "01-hook-mother",
                "motion": "zoom_in",
                "accent": "green",
                "hl": "Parents in the loop",
                "chips": ["Live map", "Push alerts"],
                "cap": ("PARENT APP", "Alerts the moment it matters"),
                "w": 15,
            },
            {
                "img": "07-mockup-screen",
                "motion": "zoom_out",
                "accent": "blue",
                "hl": "Arrivals, automatic",
                "chips": ["Geofence", "ETA per stop"],
                "cap": ("LIVE TRACKING", "No manual marking, ever"),
                "w": 15,
            },
            {
                "img": "05-driver-cab",
                "motion": "zoom_in",
                "accent": "red",
                "hl": "SOS in one tap",
                "chips": ["Accident", "Medical", "Security"],
                "cap": ("EMERGENCY", "Every admin alarmed, instantly"),
                "w": 21,
                "ding": True,
                "flash": [0.4, 2.6, 0.6],
            },
            {
                "img": "02-office-chaos",
                "motion": "zoom_out",
                "accent": "amber",
                "hl": "Documents, never late",
                "chips": ["Insurance", "Fitness", "Licences"],
                "cap": ("COMPLIANCE", "30-day expiry alerts"),
                "w": 17,
            },
            {
                "img": "07-mockup-screen",
                "motion": "pan_right",
                "accent": "blue",
                "hl": "Reports in one click",
                "chips": ["Attendance", "Trips", "Utilisation"],
                "cap": ("EXPORTS", "Excel or CSV, always in sync"),
                "w": 16,
            },
            {
                "img": "04-reunion",
                "motion": "zoom_in",
                "accent": "green",
                "hl": "Onboarded in minutes",
                "chips": ["Excel import", "Dry-run validation"],
                "cap": ("GO LIVE FAST", "Your whole school, one upload"),
                "w": 10,
            },
            {"kind": "cta", "w": 9},
        ],
    },
]


# ---------------------------------------------------------------------------
# Language variants
# ---------------------------------------------------------------------------
# Hinglish narration for the five films that a parent-facing Instagram audience sees most.
# The on-screen text deliberately stays English (readable to every parent and every school
# admin); only the voice switches, which is exactly how the app itself behaves — Hindi for the
# crew, English chrome on the web console.
HINGLISH = {
    "K1_15s_live_tracking": (
        "Bachche ki bus kahan hai? KidBus live location dikhata hai, aur har stop ka exact ETA. "
        "Safe safar, shaant subah. KidBus, by ZeroMileSystems.com."
    ),
    "K2_20s_boarding_verification": (
        "Bachcha bus mein chadha ya nahi? Ab andaza nahi lagana. KidBus har boarding aur drop verify "
        "karta hai. Conductor ka ek tap, aur parent ko turant alert. Na register, na phone calls. "
        "KidBus, by ZeroMileSystems.com."
    ),
    "K6_30s_all_in_one": (
        "Aapke poore school transport ka ek hi platform. Register, phone calls, bus kahan hai — sab "
        "khatam. Live GPS tracking, boarding aur drop verification, ETA aur stop arrival, SOS with "
        "admin siren, document compliance, aur ek click mein reports. Admins, drivers, conductors aur "
        "parents, sabke liye. Web par, mobile par, aur crew ke liye Hindi mein. Poora school, ek app. "
        "KidBus, by ZeroMileSystems.com."
    ),
    "K7_20s_geofence_eta": (
        "Bus jaise hi stop ke paas pahunchti hai, har parent ko turant alert milta hai. KidBus har "
        "bache hue stop ka ETA batata hai, aur arrival khud mark karta hai. Driver gaadi chalaye. "
        "Baaki sab system sambhale. KidBus, by ZeroMileSystems.com."
    ),
    "K10_15s_brand_tagline": (
        "KidBus. School transport, poori tarah visible. Live tracking, verified boarding, instant SOS, "
        "aur reports jo school ko pasand aayenge. Aaj hi apne school ke liye free pilot. "
        "KidBus, by ZeroMileSystems.com."
    ),
    "K3_30s_sos_compliance": (
        "Koi medical emergency. Bus kharab. Ya koi security problem. KidBus driver ke haath mein ek SOS "
        "button deta hai. Alarm turant har school admin tak pahunchta hai — bus, trip aur live location "
        "ke saath. Admin ki screen par alarm bajta rehta hai jab tak koi jawab na de. Status open se "
        "acknowledged, phir resolved. Saath hi insurance, fitness aur licence ke expiry alerts. "
        "KidBus, by ZeroMileSystems.com."
    ),
    "K4_20s_compliance_documents": (
        "Insurance ki date nikal rahi hai? Fitness certificate nahi mil raha? KidBus har bus aur driver "
        "ka document track karta hai, aur expiry se tees din pehle alert deta hai. Poora school ek hi "
        "dashboard par. Files kho jaane ka jhanjhat khatam. KidBus, by ZeroMileSystems.com."
    ),
    "K5_30s_school_operations": (
        "School transport desk ka matlab register aur phone calls nahi hona chahiye. KidBus aapke "
        "students, parents, buses aur routes Excel se minutes mein import karta hai, aur koi bhi report "
        "ek click mein export. Attendance, trips aur bus utilisation — sab ek dashboard par. Har school "
        "ka apna subscription plan, apni limits aur apni privacy. KidBus, by ZeroMileSystems.com."
    ),
    "K8_30s_reports_data": (
        "Attendance jispe sawal na uthaya ja sake. KidBus har boarding, drop, trip aur stop arrival ko "
        "time ke saath record karta hai. Pandrah built-in reports, har ek Excel mein ek click se. Poora "
        "school spreadsheet se bulk import karo, pehle validation dry run ke saath. Na register, na "
        "dobara typing. Reports hamesha screen se match karti hain. KidBus, by ZeroMileSystems.com."
    ),
    "K9_20s_role_privacy": (
        "KidBus har family ko unke bachche ki jaankari deta hai — aur sirf unki. Parents ko dikhta hai "
        "unka bachcha, unki bus aur unka stop. School admin ko poora fleet. Drivers ko simple crew app. "
        "Ek platform, chaar experiences, poori privacy. KidBus, by ZeroMileSystems.com."
    ),
    "K11_60s_sales_film": (
        "Har subah hazaron school buses gate se nikal jaati hain, aur kisi ko sach mein pata nahi hota "
        "aage kya hota hai. Register, phone calls, bina jaankari wait karte parents. KidBus ye badal "
        "deta hai. Driver ke app se live GPS share hota hai, aur trip shuru hote hi apne aap chalu ho "
        "jaata hai. Conductor har boarding aur drop ek tap mein mark karta hai, aur parents ko turant "
        "alert jaata hai. Parents apne bachche ki bus live map par dekhte hain, aur zaroori moment par "
        "alerts paate hain. Har stop arrival khud detect hoti hai, aur har bache hue stop ka live ETA "
        "milta hai. Kuch galat ho to ek tap mein SOS har admin ki screen par pahunchta hai, trip aur "
        "location ke saath. Office mein har bus aur driver ka document track hota hai, expiry se tees "
        "din pehle alert ke saath. Attendance, trips aur vehicle utilisation ek click mein Excel report "
        "ban jaate hain. Poora school, ek spreadsheet se, minute mein onboard. KidBus, by "
        "ZeroMileSystems.com. Aaj hi apne school ke liye free tees din ka pilot book kijiye."
    ),
}

VARIANTS = {"hinglish": HINGLISH}
VARIANT_PREFIX = {"hinglish": "HI_"}


def variant_videos(name: str) -> list:
    """Videos re-narrated in another language. Scene visuals, timings and on-screen text are
    untouched -- only `vo` differs, so a variant renders through exactly the same pipeline and
    lands in its own folder with a `HI_` id prefix."""
    table = VARIANTS[name]
    out = []
    for v in VIDEOS:
        if v["id"] not in table:
            continue
        nv = dict(v)
        nv["id"] = VARIANT_PREFIX[name] + v["id"]
        nv["vo"] = table[v["id"]]
        nv["title"] = f"{v['title']} ({name})"
        nv["variant"] = name
        nv["source_id"] = v["id"]
        out.append(nv)
    return out
