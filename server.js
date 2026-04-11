import express from "express";
import pg from "pg";
import path from "path";
import fs from "fs";
import bcrypt from "bcrypt";
import multer from "multer";
import session from "express-session"; // Added for sessions
import { fileURLToPath } from 'url';
import flash from 'connect-flash';
import dotenv from 'dotenv';

dotenv.config(); 


// ES Module workaround for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 10;
const videosUploadDir = path.join(__dirname, 'public', 'videos', 'uploads');

if (!fs.existsSync(videosUploadDir)) {
  fs.mkdirSync(videosUploadDir, { recursive: true });
}

const allowedVideoMimeTypes = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo'
]);

const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, videosUploadDir);
  },
  filename: (_req, file, cb) => {
    const originalExtension = path.extname(file.originalname) || '.mp4';
    const safeBaseName = path
      .basename(file.originalname, originalExtension)
      .replace(/[^a-zA-Z0-9-_]/g, '')
      .slice(0, 40) || 'lesson';

    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeBaseName}${originalExtension.toLowerCase()}`);
  }
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: {
    fileSize: 300 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (allowedVideoMimeTypes.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error('Only MP4, WebM, MOV, or AVI videos are supported.'));
  }
});

// Database Client Setup
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// const db = new pg.Client({
//   user: 'postgres',
//   host: 'localhost',
//   database: 'GyanGanga',
//   password: '12345', // Replace with your actual password
//   port: 5432,
// });

// First, connect to the database
db.query('SELECT 1')
  .then(() => {
    console.log('🟢 Successfully connected to the database.');
  })
  .catch((err) => {
    console.error('🔴 Database connectivity check failed. Requests may fail until DB recovers.', err.message);
  });

// --- Configuration & Middleware ---
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

  // Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Session Middleware Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'GyanGangaSecretKey',
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));
app.use(flash());

// --- Helper Functions for Database Logic ---

async function handleSignup(fullName, username, email, password, role) {
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const result = await db.query(
      "INSERT INTO users (full_name, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [fullName, username, email, hashedPassword, role]
    );
    console.log("✅ New user created:", result.rows[0]);
    return { success: true };
  } catch (err) {
    console.error("❌ Error during signup:", err.message);
    return { success: false, error: err };
  }
}

async function handleLogin(username, password) {
  try {
    const result = await db.query("SELECT * FROM users WHERE username = $1", [username]);
    if (result.rows.length === 0) {
      return { success: false };
    }
    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (passwordMatch) {
      return { success: true, user: user };
    } else {
      return { success: false };
    }
  } catch (err) {
    console.error("❌ Error during login:", err);
    return { success: false, error: err };
  }
}

function generateClassCode(length = 6) {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters[randomIndex];
  }
  return code;
}

async function createUniqueClassCode() {
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const classCode = generateClassCode();
    const existing = await db.query("SELECT id FROM classrooms WHERE class_code = $1", [classCode]);

    if (existing.rows.length === 0) {
      return classCode;
    }
  }

  throw new Error('Unable to generate a unique classroom code.');
}

const assessmentConfigs = {
  quiz: {
    table: 'quizzes',
    label: 'Quizzes',
    studentPath: '/quizzes',
    xpPerCorrect: 10
  },
  test: {
    table: 'tests',
    label: 'Tests',
    studentPath: '/tests',
    xpPerCorrect: 12
  },
  q_assignment: {
    table: 'q_assignments',
    label: 'Assignments',
    studentPath: '/assignments',
    xpPerCorrect: 8
  }
};

const studentPathToAssessmentType = {
  '/quizzes': 'quiz',
  '/tests': 'test',
  '/assignments': 'q_assignment'
};

function getAssessmentConfig(assessmentType) {
  return assessmentConfigs[assessmentType] || null;
}

function normalizeQuestionOptions(optionsValue) {
  if (!optionsValue) {
    return {};
  }

  if (typeof optionsValue === 'object') {
    return optionsValue;
  }

  try {
    return JSON.parse(optionsValue);
  } catch (_err) {
    return {};
  }
}

function calculateBadgesFromXp(xp) {
  const numericXp = Number(xp) || 0;
  if (numericXp >= 2200) return 6;
  if (numericXp >= 1500) return 5;
  if (numericXp >= 1000) return 4;
  if (numericXp >= 600) return 3;
  if (numericXp >= 300) return 2;
  if (numericXp >= 100) return 1;
  return 0;
}

const teacherAssessmentTypeLabels = {
  quiz: 'Quiz',
  test: 'Test',
  q_assignment: 'Assignment'
};

async function getTeacherAssessmentsWithStats(teacherId) {
  const assessmentTypes = Object.keys(assessmentConfigs);

  const groupedAssessments = await Promise.all(
    assessmentTypes.map(async (assessmentType) => {
      const config = getAssessmentConfig(assessmentType);
      const result = await db.query(
        `SELECT
          a.id,
          a.title,
          a.description,
          a.created_at,
          c.class_name,
          c.class_code,
          COUNT(s.id)::INT AS submission_count,
          COALESCE(
            ROUND(
              AVG(
                CASE
                  WHEN s.total_questions > 0 THEN (s.score::numeric / s.total_questions) * 100
                  ELSE NULL
                END
              ),
              1
            ),
            0
          ) AS average_score_percentage
        FROM ${config.table} a
        JOIN classrooms c ON c.id = a.classroom_id
        LEFT JOIN assessment_submissions s
          ON s.assessment_id = a.id
         AND s.assessment_type = $2
        WHERE c.teacher_id = $1
        GROUP BY a.id, c.class_name, c.class_code
        ORDER BY a.created_at DESC`,
        [teacherId, assessmentType]
      );

      return result.rows.map((row) => ({
        ...row,
        assessment_type: assessmentType,
        assessment_type_label: teacherAssessmentTypeLabels[assessmentType] || assessmentType,
        average_score_percentage: Number(row.average_score_percentage || 0)
      }));
    })
  );

  const assessments = groupedAssessments.flat();
  assessments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return assessments;
}

// --- Routes ---
app.get('/', async (req, res) => {
if (req.session.user) {
  // Check the user's role
  if (req.session.user.role === 'teacher') {
    res.render('teacher_dashboard', { user: req.session.user });
  } else {
    try {
      const enrolledClassesResult = await db.query(
        `SELECT
          c.id,
          c.class_name,
          c.subject,
          c.grade_level,
          c.class_code,
          u.full_name AS teacher_name
        FROM classroom_enrollments ce
        JOIN classrooms c ON c.id = ce.classroom_id
        LEFT JOIN users u ON u.id = c.teacher_id
        WHERE ce.student_id = $1
        ORDER BY ce.joined_at DESC`,
        [req.session.user.id]
      );

      res.render('home', {
        user: req.session.user,
        enrolledClasses: enrolledClassesResult.rows,
        messages: req.flash()
      }); // Student homepage
    } catch (err) {
      console.error('Error loading student homepage:', err);
      res.render('home', {
        user: req.session.user,
        enrolledClasses: [],
        messages: req.flash()
      });
    }
  }
} else {
  // If no user is logged in, render the public landing page
  res.render('index', { user: null });
}
});

// UPDATED: Dashboard route also forks based on user role
app.get('/dashboard', async (req, res) => {
if (req.session.user) {
  if (req.session.user.role === 'teacher') {
    res.render('teacher_dashboard', { user: req.session.user });
  } else {
    try {
      const userStatsResult = await db.query(
        `SELECT
          COALESCE(xp, 0) AS xp,
          COALESCE(gyaan_coins, FLOOR(COALESCE(xp, 0) / 5.0)::INT) AS gyaan_coins,
          COALESCE(
            badges_earned,
            CASE
              WHEN COALESCE(xp, 0) >= 2200 THEN 6
              WHEN COALESCE(xp, 0) >= 1500 THEN 5
              WHEN COALESCE(xp, 0) >= 1000 THEN 4
              WHEN COALESCE(xp, 0) >= 600 THEN 3
              WHEN COALESCE(xp, 0) >= 300 THEN 2
              WHEN COALESCE(xp, 0) >= 100 THEN 1
              ELSE 0
            END
          ) AS badges_earned
         FROM users
         WHERE id = $1`,
        [req.session.user.id]
      );

      const statsRow = userStatsResult.rows[0] || {};
      const xp = Number(statsRow.xp || 0);
      const coins = Number(statsRow.gyaan_coins || Math.floor(xp / 5));
      const badges = Number(statsRow.badges_earned ?? calculateBadgesFromXp(xp));

      const categoryTotalsResult = await db.query(
        `SELECT
          t.category,
          COUNT(m.id)::INT AS total_missions
        FROM topics t
        LEFT JOIN missions m ON m.topic_id = t.id
        GROUP BY t.category`
      );

      const categoryVisitedResult = await db.query(
        `SELECT
          t.category,
          COUNT(DISTINCT smp.mission_id)::INT AS visited_missions
        FROM student_mission_progress smp
        JOIN missions m ON m.id = smp.mission_id
        JOIN topics t ON t.id = m.topic_id
        WHERE smp.student_id = $1
        GROUP BY t.category`,
        [req.session.user.id]
      );

      const defaultCategories = ['maths', 'science', 'technology', 'engineering'];
      const progress = Object.fromEntries(defaultCategories.map((category) => [category, 0]));

      const visitedByCategory = new Map(
        categoryVisitedResult.rows.map((row) => [row.category, row.visited_missions])
      );

      for (const row of categoryTotalsResult.rows) {
        if (!row.category) {
          continue;
        }

        const totalMissions = row.total_missions || 0;
        const visitedMissions = visitedByCategory.get(row.category) || 0;
        const percentage = totalMissions > 0 ? Math.round((visitedMissions / totalMissions) * 100) : 0;

        progress[row.category] = Math.max(0, Math.min(100, percentage));
      }

      res.render('dashboard', {
        user: req.session.user,
        progress,
        stats: {
          xp,
          coins,
          badges
        }
      });
    } catch (err) {
      console.error('Error loading dynamic dashboard:', err);
      res.render('dashboard', {
        user: req.session.user,
        progress: {
          maths: 0,
          science: 0,
          technology: 0,
          engineering: 0
        },
        stats: {
          xp: 0,
          coins: 0,
          badges: 0
        }
      });
    }
  }
} else {
  res.redirect('/login');
}
});

// Static routes for login/signup pages
app.get('/login', (req, res) => {
// Pass any flash messages to the template
res.render('login', { messages: req.flash() }); 
});

app.get('/signup', (req, res) => {
// Pass any flash messages to the template
res.render('register', { messages: req.flash() });
});

// Logout Route
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return console.error(err);
    }
    res.redirect('/'); // Redirect to homepage after logout
  });
});

app.post('/signup', async (req, res) => {
const { fullName, username, email, password, confirmPassword, role } = req.body;
const allowedRoles = new Set(['student', 'teacher']);

if (!allowedRoles.has(role)) {
  req.flash('error', 'Please select a valid account role.');
  return res.redirect('/signup');
}

if (!password || password !== confirmPassword) {
  req.flash('error', 'Password and confirm password must match.');
  return res.redirect('/signup');
}

const result = await handleSignup(fullName, username, email, password, role);

if (result.success) {
  req.flash('success', 'Registration successful! You can now log in.');
  res.redirect('/login');
} else {
  req.flash('error', 'An error occurred. The username or email may be taken.');
  res.redirect('/signup');
}
});

app.post('/login', async (req, res) => {
const { username, password, role } = req.body;
const allowedRoles = new Set(['student', 'teacher']);

if (!allowedRoles.has(role)) {
  req.flash('error', 'Please choose a valid role to log in.');
  return res.redirect('/login');
}

const result = await handleLogin(username, password);

if (result.success) {
  if (result.user.role !== role) {
    req.flash('error', `This account is registered as ${result.user.role}. Please choose the correct role.`);
    return res.redirect('/login');
  }

  req.session.user = result.user;
  res.redirect('/');
} else {
  req.flash('error', 'Invalid username or password.');
  res.redirect('/login');
}
});

// GET Route to display the profile page
app.get('/profile', async (req, res) => {
  // Check if the user is logged in
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    // Fetch the latest user data from the database
    const result = await db.query("SELECT * FROM users WHERE id = $1", [req.session.user.id]);
    const currentUser = result.rows[0];
    
    // Render the profile page with the user's data
    res.render('profile', { user: currentUser });
  } catch (err) {
    console.error("Error fetching user for profile:", err);
    res.redirect('/');
  }
});

// POST Route to update the user's profile
app.post('/profile', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  // Get the form data from the request body
  const { fullName, email, phoneNumber, schoolName, grade, city } = req.body;
  const userId = req.session.user.id;

  try {
    // Update the user's data in the database
    await db.query(
      `UPDATE users 
       SET full_name = $1, email = $2, phone_number = $3, school_name = $4, grade = $5, city = $6 
       WHERE id = $7`,
      [fullName, email, phoneNumber, schoolName, grade, city, userId]
    );

    // IMPORTANT: Update the session data as well so the header shows the new name
    req.session.user.full_name = fullName;
    
    // Redirect back to the profile page to show the changes
    res.redirect('/profile');
  } catch (err) {
    console.error("Error updating profile:", err);
    // Optionally, you could use connect-flash here to show an error message
    res.redirect('/profile');
  }
});

app.post('/student/join-class', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'student') {
    return res.redirect('/login');
  }

  const classCode = String(req.body.class_code || '').trim().toUpperCase();

  if (!classCode) {
    req.flash('error', 'Please enter a classroom code.');
    return res.redirect('/');
  }

  try {
    const classroomResult = await db.query(
      'SELECT id, class_name FROM classrooms WHERE class_code = $1',
      [classCode]
    );

    if (classroomResult.rows.length === 0) {
      req.flash('error', 'Classroom code not found. Please check and try again.');
      return res.redirect('/');
    }

    const classroom = classroomResult.rows[0];
    const enrollmentResult = await db.query(
      `INSERT INTO classroom_enrollments (classroom_id, student_id)
       VALUES ($1, $2)
       ON CONFLICT (classroom_id, student_id) DO NOTHING
       RETURNING id`,
      [classroom.id, req.session.user.id]
    );

    if (enrollmentResult.rows.length === 0) {
      req.flash('error', `You are already enrolled in ${classroom.class_name}.`);
      return res.redirect('/');
    }

    req.flash('success', `Successfully joined ${classroom.class_name}.`);
    res.redirect('/');
  } catch (err) {
    console.error('Error joining classroom:', err);
    req.flash('error', 'Unable to join classroom right now.');
    res.redirect('/');
  }
});

app.get('/courses/:category', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const category = req.params.category;
  
  try {
    const result = await db.query(
      `SELECT
        t.*,
        (
          SELECT m.id
          FROM missions m
          WHERE m.topic_id = t.id
          ORDER BY m.mission_order ASC
          LIMIT 1
        ) AS first_mission_id
      FROM topics t
      WHERE t.category = $1
      ORDER BY t.grade_level, t.topic_name`,
      [category]
    );
    const topics = result.rows;
    
    // Render the new template, passing the topics and category name
    res.render('course_category', { 
      user: req.session.user, 
      topics: topics, 
      category: category 
    });
  } catch (err) {
    console.error("Error fetching course topics:", err);
    res.redirect('/');
  }
});

app.get('/search', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const rawQuery = req.query.query || req.query.q || '';
  const searchQuery = String(rawQuery).trim();

  if (!searchQuery) {
    return res.render('search_results', {
      user: req.session.user,
      searchQuery,
      topics: [],
      missions: [],
      videos: []
    });
  }

  const likeQuery = `%${searchQuery}%`;

  try {
    const topicsResult = await db.query(
      `SELECT
        id,
        topic_name,
        description,
        category,
        grade_level
      FROM topics
      WHERE topic_name ILIKE $1 OR description ILIKE $1
      ORDER BY topic_name ASC
      LIMIT 20`,
      [likeQuery]
    );

    const missionsResult = await db.query(
      `SELECT
        m.id,
        m.mission_title,
        m.mission_description,
        m.mission_order,
        t.topic_name,
        t.category,
        t.grade_level
      FROM missions m
      JOIN topics t ON t.id = m.topic_id
      WHERE m.mission_title ILIKE $1
         OR m.mission_description ILIKE $1
         OR t.topic_name ILIKE $1
      ORDER BY t.topic_name ASC, m.mission_order ASC
      LIMIT 20`,
      [likeQuery]
    );

    const videosResult = await db.query(
      `SELECT
        v.id,
        v.mission_id,
        v.video_title,
        v.video_description,
        v.language,
        v.quality,
        m.mission_title,
        t.topic_name
      FROM videos v
      JOIN missions m ON m.id = v.mission_id
      JOIN topics t ON t.id = m.topic_id
      WHERE v.video_title ILIKE $1
         OR v.video_description ILIKE $1
         OR m.mission_title ILIKE $1
      ORDER BY v.video_title ASC
      LIMIT 20`,
      [likeQuery]
    );

    res.render('search_results', {
      user: req.session.user,
      searchQuery,
      topics: topicsResult.rows,
      missions: missionsResult.rows,
      videos: videosResult.rows
    });
  } catch (err) {
    console.error('Error searching content:', err);
    req.flash('error', 'Unable to run search right now.');
    res.redirect('/dashboard');
  }
});

// NEW: Mission Playback Route
app.get('/mission/:id', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const missionId = parseInt(req.params.id);

    try {
        // Fetch the current mission details
        const missionResult = await db.query(
            "SELECT m.*, t.topic_name, t.grade_level FROM missions m JOIN topics t ON m.topic_id = t.id WHERE m.id = $1",
            [missionId]
        );
        if (missionResult.rows.length === 0) {
            return res.status(404).send('Mission not found!');
        }
        const currentMission = missionResult.rows[0];

        // Fetch all videos for this mission, ordered
        const videosResult = await db.query(
            "SELECT * FROM videos WHERE mission_id = $1 ORDER BY video_order, language, quality",
            [missionId]
        );
        const videos = videosResult.rows;

        if (videos.length === 0) {
          return res.status(404).send('No videos available for this mission yet.');
        }

        // Fetch all missions for the same topic (for "Upcoming Missions")
        const topicMissionsResult = await db.query(
            "SELECT id, mission_title, mission_order FROM missions WHERE topic_id = $1 ORDER BY mission_order",
            [currentMission.topic_id]
        );
        const allTopicMissions = topicMissionsResult.rows;

        if (req.session.user.role === 'student') {
          await db.query(
            `INSERT INTO student_mission_progress (student_id, mission_id, status, visit_count, last_watched_at)
             VALUES ($1, $2, 'visited', 1, CURRENT_TIMESTAMP)
             ON CONFLICT (student_id, mission_id)
             DO UPDATE SET
               status = 'visited',
               visit_count = student_mission_progress.visit_count + 1,
               last_watched_at = CURRENT_TIMESTAMP`,
            [req.session.user.id, missionId]
          );
        }

        // Determine current video (for now, just the first video of the mission)
        // In a real app, you'd store/retrieve the user's progress to know which video to play next.
        const currentVideo = videos.find(v => v.video_order === 1 && v.language === 'english' && v.quality === '720p') || videos[0];


        res.render('mission', {
            user: req.session.user,
            currentMission: currentMission,
            videos: videos, // All videos for the current mission
            currentVideo: currentVideo, // The video currently playing
            allTopicMissions: allTopicMissions // All missions in the topic
        });

    } catch (err) {
        console.error("Error fetching mission details:", err);
        res.status(500).send('Error loading mission.');
    }
});

app.get(['/quizzes', '/tests', '/assignments'], async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  if (req.session.user.role !== 'student') {
    return res.redirect('/dashboard');
  }

  const assessmentType = studentPathToAssessmentType[req.path];
  const config = getAssessmentConfig(assessmentType);

  if (!config) {
    return res.status(404).send('Assessment category not found.');
  }

  try {
    const assessmentsResult = await db.query(
      `SELECT
        a.id,
        a.title,
        a.description,
        a.due_date,
        a.created_at,
        c.class_name,
        COUNT(q.id)::INT AS question_count,
        s.score,
        s.total_questions,
        s.submitted_at
      FROM ${config.table} a
      JOIN classrooms c ON c.id = a.classroom_id
      JOIN classroom_enrollments ce ON ce.classroom_id = c.id
      LEFT JOIN questions q ON q.assessment_id = a.id AND q.assessment_type = $2
      LEFT JOIN LATERAL (
        SELECT
          score,
          total_questions,
          submitted_at
        FROM assessment_submissions s1
        WHERE s1.student_id = $1
          AND s1.assessment_type = $2
          AND s1.assessment_id = a.id
        ORDER BY s1.submitted_at DESC
        LIMIT 1
      ) s ON TRUE
      WHERE ce.student_id = $1
      GROUP BY
        a.id,
        a.title,
        a.description,
        a.due_date,
        a.created_at,
        c.class_name,
        s.score,
        s.total_questions,
        s.submitted_at
      ORDER BY COALESCE(a.due_date, a.created_at) ASC NULLS LAST, a.created_at DESC`,
      [req.session.user.id, assessmentType]
    );

    res.render('student_assessments', {
      user: req.session.user,
      assessmentType,
      assessmentLabel: config.label,
      assessments: assessmentsResult.rows,
      messages: req.flash()
    });
  } catch (err) {
    console.error('Error loading student assessments:', err);
    req.flash('error', 'Unable to load assessments right now.');
    res.redirect('/dashboard');
  }
});

app.get('/assessments/:type/:id', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  if (req.session.user.role !== 'student') {
    return res.redirect('/dashboard');
  }

  const assessmentType = req.params.type;
  const assessmentId = Number.parseInt(req.params.id, 10);
  const config = getAssessmentConfig(assessmentType);

  if (!config || Number.isNaN(assessmentId)) {
    return res.status(404).send('Assessment not found.');
  }

  try {
    const assessmentResult = await db.query(
      `SELECT
        a.id,
        a.title,
        a.description,
        a.due_date,
        a.created_at,
        c.class_name
      FROM ${config.table} a
      JOIN classrooms c ON c.id = a.classroom_id
      JOIN classroom_enrollments ce ON ce.classroom_id = c.id
      WHERE ce.student_id = $1 AND a.id = $2`,
      [req.session.user.id, assessmentId]
    );

    if (assessmentResult.rows.length === 0) {
      return res.status(404).send('Assessment not available for this student.');
    }

    const questionsResult = await db.query(
      `SELECT
        id,
        question_text,
        options
      FROM questions
      WHERE assessment_id = $1 AND assessment_type = $2
      ORDER BY id ASC`,
      [assessmentId, assessmentType]
    );

    const previousSubmissionResult = await db.query(
      `SELECT
        score,
        total_questions,
        submitted_at
      FROM assessment_submissions
      WHERE student_id = $1 AND assessment_type = $2 AND assessment_id = $3
      ORDER BY submitted_at DESC
      LIMIT 1`,
      [req.session.user.id, assessmentType, assessmentId]
    );

    const questions = questionsResult.rows.map((question) => ({
      ...question,
      options: normalizeQuestionOptions(question.options)
    }));

    res.render('take_assessment', {
      user: req.session.user,
      assessmentType,
      assessmentLabel: config.label,
      assessmentPath: config.studentPath,
      assessment: assessmentResult.rows[0],
      questions,
      previousSubmission: previousSubmissionResult.rows[0] || null,
      messages: req.flash()
    });
  } catch (err) {
    console.error('Error loading assessment attempt page:', err);
    req.flash('error', 'Could not open this assessment right now.');
    res.redirect('/dashboard');
  }
});

app.post('/assessments/:type/:id/submit', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  if (req.session.user.role !== 'student') {
    return res.redirect('/dashboard');
  }

  const assessmentType = req.params.type;
  const assessmentId = Number.parseInt(req.params.id, 10);
  const config = getAssessmentConfig(assessmentType);

  if (!config || Number.isNaN(assessmentId)) {
    return res.status(404).send('Assessment not found.');
  }

  const selectedAnswers = (typeof req.body.answers === 'object' && req.body.answers !== null)
    ? req.body.answers
    : {};
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const accessResult = await client.query(
      `SELECT a.id
       FROM ${config.table} a
       JOIN classrooms c ON c.id = a.classroom_id
       JOIN classroom_enrollments ce ON ce.classroom_id = c.id
       WHERE ce.student_id = $1 AND a.id = $2`,
      [req.session.user.id, assessmentId]
    );

    if (accessResult.rows.length === 0) {
      await client.query('ROLLBACK');
      req.flash('error', 'Assessment not available for this student.');
      return res.redirect(config.studentPath);
    }

    const questionsResult = await client.query(
      `SELECT
        id,
        correct_answer
      FROM questions
      WHERE assessment_id = $1 AND assessment_type = $2
      ORDER BY id ASC`,
      [assessmentId, assessmentType]
    );

    if (questionsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      req.flash('error', 'This assessment has no questions yet.');
      return res.redirect(`/assessments/${assessmentType}/${assessmentId}`);
    }

    let score = 0;
    const normalizedAnswers = {};

    for (const question of questionsResult.rows) {
      const fallbackAnswerKey = `answers[${question.id}]`;
      const bracketKeyAnswer = Object.entries(req.body).find(([key]) => key.includes(`[${question.id}]`))?.[1];
      const arrayAnswer = Array.isArray(selectedAnswers) ? selectedAnswers[0] : undefined;
      const rawAnswer =
        selectedAnswers[String(question.id)] ??
        selectedAnswers[question.id] ??
        req.body[fallbackAnswerKey] ??
        bracketKeyAnswer ??
        arrayAnswer ??
        '';
      const answerText = String(rawAnswer).trim();
      normalizedAnswers[question.id] = answerText;

      if (answerText && answerText === question.correct_answer) {
        score += 1;
      }
    }

    const totalQuestions = questionsResult.rows.length;

    const previousSubmissionResult = await client.query(
      `SELECT score
       FROM assessment_submissions
       WHERE student_id = $1 AND assessment_type = $2 AND assessment_id = $3
       ORDER BY submitted_at DESC
       LIMIT 1`,
      [req.session.user.id, assessmentType, assessmentId]
    );

    const previousScore = previousSubmissionResult.rows[0]?.score || 0;

    await client.query(
      `INSERT INTO assessment_submissions
        (student_id, assessment_id, assessment_type, answers, score, total_questions)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (student_id, assessment_type, assessment_id)
       DO UPDATE SET
         answers = EXCLUDED.answers,
         score = EXCLUDED.score,
         total_questions = EXCLUDED.total_questions,
         submitted_at = CURRENT_TIMESTAMP`,
      [
        req.session.user.id,
        assessmentId,
        assessmentType,
        JSON.stringify(normalizedAnswers),
        score,
        totalQuestions
      ]
    );

    const xpDelta = Math.max(0, score - previousScore) * config.xpPerCorrect;
    if (xpDelta > 0) {
      const xpUpdateResult = await client.query(
        `UPDATE users
         SET
           xp = COALESCE(xp, 0) + $1,
           gyaan_coins = FLOOR((COALESCE(xp, 0) + $1) / 5.0)::INT,
           badges_earned = CASE
             WHEN (COALESCE(xp, 0) + $1) >= 2200 THEN 6
             WHEN (COALESCE(xp, 0) + $1) >= 1500 THEN 5
             WHEN (COALESCE(xp, 0) + $1) >= 1000 THEN 4
             WHEN (COALESCE(xp, 0) + $1) >= 600 THEN 3
             WHEN (COALESCE(xp, 0) + $1) >= 300 THEN 2
             WHEN (COALESCE(xp, 0) + $1) >= 100 THEN 1
             ELSE 0
           END
         WHERE id = $2
         RETURNING xp, gyaan_coins, badges_earned`,
        [xpDelta, req.session.user.id]
      );

      if (xpUpdateResult.rows.length > 0) {
        req.session.user.xp = xpUpdateResult.rows[0].xp;
        req.session.user.gyaan_coins = xpUpdateResult.rows[0].gyaan_coins;
        req.session.user.badges_earned = xpUpdateResult.rows[0].badges_earned;
      }
    }

    await client.query('COMMIT');

    req.flash(
      'success',
      `Submitted successfully. Score: ${score}/${totalQuestions}${xpDelta > 0 ? ` (+${xpDelta} XP)` : ''}`
    );
    res.redirect(`/assessments/${assessmentType}/${assessmentId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error submitting assessment:', err);
    req.flash('error', 'Could not submit assessment right now.');
    res.redirect(`/assessments/${assessmentType}/${assessmentId}`);
  } finally {
    client.release();
  }
});

app.get('/teacher/my-classes', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  try {
    const classroomsResult = await db.query(
      `SELECT
        c.id,
        c.class_name,
        c.class_code,
        c.subject,
        c.grade_level,
        c.created_at,
        COUNT(ce.student_id)::INT AS student_count,
        COALESCE(
          json_agg(
            json_build_object(
              'id', u.id,
              'full_name', u.full_name,
              'username', u.username,
              'email', u.email
            )
          ) FILTER (WHERE u.id IS NOT NULL),
          '[]'::json
        ) AS students
      FROM classrooms c
      LEFT JOIN classroom_enrollments ce ON ce.classroom_id = c.id
      LEFT JOIN users u ON u.id = ce.student_id
      WHERE c.teacher_id = $1
      GROUP BY c.id
      ORDER BY c.created_at DESC`,
      [req.session.user.id]
    );

    res.render('teacher_classrooms', {
      user: req.session.user,
      classrooms: classroomsResult.rows,
      messages: req.flash()
    });
  } catch (err) {
    console.error('Error fetching classrooms:', err);
    req.flash('error', 'Unable to load classrooms right now.');
    res.redirect('/dashboard');
  }
});

app.post('/teacher/my-classes', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  const className = (req.body.class_name || '').trim();
  const subject = (req.body.subject || '').trim() || null;
  const gradeLevelRaw = (req.body.grade_level || '').trim();
  const gradeLevel = gradeLevelRaw ? Number.parseInt(gradeLevelRaw, 10) : null;

  if (!className) {
    req.flash('error', 'Classroom name is required.');
    return res.redirect('/teacher/my-classes');
  }

  if (gradeLevel !== null && (Number.isNaN(gradeLevel) || gradeLevel < 1 || gradeLevel > 12)) {
    req.flash('error', 'Grade level must be between 1 and 12.');
    return res.redirect('/teacher/my-classes');
  }

  try {
    const classCode = await createUniqueClassCode();

    await db.query(
      `INSERT INTO classrooms (class_name, class_code, subject, grade_level, teacher_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [className, classCode, subject, gradeLevel, req.session.user.id]
    );

    req.flash('success', 'Classroom created successfully.');
    res.redirect('/teacher/my-classes');
  } catch (err) {
    console.error('Error creating classroom:', err);
    req.flash('error', 'Could not create classroom. Please try again.');
    res.redirect('/teacher/my-classes');
  }
});

app.get('/teacher/my-students', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  const searchQuery = (req.query.q || '').trim();

  try {
    const searchParams = [req.session.user.id];
    let searchFilter = '';

    if (searchQuery) {
      searchParams.push(`%${searchQuery}%`);
      searchFilter = `
        AND (
          u.full_name ILIKE $2
          OR u.username ILIKE $2
          OR u.email ILIKE $2
        )
      `;
    }

    const studentsResult = await db.query(
      `SELECT
        u.id,
        u.full_name,
        u.username,
        u.email,
        u.city,
        u.grade,
        u.school_name,
        u.xp,
        COUNT(DISTINCT ce.classroom_id)::INT AS classrooms_count,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', c.id,
              'class_name', c.class_name,
              'class_code', c.class_code,
              'subject', c.subject,
              'grade_level', c.grade_level
            )
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'::json
        ) AS classrooms
      FROM classroom_enrollments ce
      JOIN classrooms c ON c.id = ce.classroom_id
      JOIN users u ON u.id = ce.student_id
      WHERE c.teacher_id = $1
      ${searchFilter}
      GROUP BY u.id
      ORDER BY u.full_name ASC`,
      searchParams
    );

    const statsResult = await db.query(
      `SELECT
        COUNT(DISTINCT ce.student_id)::INT AS total_students,
        COUNT(DISTINCT ce.classroom_id)::INT AS active_classrooms
      FROM classroom_enrollments ce
      JOIN classrooms c ON c.id = ce.classroom_id
      WHERE c.teacher_id = $1`,
      [req.session.user.id]
    );

    const stats = statsResult.rows[0] || { total_students: 0, active_classrooms: 0 };

    res.render('teacher_students', {
      user: req.session.user,
      students: studentsResult.rows,
      searchQuery,
      stats,
      messages: req.flash()
    });
  } catch (err) {
    console.error('Error loading students page:', err);
    req.flash('error', 'Unable to load student data right now.');
    res.redirect('/dashboard');
  }
});

app.get('/teacher/upload-video', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  try {
    const missionsResult = await db.query(
      `SELECT
        m.id,
        m.mission_title,
        m.mission_order,
        t.topic_name,
        t.category,
        t.grade_level
      FROM missions m
      JOIN topics t ON t.id = m.topic_id
      ORDER BY t.category, t.topic_name, m.mission_order`
    );

    res.render('upload_video', {
      user: req.session.user,
      missions: missionsResult.rows,
      messages: req.flash()
    });
  } catch (err) {
    console.error('Error loading upload video page:', err);
    req.flash('error', 'Unable to load upload page right now.');
    res.redirect('/dashboard');
  }
});

app.post('/teacher/upload-video', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  uploadVideo.single('video_file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      req.flash('error', uploadErr.message || 'Video upload failed.');
      return res.redirect('/teacher/upload-video');
    }

    const missionId = Number.parseInt(req.body.mission_id, 10);
    const videoTitle = (req.body.video_title || '').trim();
    const videoDescription = (req.body.video_description || '').trim() || null;
    const videoOrder = Number.parseInt(req.body.video_order, 10);
    const language = (req.body.language || '').trim().toLowerCase();
    const quality = (req.body.quality || '').trim().toLowerCase();

    const allowedLanguages = new Set(['english', 'hindi', 'telugu']);
    const allowedQualities = new Set(['360p', '480p', '720p', '1080p']);

    const removeUploadedFile = () => {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    };

    if (!req.file) {
      req.flash('error', 'Please select a video file to upload.');
      return res.redirect('/teacher/upload-video');
    }

    if (!missionId || Number.isNaN(missionId) || !videoTitle || !videoOrder || Number.isNaN(videoOrder) || videoOrder < 1) {
      removeUploadedFile();
      req.flash('error', 'Mission, title, and a valid video order are required.');
      return res.redirect('/teacher/upload-video');
    }

    if (!allowedLanguages.has(language) || !allowedQualities.has(quality)) {
      removeUploadedFile();
      req.flash('error', 'Invalid language or quality selected.');
      return res.redirect('/teacher/upload-video');
    }

    try {
      const missionCheck = await db.query('SELECT id FROM missions WHERE id = $1', [missionId]);

      if (missionCheck.rows.length === 0) {
        removeUploadedFile();
        req.flash('error', 'Selected mission does not exist.');
        return res.redirect('/teacher/upload-video');
      }

      const videoUrl = `/videos/uploads/${req.file.filename}`;

      await db.query(
        `INSERT INTO videos (mission_id, video_title, video_description, video_url, video_order, language, quality)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [missionId, videoTitle, videoDescription, videoUrl, videoOrder, language, quality]
      );

      req.flash('success', 'Video uploaded successfully.');
      res.redirect('/teacher/upload-video');
    } catch (err) {
      removeUploadedFile();
      console.error('Error uploading video:', err);
      req.flash('error', 'Could not save the uploaded video. Please try again.');
      res.redirect('/teacher/upload-video');
    }
  });
});

app.get('/teacher/create-assessment', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  try {
    // We need to fetch the teacher's classrooms to let them choose
    const classroomsResult = await db.query(
      "SELECT * FROM classrooms WHERE teacher_id = $1 ORDER BY created_at DESC", 
      [req.session.user.id]
    );
    const classrooms = classroomsResult.rows;
    
    // Pass flash messages to the template so the partial can read `messages` safely
    res.render('create_assessment', { 
      user: req.session.user, 
      classrooms,
      hasClassrooms: classrooms.length > 0,
      messages: req.flash()
    });

  } catch (err) {
    console.error("Error loading assessment page:", err);
    res.redirect('/dashboard');
  }
});

// POST Route to save the new assessment and all its questions
app.post('/teacher/create-assessment', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  const { title, description, classroom_id, assessment_type, due_date } = req.body;
  const questions = req.body.questions || [];
  const classroomId = Number.parseInt(classroom_id, 10);

  if (Number.isNaN(classroomId)) {
    req.flash('error', 'Please select a valid classroom.');
    return res.redirect('/teacher/create-assessment');
  }

  try {
    const classroomAccessResult = await db.query(
      "SELECT id FROM classrooms WHERE id = $1 AND teacher_id = $2",
      [classroomId, req.session.user.id]
    );

    if (classroomAccessResult.rows.length === 0) {
      req.flash('error', 'You can only assign assessments to your own classrooms.');
      return res.redirect('/teacher/create-assessment');
    }

    let assessmentTable = '';
    
    // 1. Determine which "container" table to use
    if (assessment_type === 'quiz') assessmentTable = 'quizzes';
    else if (assessment_type === 'test') assessmentTable = 'tests';
    else if (assessment_type === 'q_assignment') assessmentTable = 'q_assignments';
    else throw new Error("Invalid assessment type");

    // 2. Create the main assessment (Quiz, Test, or Assignment)
    let assessmentResult;
    if (assessment_type === 'q_assignment') {
      assessmentResult = await db.query(
        `INSERT INTO ${assessmentTable} (title, description, classroom_id, due_date) VALUES ($1, $2, $3, $4) RETURNING id`,
        [title, description, classroomId, due_date || null]
      );
    } else {
      assessmentResult = await db.query(
        `INSERT INTO ${assessmentTable} (title, description, classroom_id) VALUES ($1, $2, $3) RETURNING id`,
        [title, description, classroomId]
      );
    }
    
    const newAssessmentId = assessmentResult.rows[0].id;

    // 3. Loop through and save all the questions
    for (const q of questions) {
      // ** THIS IS THE BUG FIX **
      // We now correctly find the answer text instead of just saving the index.
      const optionsObject = q.options || {}; // This is {'0': 'A', '1': 'B', ...}
      const correctIndex = q.correct; // This is '0', '1', ...
      const correctAnswerText = optionsObject[correctIndex]; // This finds the actual text

      if (!correctAnswerText) {
        // This stops the server from crashing if no correct answer is selected
        console.warn("Skipping question with no correct answer:", q.text);
        continue; 
      }
      
      await db.query(
        "INSERT INTO questions (assessment_id, assessment_type, question_text, options, correct_answer) VALUES ($1, $2, $3, $4, $5)",
        [newAssessmentId, assessment_type, q.text, JSON.stringify(optionsObject), correctAnswerText]
      );
    }
    
    req.flash('success', `${assessment_type} created successfully!`);
    res.redirect('/dashboard');

  } catch (err) {
    console.error("Error creating assessment:", err);
    req.flash('error', 'There was an error creating the assessment.');
    res.redirect('/teacher/create-assessment');
  }
});

app.get('/teacher/assessments/:type/:id/edit', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  const assessmentType = req.params.type;
  const assessmentId = Number.parseInt(req.params.id, 10);
  const config = getAssessmentConfig(assessmentType);

  if (!config || Number.isNaN(assessmentId)) {
    req.flash('error', 'Assessment not found.');
    return res.redirect('/teacher/assessment-results');
  }

  try {
    const [assessmentResult, classroomsResult, questionsResult] = await Promise.all([
      db.query(
        `SELECT
          a.id,
          a.title,
          a.description,
          a.classroom_id,
          a.due_date,
          c.class_name,
          c.class_code
        FROM ${config.table} a
        JOIN classrooms c ON c.id = a.classroom_id
        WHERE a.id = $1 AND c.teacher_id = $2`,
        [assessmentId, req.session.user.id]
      ),
      db.query(
        `SELECT id, class_name, class_code
         FROM classrooms
         WHERE teacher_id = $1
         ORDER BY created_at DESC`,
        [req.session.user.id]
      ),
      db.query(
        `SELECT id, question_text, options, correct_answer
         FROM questions
         WHERE assessment_type = $1 AND assessment_id = $2
         ORDER BY id ASC`,
        [assessmentType, assessmentId]
      )
    ]);

    if (assessmentResult.rows.length === 0) {
      req.flash('error', 'You can only edit your own assessments.');
      return res.redirect('/teacher/assessment-results');
    }

    const preparedQuestions = questionsResult.rows.map((question) => {
      const options = normalizeQuestionOptions(question.options);
      const optionsArray = [
        options['0'] || options[0] || '',
        options['1'] || options[1] || '',
        options['2'] || options[2] || '',
        options['3'] || options[3] || ''
      ];

      let correctIndex = optionsArray.findIndex((optionValue) => optionValue === question.correct_answer);
      if (correctIndex < 0) {
        correctIndex = 0;
      }

      return {
        id: question.id,
        text: question.question_text,
        options: optionsArray,
        correctIndex: String(correctIndex)
      };
    });

    res.render('edit_assessment', {
      user: req.session.user,
      assessmentType,
      assessmentLabel: teacherAssessmentTypeLabels[assessmentType] || assessmentType,
      assessment: assessmentResult.rows[0],
      classrooms: classroomsResult.rows,
      questions: preparedQuestions,
      messages: req.flash()
    });
  } catch (err) {
    console.error('Error loading edit assessment page:', err);
    req.flash('error', 'Unable to load assessment editor right now.');
    res.redirect('/teacher/assessment-results');
  }
});

app.post('/teacher/assessments/:type/:id/edit', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  const assessmentType = req.params.type;
  const assessmentId = Number.parseInt(req.params.id, 10);
  const config = getAssessmentConfig(assessmentType);

  if (!config || Number.isNaN(assessmentId)) {
    req.flash('error', 'Assessment not found.');
    return res.redirect('/teacher/assessment-results');
  }

  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const classroomId = Number.parseInt(req.body.classroom_id, 10);
  const dueDate = req.body.due_date || null;
  const incomingQuestions = req.body.questions || [];
  const questions = Array.isArray(incomingQuestions) ? incomingQuestions : Object.values(incomingQuestions);

  if (!title) {
    req.flash('error', 'Assessment title is required.');
    return res.redirect(`/teacher/assessments/${assessmentType}/${assessmentId}/edit`);
  }

  if (Number.isNaN(classroomId)) {
    req.flash('error', 'Please select a valid classroom.');
    return res.redirect(`/teacher/assessments/${assessmentType}/${assessmentId}/edit`);
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const ownershipResult = await client.query(
      `SELECT a.id
       FROM ${config.table} a
       JOIN classrooms c ON c.id = a.classroom_id
       WHERE a.id = $1 AND c.teacher_id = $2`,
      [assessmentId, req.session.user.id]
    );

    if (ownershipResult.rows.length === 0) {
      await client.query('ROLLBACK');
      req.flash('error', 'You can only edit your own assessments.');
      return res.redirect('/teacher/assessment-results');
    }

    const classroomAccessResult = await client.query(
      'SELECT id FROM classrooms WHERE id = $1 AND teacher_id = $2',
      [classroomId, req.session.user.id]
    );

    if (classroomAccessResult.rows.length === 0) {
      await client.query('ROLLBACK');
      req.flash('error', 'Selected classroom does not belong to your account.');
      return res.redirect(`/teacher/assessments/${assessmentType}/${assessmentId}/edit`);
    }

    const submissionsCheckResult = await client.query(
      `SELECT COUNT(*)::INT AS total
       FROM assessment_submissions
       WHERE assessment_type = $1 AND assessment_id = $2`,
      [assessmentType, assessmentId]
    );

    if ((submissionsCheckResult.rows[0]?.total || 0) > 0) {
      await client.query('ROLLBACK');
      req.flash('error', 'This assessment already has submissions and cannot be edited.');
      return res.redirect(`/teacher/assessment-results/${assessmentType}/${assessmentId}`);
    }

    if (assessmentType === 'q_assignment') {
      await client.query(
        `UPDATE ${config.table}
         SET title = $1, description = $2, classroom_id = $3, due_date = $4
         WHERE id = $5`,
        [title, description || null, classroomId, dueDate, assessmentId]
      );
    } else {
      await client.query(
        `UPDATE ${config.table}
         SET title = $1, description = $2, classroom_id = $3
         WHERE id = $4`,
        [title, description || null, classroomId, assessmentId]
      );
    }

    await client.query(
      'DELETE FROM questions WHERE assessment_type = $1 AND assessment_id = $2',
      [assessmentType, assessmentId]
    );

    let insertedQuestions = 0;
    for (const question of questions) {
      const questionText = String(question?.text || '').trim();
      const options = question?.options || {};
      const correctIndex = question?.correct;
      const correctAnswerText = options?.[correctIndex];

      if (!questionText || !correctAnswerText) {
        continue;
      }

      await client.query(
        `INSERT INTO questions (assessment_id, assessment_type, question_text, options, correct_answer)
         VALUES ($1, $2, $3, $4, $5)`,
        [assessmentId, assessmentType, questionText, JSON.stringify(options), correctAnswerText]
      );

      insertedQuestions += 1;
    }

    if (insertedQuestions === 0) {
      await client.query('ROLLBACK');
      req.flash('error', 'Please provide at least one valid question with a correct answer.');
      return res.redirect(`/teacher/assessments/${assessmentType}/${assessmentId}/edit`);
    }

    await client.query('COMMIT');
    req.flash('success', 'Assessment updated successfully.');
    res.redirect(`/teacher/assessment-results/${assessmentType}/${assessmentId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating assessment:', err);
    req.flash('error', 'Unable to update assessment right now.');
    res.redirect(`/teacher/assessments/${assessmentType}/${assessmentId}/edit`);
  } finally {
    client.release();
  }
});

app.post('/teacher/assessments/:type/:id/delete', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  const assessmentType = req.params.type;
  const assessmentId = Number.parseInt(req.params.id, 10);
  const config = getAssessmentConfig(assessmentType);

  if (!config || Number.isNaN(assessmentId)) {
    req.flash('error', 'Assessment not found.');
    return res.redirect('/teacher/assessment-results');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const ownershipResult = await client.query(
      `SELECT a.id
       FROM ${config.table} a
       JOIN classrooms c ON c.id = a.classroom_id
       WHERE a.id = $1 AND c.teacher_id = $2`,
      [assessmentId, req.session.user.id]
    );

    if (ownershipResult.rows.length === 0) {
      await client.query('ROLLBACK');
      req.flash('error', 'You can only delete your own assessments.');
      return res.redirect('/teacher/assessment-results');
    }

    await client.query(
      'DELETE FROM assessment_submissions WHERE assessment_type = $1 AND assessment_id = $2',
      [assessmentType, assessmentId]
    );

    await client.query(
      'DELETE FROM questions WHERE assessment_type = $1 AND assessment_id = $2',
      [assessmentType, assessmentId]
    );

    await client.query(
      `DELETE FROM ${config.table} WHERE id = $1`,
      [assessmentId]
    );

    await client.query('COMMIT');
    req.flash('success', 'Assessment deleted successfully.');
    res.redirect('/teacher/assessment-results');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error deleting assessment:', err);
    req.flash('error', 'Unable to delete assessment right now.');
    res.redirect('/teacher/assessment-results');
  } finally {
    client.release();
  }
});

app.get('/teacher/assessment-results', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  try {
    const assessments = await getTeacherAssessmentsWithStats(req.session.user.id);

    res.render('teacher_assessment_results', {
      user: req.session.user,
      assessments,
      selectedAssessment: null,
      submissions: [],
      messages: req.flash()
    });
  } catch (err) {
    console.error('Error loading teacher assessment results:', err);
    req.flash('error', 'Unable to load assessment results right now.');
    res.redirect('/dashboard');
  }
});

app.get('/teacher/assessment-results/:type/:id', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  const assessmentType = req.params.type;
  const assessmentId = Number.parseInt(req.params.id, 10);
  const config = getAssessmentConfig(assessmentType);

  if (!config || Number.isNaN(assessmentId)) {
    req.flash('error', 'Assessment not found.');
    return res.redirect('/teacher/assessment-results');
  }

  try {
    const [assessments, selectedAssessmentResult] = await Promise.all([
      getTeacherAssessmentsWithStats(req.session.user.id),
      db.query(
        `SELECT
          a.id,
          a.title,
          a.description,
          a.created_at,
          c.class_name,
          c.class_code
        FROM ${config.table} a
        JOIN classrooms c ON c.id = a.classroom_id
        WHERE a.id = $1 AND c.teacher_id = $2`,
        [assessmentId, req.session.user.id]
      )
    ]);

    if (selectedAssessmentResult.rows.length === 0) {
      req.flash('error', 'You can only view results for your own assessments.');
      return res.redirect('/teacher/assessment-results');
    }

    const submissionsResult = await db.query(
      `SELECT
        s.id,
        s.score,
        s.total_questions,
        s.submitted_at,
        u.full_name,
        u.username,
        u.email,
        CASE
          WHEN s.total_questions > 0 THEN ROUND((s.score::numeric / s.total_questions) * 100, 1)
          ELSE 0
        END AS percentage
      FROM assessment_submissions s
      JOIN users u ON u.id = s.student_id
      WHERE s.assessment_type = $1 AND s.assessment_id = $2
      ORDER BY s.submitted_at DESC, u.full_name ASC`,
      [assessmentType, assessmentId]
    );

    const selectedAssessment = {
      ...selectedAssessmentResult.rows[0],
      assessment_type: assessmentType,
      assessment_type_label: teacherAssessmentTypeLabels[assessmentType] || assessmentType
    };

    res.render('teacher_assessment_results', {
      user: req.session.user,
      assessments,
      selectedAssessment,
      submissions: submissionsResult.rows,
      messages: req.flash()
    });
  } catch (err) {
    console.error('Error loading teacher assessment submissions:', err);
    req.flash('error', 'Unable to load submission details right now.');
    res.redirect('/teacher/assessment-results');
  }
});

app.get('/teacher/assessment-results/:type/:assessmentId/submissions/:submissionId', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  const assessmentType = req.params.type;
  const assessmentId = Number.parseInt(req.params.assessmentId, 10);
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  const config = getAssessmentConfig(assessmentType);

  if (!config || Number.isNaN(assessmentId) || Number.isNaN(submissionId)) {
    req.flash('error', 'Submission not found.');
    return res.redirect('/teacher/assessment-results');
  }

  try {
    const submissionResult = await db.query(
      `SELECT
        s.id,
        s.score,
        s.total_questions,
        s.submitted_at,
        s.answers,
        u.id AS student_id,
        u.full_name,
        u.username,
        u.email,
        a.title,
        a.description,
        c.class_name,
        c.class_code
      FROM assessment_submissions s
      JOIN users u ON u.id = s.student_id
      JOIN ${config.table} a ON a.id = s.assessment_id
      JOIN classrooms c ON c.id = a.classroom_id
      WHERE c.teacher_id = $1
        AND s.assessment_type = $2
        AND s.assessment_id = $3
        AND s.id = $4`,
      [req.session.user.id, assessmentType, assessmentId, submissionId]
    );

    if (submissionResult.rows.length === 0) {
      req.flash('error', 'Submission not found for this teacher.');
      return res.redirect(`/teacher/assessment-results/${assessmentType}/${assessmentId}`);
    }

    const questionsResult = await db.query(
      `SELECT
        id,
        question_text,
        options,
        correct_answer
      FROM questions
      WHERE assessment_type = $1 AND assessment_id = $2
      ORDER BY id ASC`,
      [assessmentType, assessmentId]
    );

    const submission = submissionResult.rows[0];
    const submittedAnswers = normalizeQuestionOptions(submission.answers);

    const questions = questionsResult.rows.map((question) => {
      const options = normalizeQuestionOptions(question.options);
      const selectedAnswer = submittedAnswers[String(question.id)] || submittedAnswers[question.id] || null;
      const isCorrect = Boolean(selectedAnswer) && selectedAnswer === question.correct_answer;

      return {
        id: question.id,
        question_text: question.question_text,
        options,
        selected_answer: selectedAnswer,
        correct_answer: question.correct_answer,
        is_correct: isCorrect
      };
    });

    const selectedAssessment = {
      id: assessmentId,
      assessment_type: assessmentType,
      assessment_type_label: teacherAssessmentTypeLabels[assessmentType] || assessmentType,
      title: submission.title,
      description: submission.description,
      class_name: submission.class_name,
      class_code: submission.class_code
    };

    res.render('teacher_submission_detail', {
      user: req.session.user,
      selectedAssessment,
      submission,
      questions,
      messages: req.flash()
    });
  } catch (err) {
    console.error('Error loading submission detail:', err);
    req.flash('error', 'Unable to load submission detail right now.');
    res.redirect(`/teacher/assessment-results/${assessmentType}/${assessmentId}`);
  }
});

// NEW: Leaderboard Route
app.get('/leaderboard', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  try {
    // Fetch top 20 users, ordered by XP in descending order
    const result = await db.query(
      "SELECT id, full_name, username, city, xp FROM users ORDER BY xp DESC LIMIT 20"
    );
    const topUsers = result.rows;

    res.render('leaderboard', { 
      user: req.session.user, 
      topUsers: topUsers 
    });
  } catch (err) {
    console.error("Error fetching leaderboard data:", err);
    res.redirect('/');
  }
});

// --- Start Server (local only) ---
if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`🟢 Server running on http://localhost:${port}`);
  });
}

export default app;