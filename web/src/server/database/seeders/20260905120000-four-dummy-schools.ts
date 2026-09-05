'use strict';

import type { QueryInterface, QueryOptions } from 'sequelize';
import * as bcrypt from 'bcryptjs';

/**
 * SEEDER — 4 Complete Schools with Full Connected Test Data
 *
 * Populates 4 independent tenant schools with complete, connected domain graphs:
 * - Plans & School Subscriptions
 * - School Admins, Drivers, Conductors, Parents (all with simple passwords = email)
 * - 3 Buses per school (12 total)
 * - 3 Routes per school (12 total)
 * - Stops per route (15 stops per school)
 * - 52 Students per school (208 total) with home stops, DOB, emergency contacts
 * - Student-Guardian relationships linking all students to parent accounts
 * - Route Assignments (Bus + Driver + Conductor rostered per route)
 * - Trips (Today's Completed, In-Progress, Scheduled runs)
 * - Trip Student Attendance (DROPPED, BOARDED, PENDING)
 * - Live Tracking GPS breadcrumbs (trip_locations)
 * - Stop Arrivals (trip_stop_arrivals)
 * - Bus Documents & Driver Documents (compliance)
 * - Document Requirements
 * - Emergency SOS Events (Resolved & Acknowledged)
 * - Parent Notifications
 * - Import Job History
 *
 * Idempotent (ON CONFLICT DO NOTHING), safe to re-run.
 * Refuses to run in production.
 */

const options: QueryOptions & { ignoreDuplicates?: boolean } = { ignoreDuplicates: true };

// Fixed deterministic timestamps
const BASE_TIMESTAMP = new Date('2026-09-05T00:00:00.000Z');
const TODAY_STR = new Date().toISOString().slice(0, 10);
const timestamps = { created_at: BASE_TIMESTAMP, updated_at: BASE_TIMESTAMP };

/** Deterministic UUID generator: 00000000-0000-4000-SSTT-IIIIIIIIIIII */
function makeUuid(schoolIdx: number, typeCode: number, itemIdx: number): string {
  const s = schoolIdx.toString(16).padStart(2, '0');
  const t = typeCode.toString(16).padStart(2, '0');
  const i = itemIdx.toString(16).padStart(12, '0');
  return `00000000-0000-4000-${s}${t}-${i}`;
}

// -----------------------------------------------------------------------------
// 1. PLANS
// -----------------------------------------------------------------------------
const PLAN_IDS = {
  BASIC: '00000000-0000-4000-0020-000000000001',
  GROWTH: '00000000-0000-4000-0020-000000000002',
  PRO: '00000000-0000-4000-0020-000000000003',
  ENTERPRISE: '00000000-0000-4000-0020-000000000004',
};

const PLANS = [
  {
    id: PLAN_IDS.BASIC,
    code: 'basic-monthly',
    name: 'Basic Plan',
    description: 'Essential bus tracking and student safety for small schools.',
    price_cents: 4900,
    currency: 'USD',
    billing_period: 'monthly',
    is_active: true,
    features: JSON.stringify({
      live_tracking: true,
      eta: true,
      attendance: true,
      parent_portal: true,
      notifications: true,
      geofence_stop_arrival: true,
    }),
    limits: JSON.stringify({
      students: { unlimited: false, value: 100 },
      buses: { unlimited: false, value: 5 },
      routes: { unlimited: false, value: 5 },
      drivers: { unlimited: false, value: 10 },
      conductors: { unlimited: false, value: 10 },
      staff: { unlimited: false, value: 20 },
      parents: { unlimited: false, value: 200 },
      stops: { unlimited: false, value: 50 },
      trips: { unlimited: true, value: null },
    }),
    ...timestamps,
  },
  {
    id: PLAN_IDS.GROWTH,
    code: 'growth-monthly',
    name: 'Growth Plan',
    description: 'Expanded fleet management with document compliance and reporting.',
    price_cents: 9900,
    currency: 'USD',
    billing_period: 'monthly',
    is_active: true,
    features: JSON.stringify({
      live_tracking: true,
      eta: true,
      attendance: true,
      parent_portal: true,
      notifications: true,
      geofence_stop_arrival: true,
      advanced_reports: true,
    }),
    limits: JSON.stringify({
      students: { unlimited: false, value: 300 },
      buses: { unlimited: false, value: 15 },
      routes: { unlimited: false, value: 15 },
      drivers: { unlimited: false, value: 25 },
      conductors: { unlimited: false, value: 25 },
      staff: { unlimited: false, value: 50 },
      parents: { unlimited: false, value: 600 },
      stops: { unlimited: false, value: 150 },
      trips: { unlimited: true, value: null },
    }),
    ...timestamps,
  },
  {
    id: PLAN_IDS.PRO,
    code: 'pro-monthly',
    name: 'Pro Plan',
    description: 'Full-featured suite with SOS alerts, compliance automation and analytics.',
    price_cents: 19900,
    currency: 'USD',
    billing_period: 'monthly',
    is_active: true,
    features: JSON.stringify({
      live_tracking: true,
      eta: true,
      attendance: true,
      parent_portal: true,
      notifications: true,
      geofence_stop_arrival: true,
      advanced_reports: true,
      analytics: true,
    }),
    limits: JSON.stringify({
      students: { unlimited: false, value: 1000 },
      buses: { unlimited: false, value: 50 },
      routes: { unlimited: false, value: 50 },
      drivers: { unlimited: false, value: 80 },
      conductors: { unlimited: false, value: 80 },
      staff: { unlimited: false, value: 160 },
      parents: { unlimited: false, value: 2000 },
      stops: { unlimited: false, value: 500 },
      trips: { unlimited: true, value: null },
    }),
    ...timestamps,
  },
  {
    id: PLAN_IDS.ENTERPRISE,
    code: 'enterprise-yearly',
    name: 'Enterprise Plan',
    description: 'Unlimited institutional scale with premium SLA and assisted onboarding.',
    price_cents: 199900,
    currency: 'USD',
    billing_period: 'yearly',
    is_active: true,
    features: JSON.stringify({
      live_tracking: true,
      eta: true,
      attendance: true,
      parent_portal: true,
      notifications: true,
      geofence_stop_arrival: true,
      advanced_reports: true,
      analytics: true,
    }),
    limits: JSON.stringify({
      students: { unlimited: true, value: null },
      buses: { unlimited: true, value: null },
      routes: { unlimited: true, value: null },
      drivers: { unlimited: true, value: null },
      conductors: { unlimited: true, value: null },
      staff: { unlimited: true, value: null },
      parents: { unlimited: true, value: null },
      stops: { unlimited: true, value: null },
      trips: { unlimited: true, value: null },
    }),
    ...timestamps,
  },
];

// -----------------------------------------------------------------------------
// 2. SCHOOL CONFIGURATIONS
// -----------------------------------------------------------------------------
interface SchoolConfig {
  index: number;
  id: string;
  name: string;
  code: string;
  subdomain: string;
  adminEmail: string;
  adminName: { first: string; last: string };
  planId: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  timezone: string;
  latitude: number;
  longitude: number;
  busPrefix: string;
  stateCode: string;
}

const SCHOOL_CONFIGS: SchoolConfig[] = [
  {
    index: 1,
    id: makeUuid(1, 1, 1),
    name: 'Green Valley International School',
    code: 'green-valley',
    subdomain: 'green-valley',
    adminEmail: 'green@gmail.com',
    adminName: { first: 'Anil', last: 'Kumar' },
    planId: PLAN_IDS.ENTERPRISE,
    phone: '+91-9876543210',
    address: '123 Education Avenue, Block B',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400050',
    country: 'IN',
    timezone: 'Asia/Kolkata',
    latitude: 19.0596,
    longitude: 72.8295,
    busPrefix: 'GV',
    stateCode: 'MH-01',
  },
  {
    index: 2,
    id: makeUuid(2, 1, 1),
    name: 'Riverside Public School',
    code: 'riverside-public',
    subdomain: 'riverside-public',
    adminEmail: 'riverside@gmail.com',
    adminName: { first: 'Priya', last: 'Sharma' },
    planId: PLAN_IDS.PRO,
    phone: '+91-9876543211',
    address: '45 River Road, Sector 17',
    city: 'Delhi',
    state: 'Delhi',
    postalCode: '110085',
    country: 'IN',
    timezone: 'Asia/Kolkata',
    latitude: 28.7041,
    longitude: 77.1025,
    busPrefix: 'RP',
    stateCode: 'DL-01',
  },
  {
    index: 3,
    id: makeUuid(3, 1, 1),
    name: 'Oakwood Academy',
    code: 'oakwood-academy',
    subdomain: 'oakwood-academy',
    adminEmail: 'oakwood@gmail.com',
    adminName: { first: 'Rahul', last: 'Verma' },
    planId: PLAN_IDS.GROWTH,
    phone: '+91-9876543212',
    address: '78 Learning Street, Indiranagar',
    city: 'Bangalore',
    state: 'Karnataka',
    postalCode: '560038',
    country: 'IN',
    timezone: 'Asia/Kolkata',
    latitude: 12.9784,
    longitude: 77.6408,
    busPrefix: 'OA',
    stateCode: 'KA-01',
  },
  {
    index: 4,
    id: makeUuid(4, 1, 1),
    name: 'Maple Leaf Central School',
    code: 'maple-leaf-central',
    subdomain: 'maple-leaf-central',
    adminEmail: 'maple@gmail.com',
    adminName: { first: 'Sneha', last: 'Patel' },
    planId: PLAN_IDS.BASIC,
    phone: '+91-9876543213',
    address: '99 Campus Lane, Adyar',
    city: 'Chennai',
    state: 'Tamil Nadu',
    postalCode: '600020',
    country: 'IN',
    timezone: 'Asia/Kolkata',
    latitude: 13.0012,
    longitude: 80.2565,
    busPrefix: 'ML',
    stateCode: 'TN-01',
  },
];

// Student names catalog for generating realistic pupils
const FIRST_NAMES = [
  'Aarav',
  'Vivaan',
  'Aditya',
  'Vihaan',
  'Arjun',
  'Sai',
  'Reyansh',
  'Aadhya',
  'Diya',
  'Ananya',
  'Pari',
  'Saanvi',
  'Ishaan',
  'Pranav',
  'Krishna',
  'Myra',
  'Anvi',
  'Riya',
  'Advik',
  'Kabir',
  'Dhruv',
  'Shaurya',
  'Avni',
  'Tara',
  'Kavya',
  'Navya',
  'Dev',
  'Manan',
  'Aryan',
  'Rohan',
  'Tanvi',
  'Ira',
  'Aanya',
  'Samarth',
  'Yash',
  'Rudra',
  'Sara',
  'Meera',
  'Rishi',
  'Nirvaan',
  'Siddharth',
  'Nisha',
  'Karan',
  'Pooja',
  'Varun',
  'Neha',
  'Gaurav',
  'Anika',
  'Abhinav',
  'Shreya',
  'Kunal',
  'Simran',
];

const LAST_NAMES = [
  'Patel',
  'Sharma',
  'Verma',
  'Gupta',
  'Singh',
  'Deshmukh',
  'Yadav',
  'Joshi',
  'Mehta',
  'Rao',
  'Kulkarni',
  'Reddy',
  'Nair',
  'Iyer',
  'Bose',
  'Chatterjee',
  'Mishra',
  'Pandey',
  'Chopra',
  'Malhotra',
  'Bhat',
  'Shetty',
  'Pillai',
  'Menon',
  'Saxena',
  'Kapoor',
];

export async function up(queryInterface: QueryInterface): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to insert seed test data into a production database.');
  }

  // ---------------------------------------------------------------------------
  // 1. INSERT PLANS
  // ---------------------------------------------------------------------------
  await queryInterface.bulkInsert('plans', PLANS, options);

  // ---------------------------------------------------------------------------
  // 2. INSERT SCHOOLS & SUBSCRIPTIONS
  // ---------------------------------------------------------------------------
  const schoolsRows = SCHOOL_CONFIGS.map((cfg) => ({
    id: cfg.id,
    name: cfg.name,
    code: cfg.code,
    subdomain: cfg.subdomain,
    email: cfg.adminEmail,
    phone: cfg.phone,
    address_line1: cfg.address,
    city: cfg.city,
    state: cfg.state,
    postal_code: cfg.postalCode,
    country: cfg.country,
    timezone: cfg.timezone,
    latitude: cfg.latitude,
    longitude: cfg.longitude,
    is_active: true,
    ...timestamps,
  }));
  await queryInterface.bulkInsert('schools', schoolsRows, options);

  const subscriptionsRows = SCHOOL_CONFIGS.map((cfg) => ({
    id: makeUuid(cfg.index, 21, 1),
    school_id: cfg.id,
    plan_id: cfg.planId,
    status: 'active',
    current_period_start: new Date('2026-01-01T00:00:00.000Z'),
    current_period_end: new Date('2027-01-01T00:00:00.000Z'),
    ...timestamps,
  }));
  await queryInterface.bulkInsert('school_subscriptions', subscriptionsRows, options);

  // ---------------------------------------------------------------------------
  // 3. GENERATE ALL USERS (Admin, Drivers, Conductors, Parents)
  // ---------------------------------------------------------------------------
  interface UserRow {
    id: string;
    school_id: string;
    role: 'SCHOOL_ADMIN' | 'DRIVER' | 'CONDUCTOR' | 'PARENT';
    first_name: string;
    last_name: string;
    email: string;
    password_hash?: string;
    phone: string;
    email_verified_at: Date;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }

  const allUsers: UserRow[] = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;
    const slug = cfg.code.split('-')[0]; // e.g. green, riverside, oakwood, maple

    // School Admin
    allUsers.push({
      id: makeUuid(sIdx, 2, 1),
      school_id: cfg.id,
      role: 'SCHOOL_ADMIN',
      first_name: cfg.adminName.first,
      last_name: cfg.adminName.last,
      email: cfg.adminEmail,
      phone: cfg.phone,
      email_verified_at: BASE_TIMESTAMP,
      is_active: true,
      ...timestamps,
    });

    // 3 Drivers
    const driverNames = [
      { first: 'Rajesh', last: 'Singh' },
      { first: 'Suresh', last: 'Yadav' },
      { first: 'Manoj', last: 'Kumar' },
    ];
    for (let d = 0; d < 3; d++) {
      const email = `driver${d + 1}.${slug}@gmail.com`;
      allUsers.push({
        id: makeUuid(sIdx, 3, d + 1),
        school_id: cfg.id,
        role: 'DRIVER',
        first_name: driverNames[d].first,
        last_name: driverNames[d].last,
        email,
        phone: `+91-98111000${sIdx}${d + 1}`,
        email_verified_at: BASE_TIMESTAMP,
        is_active: true,
        ...timestamps,
      });
    }

    // 3 Conductors
    const conductorNames = [
      { first: 'Ramesh', last: 'Patil' },
      { first: 'Amit', last: 'Deshmukh' },
      { first: 'Vikas', last: 'Shinde' },
    ];
    for (let c = 0; c < 3; c++) {
      const email = `conductor${c + 1}.${slug}@gmail.com`;
      allUsers.push({
        id: makeUuid(sIdx, 4, c + 1),
        school_id: cfg.id,
        role: 'CONDUCTOR',
        first_name: conductorNames[c].first,
        last_name: conductorNames[c].last,
        email,
        phone: `+91-98222000${sIdx}${c + 1}`,
        email_verified_at: BASE_TIMESTAMP,
        is_active: true,
        ...timestamps,
      });
    }

    // 26 Parents
    for (let p = 0; p < 26; p++) {
      const parentLastName = LAST_NAMES[p % LAST_NAMES.length];
      const email = `parent${p + 1}.${slug}@gmail.com`;
      allUsers.push({
        id: makeUuid(sIdx, 5, p + 1),
        school_id: cfg.id,
        role: 'PARENT',
        first_name: p % 2 === 0 ? 'Vikram' : 'Sunita',
        last_name: parentLastName,
        email,
        phone: `+91-983330${sIdx.toString().padStart(2, '0')}${p.toString().padStart(2, '0')}`,
        email_verified_at: BASE_TIMESTAMP,
        is_active: true,
        ...timestamps,
      });
    }
  }

  // Pre-hash distinct passwords (Password = Email)
  const passwordMap = new Map<string, string>();
  await Promise.all(
    allUsers.map(async (u) => {
      const hash = await bcrypt.hash(u.email, 10);
      passwordMap.set(u.email, hash);
    }),
  );

  const usersWithHashes = allUsers.map((u) => ({
    ...u,
    password_hash: passwordMap.get(u.email),
  }));
  await queryInterface.bulkInsert('users', usersWithHashes, options);

  // ---------------------------------------------------------------------------
  // 4. BUSES (3 per school)
  // ---------------------------------------------------------------------------
  const allBuses: Array<{
    id: string;
    school_id: string;
    registration_number: string;
    bus_number: string;
    capacity: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;
    for (let b = 1; b <= 3; b++) {
      allBuses.push({
        id: makeUuid(sIdx, 6, b),
        school_id: cfg.id,
        registration_number: `${cfg.stateCode}-${cfg.busPrefix}-${1000 + b}`,
        bus_number: `B-0${b}`,
        capacity: 35 + b * 5, // 40, 45, 50
        is_active: true,
        ...timestamps,
      });
    }
  }
  await queryInterface.bulkInsert('buses', allBuses, options);

  // ---------------------------------------------------------------------------
  // 5. ROUTES & STOPS (3 routes, 5 stops per route = 15 stops per school)
  // ---------------------------------------------------------------------------
  const allRoutes: Array<{
    id: string;
    school_id: string;
    name: string;
    code: string;
    description: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }> = [];

  const allStops: Array<{
    id: string;
    school_id: string;
    route_id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    geofence_radius_meters: number;
    sequence_number: number;
    estimated_arrival_time: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }> = [];

  const ROUTE_TEMPLATES = [
    {
      code: 'R-01',
      name: 'North Loop — Morning Pickup',
      desc: 'Morning route servicing northern residential sectors and town center.',
      times: ['07:15:00', '07:25:00', '07:35:00', '07:45:00', '07:55:00'],
      stopNames: [
        'North Gate Bay',
        'Pine Meadows Park',
        'Highland Square',
        'Oak Ridge Cross',
        'School North Gate',
      ],
    },
    {
      code: 'R-02',
      name: 'East Corridor — Afternoon Drop',
      desc: 'Afternoon return route covering eastern sectors and suburban stops.',
      times: ['13:45:00', '13:55:00', '14:10:00', '14:25:00', '14:40:00'],
      stopNames: [
        'School Main Bay',
        'East Lakeview Point',
        'Maple Gardens',
        'Riverdale Crossing',
        'Sunrise Point',
      ],
    },
    {
      code: 'R-03',
      name: 'Central Express — Dual Loop',
      desc: 'Express transport linking central city junctions directly to campus.',
      times: ['16:30:00', '16:40:00', '16:55:00', '17:10:00', '17:25:00'],
      stopNames: [
        'Central Metro Hub',
        'Green Avenue Circle',
        'Tech Park Junction',
        'Westwood Bay',
        'School South Gate',
      ],
    },
  ];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;
    for (let r = 0; r < 3; r++) {
      const rId = makeUuid(sIdx, 7, r + 1);
      const rTpl = ROUTE_TEMPLATES[r];

      allRoutes.push({
        id: rId,
        school_id: cfg.id,
        name: `${cfg.name.split(' ')[0]} ${rTpl.name}`,
        code: `${cfg.busPrefix}-${rTpl.code}`,
        description: rTpl.desc,
        is_active: true,
        ...timestamps,
      });

      // 5 stops per route
      for (let st = 0; st < 5; st++) {
        const stopId = makeUuid(sIdx, 8, r * 5 + st + 1);
        const latOffset = r * 0.015 + st * 0.005 - 0.02;
        const lngOffset = r * 0.012 + st * 0.006 - 0.02;

        allStops.push({
          id: stopId,
          school_id: cfg.id,
          route_id: rId,
          name: `${rTpl.stopNames[st]} (${cfg.city})`,
          address: `${100 + st * 15} ${rTpl.stopNames[st]}, ${cfg.city}`,
          latitude: +(cfg.latitude + latOffset).toFixed(6),
          longitude: +(cfg.longitude + lngOffset).toFixed(6),
          geofence_radius_meters: 120,
          sequence_number: st + 1,
          estimated_arrival_time: rTpl.times[st],
          is_active: true,
          ...timestamps,
        });
      }
    }
  }
  await queryInterface.bulkInsert('routes', allRoutes, options);
  await queryInterface.bulkInsert('stops', allStops, options);

  // ---------------------------------------------------------------------------
  // 6. STUDENTS (52 per school) & GUARDIAN LINKS
  // ---------------------------------------------------------------------------
  const allStudents: Array<{
    id: string;
    school_id: string;
    home_stop_id: string;
    admission_number: string;
    first_name: string;
    last_name: string;
    date_of_birth: string;
    gender: 'MALE' | 'FEMALE';
    grade_level: string;
    emergency_contact_name: string;
    emergency_contact_phone: string;
    medical_notes: string | null;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }> = [];

  const allStudentGuardians: Array<{
    id: string;
    school_id: string;
    student_id: string;
    user_id: string;
    relationship: string;
    can_pick_up: boolean;
    is_primary: boolean;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;

    // Distribute 52 students across the 15 stops
    // Route 1 (stops 1-5): 18 students
    // Route 2 (stops 6-10): 18 students
    // Route 3 (stops 11-15): 16 students
    for (let stu = 0; stu < 52; stu++) {
      const studentId = makeUuid(sIdx, 9, stu + 1);
      const routeIdx = stu < 18 ? 0 : stu < 36 ? 1 : 2;
      const stopInRoute = stu % 4; // pick stops 1-4 as pickup points
      const stopIdx = routeIdx * 5 + stopInRoute + 1;
      const homeStopId = makeUuid(sIdx, 8, stopIdx);

      const firstName = FIRST_NAMES[stu % FIRST_NAMES.length];
      const lastName = LAST_NAMES[stu % LAST_NAMES.length];
      const gender: 'MALE' | 'FEMALE' = stu % 2 === 0 ? 'MALE' : 'FEMALE';
      const gradeNum = (stu % 10) + 1;
      const birthYear = 2026 - (gradeNum + 5);
      const birthMonth = ((stu % 12) + 1).toString().padStart(2, '0');
      const birthDay = ((stu % 27) + 1).toString().padStart(2, '0');
      const dob = `${birthYear}-${birthMonth}-${birthDay}`;

      const parentIdx = Math.floor(stu / 2) + 1; // 2 students per parent
      const parentUserId = makeUuid(sIdx, 5, parentIdx);
      const emergencyContactName = `${pName(stu)} ${lastName}`;
      const emergencyContactPhone = `+91-983330${sIdx.toString().padStart(2, '0')}${parentIdx.toString().padStart(2, '0')}`;

      const medicalNotes =
        stu === 3
          ? 'Mild asthma (inhaler in backpack)'
          : stu === 12
            ? 'Peanut and tree nut allergy'
            : stu === 25
              ? 'Wears corrective glasses'
              : null;

      allStudents.push({
        id: studentId,
        school_id: cfg.id,
        home_stop_id: homeStopId,
        admission_number: `${cfg.busPrefix}-2026-${(stu + 1).toString().padStart(3, '0')}`,
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dob,
        gender,
        grade_level: `Grade ${gradeNum}`,
        emergency_contact_name: emergencyContactName,
        emergency_contact_phone: emergencyContactPhone,
        medical_notes: medicalNotes,
        is_active: true,
        ...timestamps,
      });

      // Link to parent
      allStudentGuardians.push({
        id: makeUuid(sIdx, 19, stu + 1),
        school_id: cfg.id,
        student_id: studentId,
        user_id: parentUserId,
        relationship: stu % 2 === 0 ? 'Father' : 'Mother',
        can_pick_up: true,
        is_primary: true,
        is_active: true,
        ...timestamps,
      });
    }
  }

  function pName(stu: number): string {
    return stu % 2 === 0 ? 'Vikram' : 'Sunita';
  }

  await queryInterface.bulkInsert('students', allStudents, options);
  await queryInterface.bulkInsert('student_guardians', allStudentGuardians, options);

  // ---------------------------------------------------------------------------
  // 7. ROUTE ASSIGNMENTS (3 assignments per school)
  // ---------------------------------------------------------------------------
  const allAssignments: Array<{
    id: string;
    school_id: string;
    route_id: string;
    bus_id: string;
    user_id: string;
    role: 'DRIVER' | 'CONDUCTOR';
    effective_from: string;
    effective_to: string | null;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;
    for (let r = 1; r <= 3; r++) {
      const routeId = makeUuid(sIdx, 7, r);
      const busId = makeUuid(sIdx, 6, r);
      const driverId = makeUuid(sIdx, 3, r);
      const conductorId = makeUuid(sIdx, 4, r);

      // Driver assignment
      allAssignments.push({
        id: makeUuid(sIdx, 10, (r - 1) * 2 + 1),
        school_id: cfg.id,
        route_id: routeId,
        bus_id: busId,
        user_id: driverId,
        role: 'DRIVER',
        effective_from: '2026-01-01',
        effective_to: null,
        is_active: true,
        ...timestamps,
      });

      // Conductor assignment
      allAssignments.push({
        id: makeUuid(sIdx, 10, (r - 1) * 2 + 2),
        school_id: cfg.id,
        route_id: routeId,
        bus_id: busId,
        user_id: conductorId,
        role: 'CONDUCTOR',
        effective_from: '2026-01-01',
        effective_to: null,
        is_active: true,
        ...timestamps,
      });
    }
  }
  await queryInterface.bulkInsert('route_assignments', allAssignments, options);

  // ---------------------------------------------------------------------------
  // 8. TRIPS (3 trips per school scheduled today: Completed, In-Progress, Scheduled)
  // ---------------------------------------------------------------------------
  const allTrips: Array<{
    id: string;
    school_id: string;
    route_id: string;
    bus_id: string;
    driver_id: string;
    conductor_id: string;
    status: 'SCHEDULED' | 'BOARDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    scheduled_start_at: Date;
    scheduled_end_at: Date;
    actual_start_at: Date | null;
    actual_end_at: Date | null;
    cancelled_at: Date | null;
    cancellation_reason: string | null;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;

    // Trip 1: Morning Run — COMPLETED
    allTrips.push({
      id: makeUuid(sIdx, 11, 1),
      school_id: cfg.id,
      route_id: makeUuid(sIdx, 7, 1),
      bus_id: makeUuid(sIdx, 6, 1),
      driver_id: makeUuid(sIdx, 3, 1),
      conductor_id: makeUuid(sIdx, 4, 1),
      status: 'COMPLETED',
      scheduled_start_at: new Date(`${TODAY_STR}T07:00:00.000Z`),
      scheduled_end_at: new Date(`${TODAY_STR}T08:00:00.000Z`),
      actual_start_at: new Date(`${TODAY_STR}T07:05:00.000Z`),
      actual_end_at: new Date(`${TODAY_STR}T07:55:00.000Z`),
      cancelled_at: null,
      cancellation_reason: null,
      ...timestamps,
    });

    // Trip 2: Afternoon Run — IN_PROGRESS
    allTrips.push({
      id: makeUuid(sIdx, 11, 2),
      school_id: cfg.id,
      route_id: makeUuid(sIdx, 7, 2),
      bus_id: makeUuid(sIdx, 6, 2),
      driver_id: makeUuid(sIdx, 3, 2),
      conductor_id: makeUuid(sIdx, 4, 2),
      status: 'IN_PROGRESS',
      scheduled_start_at: new Date(`${TODAY_STR}T13:30:00.000Z`),
      scheduled_end_at: new Date(`${TODAY_STR}T14:45:00.000Z`),
      actual_start_at: new Date(`${TODAY_STR}T13:35:00.000Z`),
      actual_end_at: null,
      cancelled_at: null,
      cancellation_reason: null,
      ...timestamps,
    });

    // Trip 3: Evening Run — SCHEDULED
    allTrips.push({
      id: makeUuid(sIdx, 11, 3),
      school_id: cfg.id,
      route_id: makeUuid(sIdx, 7, 3),
      bus_id: makeUuid(sIdx, 6, 3),
      driver_id: makeUuid(sIdx, 3, 3),
      conductor_id: makeUuid(sIdx, 4, 3),
      status: 'SCHEDULED',
      scheduled_start_at: new Date(`${TODAY_STR}T16:30:00.000Z`),
      scheduled_end_at: new Date(`${TODAY_STR}T17:30:00.000Z`),
      actual_start_at: null,
      actual_end_at: null,
      cancelled_at: null,
      cancellation_reason: null,
      ...timestamps,
    });
  }
  await queryInterface.bulkInsert('trips', allTrips, options);

  // ---------------------------------------------------------------------------
  // 9. TRIP STUDENT ATTENDANCE
  // ---------------------------------------------------------------------------
  const allAttendance: Array<{
    id: string;
    school_id: string;
    trip_id: string;
    student_id: string;
    stop_id: string;
    status: 'PENDING' | 'BOARDED' | 'DROPPED';
    boarded_at: Date | null;
    boarded_by: string | null;
    dropped_at: Date | null;
    dropped_by: string | null;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;
    const trip1Id = makeUuid(sIdx, 11, 1);
    const trip2Id = makeUuid(sIdx, 11, 2);
    const driver1Id = makeUuid(sIdx, 3, 1);
    const conductor1Id = makeUuid(sIdx, 4, 1);
    const driver2Id = makeUuid(sIdx, 3, 2);

    // Trip 1 (Route 1) students: 18 students — all DROPPED
    for (let i = 0; i < 18; i++) {
      const studentId = makeUuid(sIdx, 9, i + 1);
      const stopIdx = (i % 4) + 1;
      const stopId = makeUuid(sIdx, 8, stopIdx);

      allAttendance.push({
        id: makeUuid(sIdx, 12, i + 1),
        school_id: cfg.id,
        trip_id: trip1Id,
        student_id: studentId,
        stop_id: stopId,
        status: 'DROPPED',
        boarded_at: new Date(`${TODAY_STR}T07:12:00.000Z`),
        boarded_by: driver1Id,
        dropped_at: new Date(`${TODAY_STR}T07:50:00.000Z`),
        dropped_by: conductor1Id,
        ...timestamps,
      });
    }

    // Trip 2 (Route 2) students: 18 students (idx 18-35) — 10 BOARDED, 8 PENDING
    for (let i = 18; i < 36; i++) {
      const studentId = makeUuid(sIdx, 9, i + 1);
      const stopIdx = 5 + (i % 4) + 1;
      const stopId = makeUuid(sIdx, 8, stopIdx);
      const isBoarded = i < 28;

      allAttendance.push({
        id: makeUuid(sIdx, 12, i + 1),
        school_id: cfg.id,
        trip_id: trip2Id,
        student_id: studentId,
        stop_id: stopId,
        status: isBoarded ? 'BOARDED' : 'PENDING',
        boarded_at: isBoarded ? new Date(`${TODAY_STR}T13:40:00.000Z`) : null,
        boarded_by: isBoarded ? driver2Id : null,
        dropped_at: null,
        dropped_by: null,
        ...timestamps,
      });
    }
  }
  await queryInterface.bulkInsert('trip_student_attendance', allAttendance, options);

  // ---------------------------------------------------------------------------
  // 10. TRIP LOCATIONS (GPS Fixes for Live Tracking)
  // ---------------------------------------------------------------------------
  const allLocations: Array<{
    id: string;
    school_id: string;
    trip_id: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number;
    heading: number;
    recorded_at: Date;
    received_at: Date;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;
    const trip2Id = makeUuid(sIdx, 11, 2); // In-progress trip

    for (let pt = 0; pt < 6; pt++) {
      const locId = makeUuid(sIdx, 13, pt + 1);
      const time = new Date(`${TODAY_STR}T13:4${pt}:00.000Z`);
      allLocations.push({
        id: locId,
        school_id: cfg.id,
        trip_id: trip2Id,
        latitude: +(cfg.latitude + pt * 0.004).toFixed(6),
        longitude: +(cfg.longitude + pt * 0.003).toFixed(6),
        accuracy: 4.5,
        speed: 32.5,
        heading: 95.0,
        recorded_at: time,
        received_at: time,
        ...timestamps,
      });
    }
  }
  await queryInterface.bulkInsert('trip_locations', allLocations, options);

  // ---------------------------------------------------------------------------
  // 11. TRIP STOP ARRIVALS
  // ---------------------------------------------------------------------------
  const allArrivals: Array<{
    id: string;
    school_id: string;
    trip_id: string;
    stop_id: string;
    arrived_at: Date;
    latitude: number;
    longitude: number;
    distance_meters: number;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;
    const trip1Id = makeUuid(sIdx, 11, 1);
    const trip2Id = makeUuid(sIdx, 11, 2);

    // Trip 1 (Completed): arrived at all 5 stops
    for (let st = 0; st < 5; st++) {
      const stopId = makeUuid(sIdx, 8, st + 1);
      allArrivals.push({
        id: makeUuid(sIdx, 14, st + 1),
        school_id: cfg.id,
        trip_id: trip1Id,
        stop_id: stopId,
        arrived_at: new Date(`${TODAY_STR}T07:${15 + st * 8}:00.000Z`),
        latitude: +(cfg.latitude + st * 0.003).toFixed(6),
        longitude: +(cfg.longitude + st * 0.003).toFixed(6),
        distance_meters: 15.2,
        ...timestamps,
      });
    }

    // Trip 2 (In-Progress): arrived at first 2 stops
    for (let st = 0; st < 2; st++) {
      const stopId = makeUuid(sIdx, 8, 5 + st + 1);
      allArrivals.push({
        id: makeUuid(sIdx, 14, 5 + st + 1),
        school_id: cfg.id,
        trip_id: trip2Id,
        stop_id: stopId,
        arrived_at: new Date(`${TODAY_STR}T13:${40 + st * 12}:00.000Z`),
        latitude: +(cfg.latitude + st * 0.003).toFixed(6),
        longitude: +(cfg.longitude + st * 0.003).toFixed(6),
        distance_meters: 18.5,
        ...timestamps,
      });
    }
  }
  await queryInterface.bulkInsert('trip_stop_arrivals', allArrivals, options);

  // ---------------------------------------------------------------------------
  // 12. COMPLIANCE: BUS DOCUMENTS & DRIVER DOCUMENTS
  // ---------------------------------------------------------------------------
  const allBusDocs: Array<{
    id: string;
    school_id: string;
    bus_id: string;
    document_type: string;
    document_number: string;
    issue_date: string;
    expiry_date: string;
    file_name: string;
    file_url: string;
    notes: string;
    created_at: Date;
    updated_at: Date;
  }> = [];

  const allDriverDocs: Array<{
    id: string;
    school_id: string;
    driver_id: string;
    document_type: string;
    document_number: string;
    issue_date: string;
    expiry_date: string;
    file_name: string;
    file_url: string;
    notes: string;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;

    // Bus documents for 3 buses
    for (let b = 1; b <= 3; b++) {
      const busId = makeUuid(sIdx, 6, b);
      allBusDocs.push(
        {
          id: makeUuid(sIdx, 15, (b - 1) * 4 + 1),
          school_id: cfg.id,
          bus_id: busId,
          document_type: 'REGISTRATION_CERTIFICATE',
          document_number: `RC-${cfg.busPrefix}-${1000 + b}`,
          issue_date: '2024-01-10',
          expiry_date: '2029-01-10',
          file_name: `rc_bus_${b}.pdf`,
          file_url: `https://documents.internal/buses/rc_${b}.pdf`,
          notes: 'Permanent institutional vehicle registration certificate',
          ...timestamps,
        },
        {
          id: makeUuid(sIdx, 15, (b - 1) * 4 + 2),
          school_id: cfg.id,
          bus_id: busId,
          document_type: 'INSURANCE',
          document_number: `INS-${cfg.busPrefix}-${2026 + b}`,
          issue_date: '2026-01-01',
          expiry_date: '2027-01-01',
          file_name: `insurance_bus_${b}.pdf`,
          file_url: `https://documents.internal/buses/ins_${b}.pdf`,
          notes: 'Comprehensive commercial school bus policy',
          ...timestamps,
        },
        {
          id: makeUuid(sIdx, 15, (b - 1) * 4 + 3),
          school_id: cfg.id,
          bus_id: busId,
          document_type: 'FITNESS_CERTIFICATE',
          document_number: `FC-${cfg.busPrefix}-${3000 + b}`,
          issue_date: '2025-06-01',
          expiry_date: '2026-12-31',
          file_name: `fitness_bus_${b}.pdf`,
          file_url: `https://documents.internal/buses/fitness_${b}.pdf`,
          notes: 'Annual mechanical safety certificate',
          ...timestamps,
        },
        {
          id: makeUuid(sIdx, 15, (b - 1) * 4 + 4),
          school_id: cfg.id,
          bus_id: busId,
          document_type: 'POLLUTION_CERTIFICATE',
          document_number: `PUC-${cfg.busPrefix}-${4000 + b}`,
          issue_date: '2026-03-01',
          expiry_date: '2026-09-30',
          file_name: `puc_bus_${b}.pdf`,
          file_url: `https://documents.internal/buses/puc_${b}.pdf`,
          notes: 'Quarterly emission test certificate',
          ...timestamps,
        },
      );
    }

    // Driver documents for 3 drivers
    for (let d = 1; d <= 3; d++) {
      const driverId = makeUuid(sIdx, 3, d);
      allDriverDocs.push(
        {
          id: makeUuid(sIdx, 15, 20 + (d - 1) * 3 + 1),
          school_id: cfg.id,
          driver_id: driverId,
          document_type: 'DRIVING_LICENSE',
          document_number: `DL-${cfg.stateCode.replace('-', '')}-2018000${sIdx}${d}`,
          issue_date: '2018-05-15',
          expiry_date: '2028-05-14',
          file_name: `driver_license_${d}.pdf`,
          file_url: `https://documents.internal/drivers/dl_${d}.pdf`,
          notes: 'Heavy passenger vehicle endorsement active',
          ...timestamps,
        },
        {
          id: makeUuid(sIdx, 15, 20 + (d - 1) * 3 + 2),
          school_id: cfg.id,
          driver_id: driverId,
          document_type: 'MEDICAL_CERTIFICATE',
          document_number: `MED-2026-00${sIdx}${d}`,
          issue_date: '2026-01-15',
          expiry_date: '2027-01-14',
          file_name: `medical_cert_${d}.pdf`,
          file_url: `https://documents.internal/drivers/med_${d}.pdf`,
          notes: 'Vision and physical fitness clearance',
          ...timestamps,
        },
        {
          id: makeUuid(sIdx, 15, 20 + (d - 1) * 3 + 3),
          school_id: cfg.id,
          driver_id: driverId,
          document_type: 'POLICE_VERIFICATION',
          document_number: `PV-2025-00${sIdx}${d}`,
          issue_date: '2025-11-01',
          expiry_date: '2027-11-01',
          file_name: `police_verification_${d}.pdf`,
          file_url: `https://documents.internal/drivers/pv_${d}.pdf`,
          notes: 'Background check verified clear',
          ...timestamps,
        },
      );
    }
  }
  await queryInterface.bulkInsert('bus_documents', allBusDocs, options);
  await queryInterface.bulkInsert('driver_documents', allDriverDocs, options);

  // ---------------------------------------------------------------------------
  // 13. DOCUMENT REQUIREMENTS (Overrides)
  // ---------------------------------------------------------------------------
  const allDocReqs: Array<{
    id: string;
    school_id: string;
    owner_type: 'BUS' | 'DRIVER';
    document_type: string;
    is_required: boolean;
    expiry_warning_days: number;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;
    allDocReqs.push(
      {
        id: makeUuid(sIdx, 16, 1),
        school_id: cfg.id,
        owner_type: 'BUS',
        document_type: 'INSURANCE',
        is_required: true,
        expiry_warning_days: 45,
        ...timestamps,
      },
      {
        id: makeUuid(sIdx, 16, 2),
        school_id: cfg.id,
        owner_type: 'DRIVER',
        document_type: 'DRIVING_LICENSE',
        is_required: true,
        expiry_warning_days: 60,
        ...timestamps,
      },
    );
  }
  await queryInterface.bulkInsert('document_requirements', allDocReqs, options);

  // ---------------------------------------------------------------------------
  // 14. EMERGENCY EVENTS (1 Resolved, 1 Acknowledged)
  // ---------------------------------------------------------------------------
  const allEmergencies: Array<{
    id: string;
    school_id: string;
    trip_id: string;
    bus_id: string;
    route_id: string;
    raised_by_user_id: string;
    raised_by_role: 'DRIVER' | 'CONDUCTOR';
    type: string;
    status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'CANCELLED';
    message: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    triggered_at: Date;
    acknowledged_at: Date;
    acknowledged_by_user_id: string;
    resolved_at: Date | null;
    resolved_by_user_id: string | null;
    resolution_note: string | null;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;
    const adminId = makeUuid(sIdx, 2, 1);
    const driverId = makeUuid(sIdx, 3, 1);
    const conductorId = makeUuid(sIdx, 4, 2);

    allEmergencies.push(
      {
        id: makeUuid(sIdx, 17, 1),
        school_id: cfg.id,
        trip_id: makeUuid(sIdx, 11, 1),
        bus_id: makeUuid(sIdx, 6, 1),
        route_id: makeUuid(sIdx, 7, 1),
        raised_by_user_id: driverId,
        raised_by_role: 'DRIVER',
        type: 'BREAKDOWN',
        status: 'RESOLVED',
        message: 'Engine temperature indicator warning on Highway link.',
        latitude: +(cfg.latitude + 0.01).toFixed(6),
        longitude: +(cfg.longitude + 0.01).toFixed(6),
        accuracy: 5.0,
        triggered_at: new Date(`${TODAY_STR}T07:20:00.000Z`),
        acknowledged_at: new Date(`${TODAY_STR}T07:22:00.000Z`),
        acknowledged_by_user_id: adminId,
        resolved_at: new Date(`${TODAY_STR}T07:35:00.000Z`),
        resolved_by_user_id: adminId,
        resolution_note: 'Coolant level inspected and topped up. Trip resumed safely.',
        ...timestamps,
      },
      {
        id: makeUuid(sIdx, 17, 2),
        school_id: cfg.id,
        trip_id: makeUuid(sIdx, 11, 2),
        bus_id: makeUuid(sIdx, 6, 2),
        route_id: makeUuid(sIdx, 7, 2),
        raised_by_user_id: conductorId,
        raised_by_role: 'CONDUCTOR',
        type: 'OTHER',
        status: 'ACKNOWLEDGED',
        message: 'Heavy road construction traffic near Sector Market causing 10-15m delay.',
        latitude: +(cfg.latitude + 0.02).toFixed(6),
        longitude: +(cfg.longitude + 0.02).toFixed(6),
        accuracy: 8.0,
        triggered_at: new Date(`${TODAY_STR}T13:45:00.000Z`),
        acknowledged_at: new Date(`${TODAY_STR}T13:46:00.000Z`),
        acknowledged_by_user_id: adminId,
        resolved_at: null,
        resolved_by_user_id: null,
        resolution_note: null,
        ...timestamps,
      },
    );
  }
  await queryInterface.bulkInsert('emergency_events', allEmergencies, options);

  // ---------------------------------------------------------------------------
  // 15. NOTIFICATIONS
  // ---------------------------------------------------------------------------
  const allNotifications: Array<{
    id: string;
    school_id: string;
    user_id: string;
    type: string;
    trip_id: string;
    student_id: string;
    stop_id: string | null;
    title: string;
    message: string;
    is_read: boolean;
    read_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;
    const parent1 = makeUuid(sIdx, 5, 1);
    const student1 = makeUuid(sIdx, 9, 1);
    const trip1 = makeUuid(sIdx, 11, 1);
    const stop1 = makeUuid(sIdx, 8, 1);

    allNotifications.push(
      {
        id: makeUuid(sIdx, 18, 1),
        school_id: cfg.id,
        user_id: parent1,
        type: 'STUDENT_BOARDED',
        trip_id: trip1,
        student_id: student1,
        stop_id: stop1,
        title: 'Student Boarded Bus',
        message: 'Aarav Patel boarded Bus B-01 for the morning run.',
        is_read: true,
        read_at: new Date(`${TODAY_STR}T07:13:00.000Z`),
        ...timestamps,
      },
      {
        id: makeUuid(sIdx, 18, 2),
        school_id: cfg.id,
        user_id: parent1,
        type: 'STUDENT_DROPPED',
        trip_id: trip1,
        student_id: student1,
        stop_id: null,
        title: 'Student Arrived at School',
        message: 'Aarav Patel arrived safely at School North Gate.',
        is_read: true,
        read_at: new Date(`${TODAY_STR}T07:56:00.000Z`),
        ...timestamps,
      },
      {
        id: makeUuid(sIdx, 18, 3),
        school_id: cfg.id,
        user_id: parent1,
        type: 'TRIP_IN_PROGRESS',
        trip_id: makeUuid(sIdx, 11, 2),
        student_id: student1,
        stop_id: null,
        title: 'Afternoon Bus Dispatched',
        message: 'Bus B-02 has departed and is currently en route.',
        is_read: false,
        read_at: null,
        ...timestamps,
      },
    );
  }
  await queryInterface.bulkInsert('notifications', allNotifications, options);

  // ---------------------------------------------------------------------------
  // 16. IMPORT JOBS HISTORY
  // ---------------------------------------------------------------------------
  const allImportJobs: Array<{
    id: string;
    school_id: string;
    imported_by: string;
    module: string;
    mode: string;
    file_name: string;
    status: string;
    dry_run: boolean;
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    created_count: number;
    updated_count: number;
    skipped_count: number;
    summary: string;
    errors: string;
    unknown_columns: string;
    missing_columns: string;
    completed_at: Date;
    created_at: Date;
    updated_at: Date;
  }> = [];

  for (const cfg of SCHOOL_CONFIGS) {
    const sIdx = cfg.index;
    const adminId = makeUuid(sIdx, 2, 1);

    allImportJobs.push({
      id: makeUuid(sIdx, 22, 1),
      school_id: cfg.id,
      imported_by: adminId,
      module: 'students',
      mode: 'create',
      file_name: 'academic_year_students_2026.xlsx',
      status: 'completed',
      dry_run: false,
      total_rows: 52,
      valid_rows: 52,
      invalid_rows: 0,
      created_count: 52,
      updated_count: 0,
      skipped_count: 0,
      summary: JSON.stringify({ total: 52, created: 52, updated: 0, errors: 0 }),
      errors: JSON.stringify([]),
      unknown_columns: JSON.stringify([]),
      missing_columns: JSON.stringify([]),
      completed_at: new Date('2026-09-01T10:00:00.000Z'),
      ...timestamps,
    });
  }
  await queryInterface.bulkInsert('import_jobs', allImportJobs, options);

  // ---------------------------------------------------------------------------
  // 17. CONSOLE OUTPUT
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log('🚀 SCHOOL BUS TRACKING — COMPLETE SEED DATA GENERATED SUCCESSFULLY');
  console.log('='.repeat(80));

  console.log('\n👑 PLATFORM SUPER ADMIN:');
  console.log('   Role        : SUPER_ADMIN (Platform Console / All Schools)');
  console.log('   School Code : (Leave blank on login page)');
  console.log('   Email       : superadmin@gmail.com');
  console.log('   Password    : superadmin@gmail.com');
  console.log('   Login URL   : /login');

  console.log('\n' + '-'.repeat(80));
  console.log('🏫 4 SEEDED SCHOOLS WITH COMPLETE CONNECTED DATA:');
  console.log('-'.repeat(80));

  SCHOOL_CONFIGS.forEach((cfg) => {
    console.log(`\n🏫 School ${cfg.index}: ${cfg.name}`);
    console.log(`   School Code : ${cfg.code}`);
    console.log(`   Admin Name  : ${cfg.adminName.first} ${cfg.adminName.last}`);
    console.log(`   Admin Email : ${cfg.adminEmail}`);
    console.log(`   Password    : ${cfg.adminEmail}`);
    console.log(
      `   City / Plan : ${cfg.city}, ${cfg.state} (${cfg.planId === PLAN_IDS.ENTERPRISE ? 'Enterprise' : cfg.planId === PLAN_IDS.PRO ? 'Pro' : cfg.planId === PLAN_IDS.GROWTH ? 'Growth' : 'Basic'})`,
    );
    console.log(
      `   Data Seeded : 52 Students | 3 Buses | 3 Routes | 15 Stops | 3 Drivers | 3 Conductors | 26 Parents | 3 Trips | Attendance & GPS`,
    );
  });

  console.log('\n' + '-'.repeat(80));
  console.log('🔑 CREDENTIALS RULE FOR ALL SEEDED ACCOUNTS:');
  console.log('   Password is ALWAYS IDENTICAL to the Email address.');
  console.log('   Examples:');
  console.log('   - School 1 Admin : green@gmail.com            / green@gmail.com');
  console.log('   - School 2 Admin : riverside@gmail.com        / riverside@gmail.com');
  console.log('   - School 3 Admin : oakwood@gmail.com          / oakwood@gmail.com');
  console.log('   - School 4 Admin : maple@gmail.com            / maple@gmail.com');
  console.log('   - Drivers        : driver1.green@gmail.com    / driver1.green@gmail.com');
  console.log('   - Conductors     : conductor1.green@gmail.com / conductor1.green@gmail.com');
  console.log('   - Parents        : parent1.green@gmail.com    / parent1.green@gmail.com');
  console.log('='.repeat(80) + '\n');
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  for (const cfg of SCHOOL_CONFIGS) {
    const scope = { school_id: cfg.id };
    await queryInterface.bulkDelete('import_jobs', scope, {});
    await queryInterface.bulkDelete('notifications', scope, {});
    await queryInterface.bulkDelete('emergency_events', scope, {});
    await queryInterface.bulkDelete('document_requirements', scope, {});
    await queryInterface.bulkDelete('driver_documents', scope, {});
    await queryInterface.bulkDelete('bus_documents', scope, {});
    await queryInterface.bulkDelete('trip_student_attendance', scope, {});
    await queryInterface.bulkDelete('trip_stop_arrivals', scope, {});
    await queryInterface.bulkDelete('trip_locations', scope, {});
    await queryInterface.bulkDelete('trips', scope, {});
    await queryInterface.bulkDelete('route_assignments', scope, {});
    await queryInterface.bulkDelete('student_guardians', scope, {});
    await queryInterface.bulkDelete('students', scope, {});
    await queryInterface.bulkDelete('stops', scope, {});
    await queryInterface.bulkDelete('routes', scope, {});
    await queryInterface.bulkDelete('buses', scope, {});
    await queryInterface.bulkDelete('users', scope, {});
    await queryInterface.bulkDelete('school_subscriptions', scope, {});
    await queryInterface.bulkDelete('schools', { id: cfg.id }, {});
  }

  for (const planId of Object.values(PLAN_IDS)) {
    await queryInterface.bulkDelete('plans', { id: planId }, {});
  }
}
